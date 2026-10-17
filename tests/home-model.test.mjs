import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  baseLoadConfig,
  baseloadKwhPerDay,
  homeModelEntries,
  slotUnitForDays,
  windowDays,
} from "../server/queries.mjs";
import { localDayStartUtcMs } from "../server/time.mjs";

// A half-open local window [startKey, nextKey).
const window = (startKey, days) => ({
  fromMs: localDayStartUtcMs(startKey),
  toMs: localDayStartUtcMs(
    (() => {
      const [y, m, d] = startKey.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d + days));
      const pad = (v) => String(v).padStart(2, "0");
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    })()
  ),
});

describe("windowDays: the model's day multiplier", () => {
  it("counts one day for a day window", () => {
    const w = window("2026-10-16", 1);
    assert.equal(windowDays(w.fromMs, w.toMs), 1);
  });

  it("counts seven days for an ISO week", () => {
    const w = window("2026-10-12", 7);
    assert.equal(windowDays(w.fromMs, w.toMs), 7);
  });

  it("counts the calendar month length", () => {
    assert.equal(windowDays(...Object.values(window("2026-10-01", 31))), 31);
  });

  it("counts a leap February", () => {
    assert.equal(windowDays(...Object.values(window("2028-02-01", 29))), 29);
  });

  it("counts a leap year as 366 days", () => {
    assert.equal(windowDays(...Object.values(window("2028-01-01", 366))), 366);
  });
});

// The baseload method's default config (docs/spec.md section 6.1).
const BASELOAD_DEFAULTS = {
  method: "median_low",
  lowHours: 4,
  percentile: 10,
  nightStart: 22,
  nightEnd: 6,
  minHours: 3,
  maxChargeKwh: 0.05,
  basis: "test basis",
};

// One local hour of the day: its five-counter consumption and the
// battery charge term, the shape baseloadKwhPerDay consumes.
const hour = (hourIndex, kwh, chargeKwh = 0) => ({
  hour: hourIndex,
  kwh,
  chargeKwh,
});

// A full 24-hour day: quiet night hours at nightKwh, the rest at
// dayKwh, with an optional charge bucket on the night hours.
const fullDay = (nightKwh, dayKwh, nightChargeKwh = 0) =>
  Array.from({ length: 24 }, (_, h) =>
    h >= 22 || h < 6
      ? hour(h, nightKwh, nightChargeKwh)
      : hour(h, dayKwh)
  );

// A night's hourly consumption values, in night-hour order
// (22, 23, 0..5), paired with a flat daytime level.
const nightProfile = (nightValues, dayKwh) =>
  [22, 23, 0, 1, 2, 3, 4, 5].map((h, i) =>
    hour(h, nightValues[i], 0)
  ).concat(
    Array.from({ length: 16 }, (_, i) => hour([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21][i], dayKwh))
  );

