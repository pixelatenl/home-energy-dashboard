import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicablePrice,
  assembleProduction,
  dailyProductionIntervals,
  hourlyProductionIntervals,
  SOLAR_DATA_START,
} from "../server/solar-production.mjs";

// A continuous-aggregate bucket row and a price row, in the shapes
// the SQL layer returns.
const bucket = (iso, kwh) => ({ bucket: new Date(iso), kwh });
const price = (iso, eur) => ({ ts: new Date(iso), price_eur: eur });

// Prices for a two-hour window: 0.10 then 0.30 EUR/kWh.
const PRICES = [price("2026-10-10T22:00:00Z", 0.1), price("2026-10-10T23:00:00Z", 0.3)];

describe("applicablePrice: the hour's price with the gas fallback", () => {
  it("takes the hour's own price row", () => {
    assert.equal(applicablePrice(PRICES, new Date("2026-10-10T22:00:00Z").getTime()), 0.1);
    assert.equal(applicablePrice(PRICES, new Date("2026-10-10T23:00:00Z").getTime()), 0.3);
  });

  it("falls back to the last known earlier price", () => {
    assert.equal(applicablePrice(PRICES, new Date("2026-10-11T00:00:00Z").getTime()), 0.3);
  });

  it("is null before any price exists", () => {
    assert.equal(applicablePrice(PRICES, new Date("2026-10-10T21:00:00Z").getTime()), null);
  });
});

describe("hourlyProductionIntervals: bottom-up per interval", () => {
  it("prices each interval at its own hour's price, never an average", () => {
    const rows = [
      bucket("2026-10-10T22:00:00Z", 0.5),
      bucket("2026-10-10T23:00:00Z", 1.0),
    ];
    const { totals } = assembleProduction(
      hourlyProductionIntervals(rows, PRICES)
    );
    // Bottom-up: 0.5 x 0.10 + 1.0 x 0.30 = 0.35, not 1.5 x average.
    assert.equal(totals.avoidedCostEur, 0.35);
  });

  it("costs null, never 0, when no price is known", () => {
    const rows = [bucket("2026-10-10T21:00:00Z", 0.4)];
    const { series, totals } = assembleProduction(
      hourlyProductionIntervals(rows, PRICES)
    );
    assert.equal(series[0].avoidedCostEur, null);
    assert.equal(totals.hasUnknownPrice, true);
    assert.equal(totals.kwh, 0.4);
    assert.equal(totals.avoidedCostEur, 0);
  });
});

describe("dailyProductionIntervals: kWh from the daily aggregate, cost bottom-up", () => {
  const dayRows = [bucket("2026-10-10T00:00:00Z", 1.5)];
  const hourRows = [
    bucket("2026-10-10T22:00:00Z", 0.5),
    bucket("2026-10-10T23:00:00Z", 1.0),
  ];

  it("sums the day's hours at their own prices, never the day total x one price", () => {
    const [day] = dailyProductionIntervals(dayRows, hourRows, PRICES);
    assert.equal(day.kwh, 1.5);
    assert.equal(Math.round(day.costEur * 100) / 100, 0.35);
  });

  it("costs null when a producing hour has no known price", () => {
    // One priced hour, one before the price history starts.
    const hours = [
      bucket("2026-10-10T21:00:00Z", 0.4),
      bucket("2026-10-10T23:00:00Z", 1.0),
    ];
    const [day] = dailyProductionIntervals(dayRows, hours, PRICES);
    assert.equal(day.costEur, null);
  });

  it("costs a producing day with no hourly buckets null", () => {
    const [day] = dailyProductionIntervals(dayRows, [], PRICES);
    assert.equal(day.costEur, null);
  });

  it("costs a zero-production day zero", () => {
    const [day] = dailyProductionIntervals(
      [bucket("2026-10-10T00:00:00Z", 0)],
      [],
      PRICES
    );
    assert.equal(day.costEur, 0);
  });
});

describe("assembleProduction: series, totals and peak", () => {
  it("sums the series exactly and picks the peak interval", () => {
    const intervals = [
      { tsMs: new Date("2026-10-10T22:00:00Z").getTime(), kwh: 0.512, costEur: 0.0512 },
      { tsMs: new Date("2026-10-10T23:00:00Z").getTime(), kwh: 1.004, costEur: 0.3012 },
    ];
    const { series, totals, peak } = assembleProduction(intervals);
    assert.equal(series[0].kwh, 0.512);
    assert.equal(series[0].avoidedCostEur, 0.05);
    assert.equal(totals.kwh, 1.516);
    assert.equal(totals.avoidedCostEur, 0.35);
    assert.equal(totals.hasUnknownPrice, false);
    assert.equal(peak.kwh, 1.004);
    assert.equal(peak.ts, series[1].ts);
  });

  it("returns the honest empty state for a window before the data start", () => {
    const { series, totals, peak } = assembleProduction([]);
    assert.deepEqual(series, []);
    assert.deepEqual(totals, { kwh: 0, avoidedCostEur: 0, hasUnknownPrice: false });
    assert.equal(peak, null);
    assert.equal(SOLAR_DATA_START, "2026-10-10");
  });
});
