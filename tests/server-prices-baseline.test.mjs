import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASELINE_MIN_DAYS,
  BASELINE_WINDOW_DAYS,
  fetchPriceBaseline,
  priceBaselineFromDailyExtremes,
} from "../server/prices.mjs";
import {
  localDateKey,
  localDayStartUtcMs,
  nextDateKey,
} from "../server/time.mjs";

// The 30-day price baseline behind the /api/prices payload's `baseline`
// field: per completed local day the day's min and max hourly price, folded
// into rolling averages. The window and the fail-soft threshold are pinned
// here, together with the fail-soft behavior when the query errors.

const row = (day, day_min, day_max) => ({ day, day_min, day_max });

// `count` days of extremes with distinct, non-round values so the test can
// tell an exact average from a rounded one.
const rows = (count) =>
  Array.from({ length: count }, (_, i) =>
    row(`2026-09-${String(i + 1).padStart(2, "0")}`, 0.1 + i / 1000, 0.5 - i / 1000)
  );

describe("priceBaselineFromDailyExtremes", () => {
  it("pins the window and fail-soft constants", () => {
    assert.equal(BASELINE_WINDOW_DAYS, 30);
    assert.equal(BASELINE_MIN_DAYS, 14);
  });

  it("serves the exact unrounded averages and the true day count", () => {
    const input = rows(30);
    const baseline = priceBaselineFromDailyExtremes(input);
    const sumMin = input.reduce((total, r) => total + r.day_min, 0);
    const sumMax = input.reduce((total, r) => total + r.day_max, 0);
    assert.deepEqual(Object.keys(baseline).sort(), [
      "avg_daily_max_30d",
      "avg_daily_min_30d",
      "days",
    ]);
    assert.equal(baseline.days, 30);
    assert.equal(baseline.avg_daily_min_30d, sumMin / 30);
    assert.equal(baseline.avg_daily_max_30d, sumMax / 30);
    // Round nothing: the exact value has more than two decimals.
    assert.notEqual(
      baseline.avg_daily_min_30d,
      Math.round(baseline.avg_daily_min_30d * 100) / 100
    );
  });

  it("serves null anchors with the true day count below the minimum days", () => {
    assert.deepEqual(priceBaselineFromDailyExtremes(rows(13)), {
      avg_daily_min_30d: null,
      avg_daily_max_30d: null,
      days: 13,
    });
    assert.deepEqual(priceBaselineFromDailyExtremes([]), {
      avg_daily_min_30d: null,
      avg_daily_max_30d: null,
      days: 0,
    });
  });

  it("serves the averages from exactly the minimum day count", () => {
    const baseline = priceBaselineFromDailyExtremes(rows(BASELINE_MIN_DAYS));
    assert.equal(baseline.days, BASELINE_MIN_DAYS);
    assert.equal(typeof baseline.avg_daily_min_30d, "number");
    assert.equal(typeof baseline.avg_daily_max_30d, "number");
  });
});

describe("fetchPriceBaseline", () => {
  it("queries the last 30 completed local days, excluding the running day", async () => {
    let captured = null;
    const baseline = await fetchPriceBaseline(async (fromMs, toMs) => {
      captured = { fromMs, toMs };
      return rows(30);
    });
    const todayKey = localDateKey(new Date());
    // The window ends at today's local midnight (exclusive), so the
    // still-running day never contributes, and starts at the local
    // midnight 30 days back.
    assert.equal(captured.toMs, localDayStartUtcMs(todayKey));
    assert.equal(
      captured.fromMs,
      localDayStartUtcMs(nextDateKey(todayKey, -BASELINE_WINDOW_DAYS))
    );
    assert.equal(baseline.days, 30);
    assert.equal(typeof baseline.avg_daily_min_30d, "number");
  });

  it("serves null anchors without throwing when the query fails", async () => {
    const baseline = await fetchPriceBaseline(async () => {
      throw new Error("database unavailable");
    });
    assert.deepEqual(baseline, {
      avg_daily_min_30d: null,
      avg_daily_max_30d: null,
      days: 0,
    });
  });

  it("folds a successful query into the payload shape", async () => {
    const input = rows(20);
    const baseline = await fetchPriceBaseline(async () => input);
    const sumMin = input.reduce((total, r) => total + r.day_min, 0);
    const sumMax = input.reduce((total, r) => total + r.day_max, 0);
    assert.equal(baseline.days, 20);
    assert.equal(baseline.avg_daily_min_30d, sumMin / 20);
    assert.equal(baseline.avg_daily_max_30d, sumMax / 20);
  });
});