describe("baseloadKwhPerDay: the data-derived per-day statistic", () => {
  it("takes the median of the day's lowest few quiet hours times 24", () => {
    const hours = nightProfile(
      [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65],
      0.8
    );
    const out = baseloadKwhPerDay(
      new Map([["2026-10-15", hours]]),
      BASELOAD_DEFAULTS
    );
    // lowest 4 quiet values 0.3, 0.35, 0.4, 0.45 -> median 0.375
    assert.equal(out.get("2026-10-15"), 9.0);
  });

  it("prefers quiet nighttime hours over lower daytime hours", () => {
    const hours = fullDay(0.4, 0.6).map((entry) =>
      entry.hour === 10 || entry.hour === 11
        ? hour(entry.hour, 0.05)
        : entry
    );
    const out = baseloadKwhPerDay(
      new Map([["2026-10-15", hours]]),
      BASELOAD_DEFAULTS
    );
    // the 0.05 daytime hours never enter the statistic
    assert.equal(out.get("2026-10-15"), 9.6);
  });

  it("excludes hours whose battery charge bucket distorts the hour", () => {
    const config = { ...BASELOAD_DEFAULTS, lowHours: 2 };
    const hours = nightProfile(
      [0.5, 0.05, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1],
      1.5
    ).map((entry) =>
      entry.hour === 23 ? hour(23, 0.05, 3.0) : entry // bursty charge bucket
    );
    const out = baseloadKwhPerDay(
      new Map([["2026-10-15", hours]]),
      config
    );
    // hour 23 is excluded; median of 0.5 and 0.6, not 0.05
    assert.equal(out.get("2026-10-15"), 13.2);
  });

  it("widens to the full day when too few quiet hours survive the guard", () => {
    // every night hour (0.5) carries a charge bucket, so the quiet
    // daytime hours (0.4) become the candidates
    const hours = fullDay(0.5, 0.4, 2.0);
    const out = baseloadKwhPerDay(
      new Map([["2026-10-15", hours]]),
      BASELOAD_DEFAULTS
    );
    assert.equal(out.get("2026-10-15"), 9.6);
  });

  it("carries no base load when fewer than minHours candidates remain", () => {
    const hours = [hour(22, 0.5), hour(23, 0.5)]; // sparse cadence day
    const out = baseloadKwhPerDay(
      new Map([["2026-10-15", hours]]),
      BASELOAD_DEFAULTS
    );
    assert.equal(out.has("2026-10-15"), false);
  });

  it("supports the percentile method", () => {
    const config = { ...BASELOAD_DEFAULTS, method: "percentile", percentile: 10 };
    const hours = nightProfile(
      [0.2, 0.4, 0.5, 0.6, 0.8, 0.9, 1.0, 1.2],
      1.5
    );
    const out = baseloadKwhPerDay(
      new Map([["2026-10-15", hours]]),
      config
    );
    // index round(0.10 * 7) = 1 -> 0.4 kWh/h
    assert.equal(out.get("2026-10-15"), 9.6);
  });

  it("caps the day's base load at the day's own total consumption", () => {
    // a sparse day: only three quiet hours carry data, so the
    // statistic would otherwise over-explain the day
    const hours = [hour(22, 0.5), hour(23, 0.5), hour(0, 0.5)];
    const out = baseloadKwhPerDay(
      new Map([["2026-10-15", hours]]),
      BASELOAD_DEFAULTS
    );
    assert.equal(out.get("2026-10-15"), 1.5);
  });

  it("omits days with no positive base load", () => {
    const hours = [hour(22, 0), hour(23, 0), hour(0, 0), hour(1, 0)];
    const out = baseloadKwhPerDay(
      new Map([["2026-10-15", hours]]),
      BASELOAD_DEFAULTS
    );
    assert.equal(out.has("2026-10-15"), false);
  });

  it("derives each day from its own hours only", () => {
    const out = baseloadKwhPerDay(
      new Map([
        ["2026-10-14", fullDay(0.4, 0.4)],
        ["2026-10-15", fullDay(0.6, 0.6)],
      ]),
      BASELOAD_DEFAULTS
    );
    assert.equal(out.get("2026-10-14"), 9.6);
    assert.equal(out.get("2026-10-15"), 14.4);
  });
});

describe("baseLoadConfig: the tunable method", () => {
  const KNOBS = [
    "EMS_BASELOAD_METHOD",
    "EMS_BASELOAD_LOW_HOURS",
    "EMS_BASELOAD_PERCENTILE",
    "EMS_BASELOAD_NIGHT_START",
    "EMS_BASELOAD_NIGHT_END",
    "EMS_BASELOAD_MIN_HOURS",
    "EMS_BASELOAD_MAX_CHARGE_KWH",
  ];
  const saved = new Map();

  it("defaults to the median-low method over quiet night hours", () => {
    const config = baseLoadConfig();
    assert.equal(config.method, "median_low");
    assert.equal(config.lowHours, 4);
    assert.equal(config.nightStart, 22);
    assert.equal(config.nightEnd, 6);
    assert.equal(config.minHours, 3);
    assert.equal(config.maxChargeKwh, 0.05);
    assert.ok(config.basis.includes("data-derived"));
  });

  it("reads the knobs from the environment", () => {
    for (const knob of KNOBS) {
      if (process.env[knob] !== undefined) {
        saved.set(knob, process.env[knob]);
      }
    }
    process.env.EMS_BASELOAD_METHOD = "percentile";
    process.env.EMS_BASELOAD_LOW_HOURS = "6";
    process.env.EMS_BASELOAD_PERCENTILE = "25";
    process.env.EMS_BASELOAD_NIGHT_START = "21";
    process.env.EMS_BASELOAD_NIGHT_END = "7";
    process.env.EMS_BASELOAD_MIN_HOURS = "5";
    process.env.EMS_BASELOAD_MAX_CHARGE_KWH = "0.2";
    try {
      const config = baseLoadConfig();
      assert.equal(config.method, "percentile");
      assert.equal(config.lowHours, 6);
      assert.equal(config.percentile, 25);
      assert.equal(config.nightStart, 21);
      assert.equal(config.nightEnd, 7);
      assert.equal(config.minHours, 5);
      assert.equal(config.maxChargeKwh, 0.2);
      assert.ok(config.basis.includes("25th-percentile"));
    } finally {
      for (const knob of KNOBS) {
        if (saved.has(knob)) {
          process.env[knob] = saved.get(knob);
        } else {
          delete process.env[knob];
        }
      }
    }
  });

  it("falls back to the defaults on invalid values", () => {
    process.env.EMS_BASELOAD_LOW_HOURS = "not-a-number";
    try {
      assert.equal(baseLoadConfig().lowHours, 4);
    } finally {
      delete process.env.EMS_BASELOAD_LOW_HOURS;
    }
  });
});

