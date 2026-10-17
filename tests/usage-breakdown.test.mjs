import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gasMonthIntervals,
  gasNonHeatingBaselineM3PerMonth,
  heatingBucketDays,
  heatingGasM3,
  heatPumpKwhFromHeatingGas,
  remainderKwh,
  setpointStalenessMs,
  USAGE_CATEGORIES,
} from "../server/queries.mjs";
import { localDayStartUtcMs } from "../server/time.mjs";
import { nextDateKey, periodDateKeys } from "../server/time.mjs";

// The Heat tab hybrid model's default assumptions.
const ASSUMPTIONS = {
  gasCalorificKwhPerM3: 9.9,
  boilerEfficiency: 0.9,
  copAt7C: 3.0,
  copAtMinus7C: 2.2,
};

// A daily gas row for a local date key with a volume in m3.
function gasDay(dateKey, m3) {
  return { bucket: new Date(localDayStartUtcMs(dateKey)), kwh: m3 };
}

// An hourly sample row (temperature or setpoint) at a local date
// key plus whole hours, matching the continuous aggregate's shape.
function hourly(dateKey, hour, value) {
  return {
    bucket: new Date(localDayStartUtcMs(dateKey) + hour * 3_600_000),
    avg_value: value,
  };
}

describe("registry: the plug counter resolution", () => {
  const byKey = new Map(
    USAGE_CATEGORIES.map((category) => [category.key, category])
  );

  it("maps each measured plug to exactly one entity", () => {
    assert.deepEqual(byKey.get("dishwasher").entities, [
      "sensor.kitchen_dishwasher_cumulative_energy",
    ]);
    assert.deepEqual(byKey.get("dryer").entities, [
      "sensor.garage_dryer_cumulative_energy",
    ]);
    assert.deepEqual(byKey.get("washing_machine").entities, [
      "sensor.garage_washing_machine_cumulative_energy",
    ]);
  });

  it("excludes the Samsung counters that measure the same machine", () => {
    const all = USAGE_CATEGORIES.flatMap(
      (category) => category.entities
    );
    assert.ok(!all.includes("sensor.garage_washer_energy"));
    assert.ok(!all.includes("sensor.garage_washer_power"));
  });
});

describe("heatingBucketDays: the activity proxy", () => {
  const DAY = "2026-10-15";

  it("marks a day heating when the temperature sits below the setpoint", () => {
    const days = heatingBucketDays(
      [hourly(DAY, 10, 18.5)],
      [hourly(DAY, 9, 20)],
      0,
      24 * 3_600_000
    );
    assert.deepEqual(days, [DAY]);
  });

  it("respects the hysteresis band", () => {
    const days = heatingBucketDays(
      [hourly(DAY, 10, 19.6)],
      [hourly(DAY, 9, 20)],
      0.5,
      24 * 3_600_000
    );
    assert.deepEqual(days, []);
  });

  it("forward-fills the sparse setpoint stream", () => {
    const days = heatingBucketDays(
      [hourly(DAY, 12, 18.0), hourly(DAY, 15, 18.0)],
      [hourly(DAY, 9, 20)],
      0,
      24 * 3_600_000
    );
    assert.deepEqual(days, [DAY, DAY]);
  });

  it("expires a forward-filled setpoint at the staleness guard", () => {
    const days = heatingBucketDays(
      [hourly(DAY, 10, 18.0), hourly("2026-10-17", 10, 18.0)],
      [hourly(DAY, 9, 20)],
      0,
      24 * 3_600_000
    );
    assert.deepEqual(days, [DAY]);
  });

  it("never counts a zone without any setpoint sample", () => {
    const days = heatingBucketDays(
      [hourly(DAY, 10, 18.0)],
      [],
      0,
      24 * 3_600_000
    );
    assert.deepEqual(days, []);
  });
});

describe("heatingGasM3: the daily heating figure", () => {
  it("subtracts the prorated non-heating baseline on heating days", () => {
    const active = new Set(["2026-10-15"]);
    // October has 31 days: a 20 m3/month baseline is 20/31 per day.
    const gas = heatingGasM3([gasDay("2026-10-15", 3)], active, 20);
    assert.ok(Math.abs(gas - (3 - 20 / 31)) < 1e-9);
  });

  it("prorates over the actual month length", () => {
    const active = new Set(["2026-02-10"]);
    const gas = heatingGasM3([gasDay("2026-02-10", 2)], active, 20);
    assert.ok(Math.abs(gas - (2 - 20 / 28)) < 1e-9);
  });

  it("skips days without heating activity entirely", () => {
    const active = new Set(["2026-10-15"]);
    const gas = heatingGasM3(
      [gasDay("2026-10-14", 5), gasDay("2026-10-15", 3)],
      active,
      20
    );
    assert.ok(Math.abs(gas - (3 - 20 / 31)) < 1e-9);
  });

  it("never goes negative on a low-volume day", () => {
    const active = new Set(["2026-10-15"]);
    const gas = heatingGasM3([gasDay("2026-10-15", 0.2)], active, 20);
    assert.equal(gas, 0);
  });

  it("sums multiple gas rows on the same day", () => {
    const active = new Set(["2026-10-15"]);
    const gas = heatingGasM3(
      [gasDay("2026-10-15", 1.5), gasDay("2026-10-15", 1.5)],
      active,
      20
    );
    assert.ok(Math.abs(gas - (3 - 20 / 31)) < 1e-9);
  });
});

