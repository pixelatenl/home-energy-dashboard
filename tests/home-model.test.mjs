import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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

describe("homeModelEntries: the per-period model", () => {
  it("scales every per-day estimate by the window's days", () => {
    const { entries, modeledKwh } = homeModelEntries(7);
    for (const entry of entries) {
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

  it("covers the six registered background devices", () => {
    const { entries } = homeModelEntries(1);
    assert.deepEqual(
      entries.map((e) => e.key),
      [
        "lighting",
        "refrigerators",
        "kitchen_boiler",
        "microwave",
        "coffee_machine",
        "network_standby",
      ]
    );
  });

  it("keeps the modeled sum exact at two decimals for any day count", () => {
    for (const days of [1, 7, 28, 29, 30, 31, 365, 366]) {
      const { entries, modeledKwh } = homeModelEntries(days);
      const sum = entries.reduce((acc, e) => acc + e.kwh_per_day * days, 0);
      assert.equal(Math.round(modeledKwh * 100) / 100, Math.round(sum * 100) / 100);
    }
  });

  it("reconciles modeled entries plus the unexplained remainder exactly", () => {
    // The display reconciliation: displayed entries + displayed
    // unexplained = displayed remainder, exactly, because the
    // per-day values are single decimals.
    const remainder = 73.61;
    const { entries, modeledKwh } = homeModelEntries(7);
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
    const remainder = 3.2; // a low-usage day
    const { modeledKwh } = homeModelEntries(1);
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