describe("homeModelEntries: the per-period model", () => {
  it("scales every static per-day estimate by the window's days", () => {
    const { entries, modeledKwh } = homeModelEntries(7);
    for (const entry of entries) {
      if (entry.key === "base_load") {
        continue;
      }
      assert.equal(entry.kwh, Math.round(entry.kwh_per_day * 7 * 100) / 100);
      assert.ok(entry.basis.length > 0);
      assert.ok(entry.name.length > 0);
    }
    assert.ok(
      Math.abs(
        modeledKwh - entries.reduce((sum, e) => sum + e.kwh, 0)
      ) < 1e-9
    );
  });

  it("covers the base load plus the four static background devices", () => {
    const { entries } = homeModelEntries(1);
    assert.deepEqual(
      entries.map((e) => e.key),
      ["base_load", "lighting", "kitchen_boiler", "microwave", "coffee_machine"]
    );
  });

  it("absorbs the always-on static entries into the base load without double counting", () => {
    const { entries } = homeModelEntries(1);
    const keys = entries.map((e) => e.key);
    assert.ok(!keys.includes("refrigerators"));
    assert.ok(!keys.includes("network_standby"));
    const lighting = entries.find((e) => e.key === "lighting");
    assert.ok(lighting.basis.includes("base load"));
  });

  it("sums the base load's own per-day figures exactly", () => {
    const perDay = new Map([
      ["2026-10-12", 6.0],
      ["2026-10-13", 7.2],
    ]);
    const { entries, modeledKwh } = homeModelEntries(2, {
      perDay,
      basis: "test basis",
    });
    const base = entries.find((e) => e.key === "base_load");
    assert.equal(base.derived, true);
    assert.equal(base.kwh, 13.2);
    assert.equal(base.kwh_per_day, 6.6);
    assert.equal(base.basis, "test basis");
    assert.equal(
      Math.round(modeledKwh * 100) / 100,
      Math.round(
        (entries.reduce((s, e) => s + e.kwh, 0)) * 100
      ) / 100
    );
  });

  it("keeps a zero base load entry when no day produced one", () => {
    const { entries } = homeModelEntries(1);
    const base = entries.find((e) => e.key === "base_load");
    assert.equal(base.kwh, 0);
    assert.equal(base.kwh_per_day, 0);
    assert.equal(base.derived, true);
    assert.ok(base.basis.includes("data-derived"));
  });

  it("keeps the modeled sum exact at two decimals for any day count", () => {
    for (const days of [1, 7, 28, 29, 30, 31, 365, 366]) {
      const { entries, modeledKwh } = homeModelEntries(days);
      const sum = entries.reduce((acc, e) => acc + e.kwh, 0);
      assert.equal(Math.round(modeledKwh * 100) / 100, Math.round(sum * 100) / 100);
    }
  });

  it("reconciles modeled entries plus the unexplained remainder exactly", () => {
    // The display reconciliation: displayed entries + displayed
    // unexplained = displayed remainder, exactly, because every
    // per-period figure is exact at two decimals.
    const perDay = new Map([
      ["2026-10-12", 6.0],
      ["2026-10-13", 7.2],
      ["2026-10-14", 6.6],
      ["2026-10-15", 5.4],
      ["2026-10-16", 6.0],
      ["2026-10-17", 7.08],
      ["2026-10-18", 6.72],
    ]);
    const remainder = 73.61;
    const { entries, modeledKwh } = homeModelEntries(7, {
      perDay,
      basis: "test basis",
    });
    const unexplained = Math.max(
      0,
      Math.round((remainder - Math.round(modeledKwh * 100) / 100) * 100) / 100
    );
    const sum =
      Math.round(entries.reduce((s, e) => s + e.kwh, 0) * 100) / 100 +
      unexplained;
    assert.equal(sum, remainder);
  });

  it("floors the unexplained remainder at zero when the model over-explains", () => {
    const perDay = new Map([["2026-10-15", 4.0]]);
    const remainder = 3.2; // a low-usage day
    const { modeledKwh } = homeModelEntries(1, { perDay, basis: "b" });
    const unexplained = Math.max(0, remainder - modeledKwh);
    assert.equal(unexplained, 0);
  });
});

describe("slotUnitForDays: the chart granularity rule", () => {
  it("renders hours for a single day, days for weeks and months, months for years", () => {
    assert.equal(slotUnitForDays(1), "hour");
    assert.equal(slotUnitForDays(7), "day");
    assert.equal(slotUnitForDays(28), "day");
    assert.equal(slotUnitForDays(31), "day");
    assert.equal(slotUnitForDays(62), "day");
    assert.equal(slotUnitForDays(63), "month");
    assert.equal(slotUnitForDays(365), "month");
    assert.equal(slotUnitForDays(366), "month");
  });
});
