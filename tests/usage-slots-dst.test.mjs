import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUsageSlots,
  usageSlotKeys,
} from "../server/queries.mjs";
import { localDayStartUtcMs, nextDateKey } from "../server/time.mjs";

// The DST correctness of the per-slot series: hourly slots derive from
// the actual hours of the local day and key by their UTC hour start,
// so the two 02:00 hours of the 25-hour fall-back day stay separate
// with their own kWh and the 23-hour spring-forward day emits no empty
// extra slot. Day and month slots are calendar-based and unchanged.

const FALL_BACK_DAY = "2026-10-25";
const SPRING_FORWARD_DAY = "2026-03-29";

// A minimal entity map: one import counter, everything else absent.
const MAP = {
  import: 1,
  export: null,
  pv: null,
  batteryCharging: null,
  batteryDischarging: null,
};

function usageRow(dayKey, hourUtc, kwh) {
  return {
    hour: new Date(localDayStartUtcMs(dayKey) + hourUtc * 3_600_000),
    entity_id: 1,
    kwh,
  };
}

function priceRow(dayKey, hourUtc, price) {
  return {
    ts: new Date(localDayStartUtcMs(dayKey) + hourUtc * 3_600_000),
    price_eur: price,
  };
}

function slotsFor(dayKey, rows, priceRows) {
  const fromMs = localDayStartUtcMs(dayKey);
  const toMs = localDayStartUtcMs(nextDateKey(dayKey, 1));
  return buildUsageSlots({
    fromMs,
    toMs,
    unit: "hour",
    rows,
    priceRows,
    map: MAP,
    plugIdToCategory: new Map(),
    bothBatteryMissing: true,
    heatPumpPerDay: new Map(),
  });
}

describe("usageSlotKeys: the true hours of a local day", () => {
  it("emits 25 hour keys on the fall-back day", () => {
    assert.equal(usageSlotKeys("2026-10-25", "2026-10-25", "hour").length, 25);
  });

  it("emits 23 hour keys on the spring-forward day", () => {
    assert.equal(usageSlotKeys("2026-03-29", "2026-03-29", "hour").length, 23);
  });

  it("emits 24 hour keys on an ordinary day", () => {
    assert.equal(usageSlotKeys("2026-07-15", "2026-07-15", "hour").length, 24);
  });
});

describe("buildUsageSlots: the 25-hour fall-back day", () => {
  // Every hour carries 0.1 kWh except the two 02:00 hours, which carry
  // their own amounts; UTC hour 2 is 02:00 CEST, UTC hour 3 is 02:00 CET.
  const rows = Array.from({ length: 25 }, (_, hourUtc) =>
    usageRow(FALL_BACK_DAY, hourUtc, hourUtc === 2 ? 0.25 : hourUtc === 3 ? 0.35 : 0.1)
  );
  const priceRows = Array.from({ length: 25 }, (_, hourUtc) =>
    priceRow(FALL_BACK_DAY, hourUtc, 0.2 + hourUtc * 0.01)
  );
  const { unit, series } = slotsFor(FALL_BACK_DAY, rows, priceRows);

  it("emits 25 hour slots", () => {
    assert.equal(unit, "hour");
    assert.equal(series.length, 25);
  });

  it("keeps the two 02:00 slots separate with their own kWh", () => {
    const utc00 = series.find(
      (slot) => slot.ts === "2026-10-25T00:00:00.000Z"
    );
    const utc01 = series.find(
      (slot) => slot.ts === "2026-10-25T01:00:00.000Z"
    );
    assert.ok(utc00, "the 02:00 CEST slot is present");
    assert.ok(utc01, "the 02:00 CET slot is present");
    assert.equal(utc00.kwh, 0.25);
    assert.equal(utc01.kwh, 0.35);
  });

  it("keeps the two 02:00 prices separate", () => {
    const utc00 = series.find(
      (slot) => slot.ts === "2026-10-25T00:00:00.000Z"
    );
    const utc01 = series.find(
      (slot) => slot.ts === "2026-10-25T01:00:00.000Z"
    );
    assert.equal(utc00.price_eur, 0.22);
    assert.equal(utc01.price_eur, 0.23);
  });

  it("leaves the day total unchanged", () => {
    const total = series.reduce((sum, slot) => sum + slot.kwh, 0);
    // 23 ordinary hours at 0.1 plus 0.25 and 0.35 for the two 02:00s.
    assert.ok(Math.abs(total - (23 * 0.1 + 0.25 + 0.35)) < 1e-9);
  });
});

describe("buildUsageSlots: the 23-hour spring-forward day", () => {
  // UTC hour 2 does not exist locally that day (01:00 UTC is already
  // 03:00 CEST); 23 hourly buckets from 23:00Z the day before.
  const rows = Array.from({ length: 23 }, (_, hourUtc) =>
    usageRow(SPRING_FORWARD_DAY, hourUtc, 0.1)
  );
  const { series } = slotsFor(SPRING_FORWARD_DAY, rows, []);

  it("emits 23 hour slots", () => {
    assert.equal(series.length, 23);
  });

  it("has no empty 02:00 slot", () => {
    assert.ok(series.every((slot) => slot.kwh > 0));
  });
});