describe("heatPumpKwhFromHeatingGas: the hybrid model conversion", () => {
  it("converts heating gas through calorific, efficiency and flat COP", () => {
    // 10 m3 -> 89.1 kWh heat -> 29.7 kWh electricity at COP 3.
    const kwh = heatPumpKwhFromHeatingGas(10, ASSUMPTIONS);
    assert.ok(Math.abs(kwh - 29.7) < 1e-9);
  });

  it("is zero without heating gas", () => {
    assert.equal(heatPumpKwhFromHeatingGas(0, ASSUMPTIONS), 0);
  });

  it("is zero when the flat COP is not positive", () => {
    assert.equal(
      heatPumpKwhFromHeatingGas(10, { ...ASSUMPTIONS, copAt7C: 0 }),
      0
    );
  });
});

describe("remainderKwh: the remainder bucket", () => {
  it("equals total minus measured minus estimated", () => {
    assert.ok(Math.abs(remainderKwh(10, 3, 2.5) - 4.5) < 1e-9);
  });

  it("is floored at zero when the estimate overshoots", () => {
    assert.equal(remainderKwh(10, 8, 3), 0);
  });
});

describe("period windows: the year and the previous year", () => {
  it("selects the calendar year containing the anchor date", () => {
    assert.deepEqual(periodDateKeys("year", "2026-10-16"), {
      startKey: "2026-01-01",
      endKey: "2026-12-31",
    });
    assert.deepEqual(periodDateKeys("year", "2026-01-01"), {
      startKey: "2026-01-01",
      endKey: "2026-12-31",
    });
    assert.deepEqual(periodDateKeys("year", "2026-12-31"), {
      startKey: "2026-01-01",
      endKey: "2026-12-31",
    });
  });

  it("derives the previous-year window from the day before the start", () => {
    const keys = periodDateKeys("year", "2026-10-16");
    const previous = periodDateKeys("year", nextDateKey(keys.startKey, -1));
    assert.deepEqual(previous, {
      startKey: "2025-01-01",
      endKey: "2025-12-31",
    });
    // The previous window ends exactly where the current one starts.
    assert.equal(
      localDayStartUtcMs(nextDateKey(previous.endKey, 1)),
      localDayStartUtcMs(keys.startKey)
    );
  });

  it("spans the leap-year window correctly", () => {
    const keys = periodDateKeys("year", "2028-06-15");
    assert.equal(keys.startKey, "2028-01-01");
    assert.equal(keys.endKey, "2028-12-31");
    // 2028 is a leap year: 366 local days from January 1 to the next
    // January 1 (across the 2028 leap day and both DST transitions).
    const spanDays =
      (localDayStartUtcMs("2029-01-01") - localDayStartUtcMs("2028-01-01")) /
      86_400_000;
    assert.equal(Math.round(spanDays), 366);
  });
});

describe("config defaults", () => {
  it("defaults the non-heating baseline to 20 m3 per month", () => {
    assert.equal(gasNonHeatingBaselineM3PerMonth(), 20);
  });

  it("defaults the setpoint staleness guard to 24 hours", () => {
    assert.equal(setpointStalenessMs(), 24 * 3_600_000);
  });
});

describe("gasMonthIntervals: the local calendar month rollup", () => {
  const prices = [{ day: "2026-10-01", price_eur_per_m3: 1.0 }];

  it("groups by the local month, never the UTC month of the bucket", () => {
    // Local 1 November starts at 23:00Z on 31 October (CET): its UTC
    // month is October, its local month November. The local 31 October
    // bucket starts at 23:00Z on 30 October.
    const months = gasMonthIntervals(
      [gasDay("2026-10-31", 1.0), gasDay("2026-11-01", 2.0)],
      prices
    );
    assert.equal(months.length, 2);
    assert.equal(months[0].tsMs, localDayStartUtcMs("2026-10-01"));
    assert.equal(months[0].volume, 1.0);
    assert.equal(months[1].tsMs, localDayStartUtcMs("2026-11-01"));
    assert.equal(months[1].volume, 2.0);
    // Both days are priced at October's forward-filled price.
    assert.equal(months[0].cost, 1.0);
    assert.equal(months[1].cost, 2.0);
    assert.equal(months[0].unknownPrice, false);
    assert.equal(months[1].unknownPrice, false);
  });

  it("emits month starts at local midnight, ascending", () => {
    const months = gasMonthIntervals(
      [gasDay("2026-12-31", 0.5), gasDay("2026-10-12", 0.25)],
      prices
    );
    assert.deepEqual(
      months.map((month) => month.tsMs),
      [localDayStartUtcMs("2026-10-01"), localDayStartUtcMs("2026-12-01")]
    );
  });

  it("flags a producing day without any known price", () => {
    const months = gasMonthIntervals([gasDay("2026-11-02", 1.5)], []);
    assert.equal(months.length, 1);
    assert.equal(months[0].unknownPrice, true);
    assert.equal(months[0].cost, 0);
  });
});
