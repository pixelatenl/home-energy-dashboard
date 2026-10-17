import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleBatteryFlow,
  dailyBatteryFlow,
  hourlyBatteryFlow,
  monthlyBatteryFlow,
  BATTERY_DATA_START,
} from "../server/battery-flow.mjs";

// A continuous-aggregate bucket row and a price row, in the shapes
// the SQL layer returns.
// Product comparisons use a tolerance: the pure layer does not
// round, so hour prices are raw float products.
const almost = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

const bucket = (iso, kwh) => ({ bucket: new Date(iso), kwh });
const price = (iso, eur) => ({ ts: new Date(iso), price_eur: eur });

// Prices for a two-hour window: 0.10 then 0.30 EUR/kWh.
const PRICES = [price("2026-10-10T22:00:00Z", 0.1), price("2026-10-10T23:00:00Z", 0.3)];

describe("hourlyBatteryFlow: the hour union priced bottom-up", () => {
  it("unions the two counters' hours, pricing each at its own hour's price", () => {
    const hours = hourlyBatteryFlow(
      [bucket("2026-10-10T22:00:00Z", 0.5)],
      [bucket("2026-10-10T22:00:00Z", 0.2), bucket("2026-10-10T23:00:00Z", 1.0)],
      PRICES
    );
    assert.equal(hours.length, 2);
    assert.equal(hours[0].inKwh, 0.5);
    assert.equal(hours[0].outKwh, 0.2);
    // Both flows of one hour share that hour's price.
    almost(hours[0].inCostEur, 0.05);
    almost(hours[0].outValueEur, 0.02);
    assert.equal(hours[1].inKwh, 0);
    assert.equal(hours[1].outKwh, 1.0);
    assert.equal(hours[1].outValueEur, 0.3);
  });

  it("falls back to the last known earlier price", () => {
    const hours = hourlyBatteryFlow(
      [bucket("2026-10-11T10:00:00Z", 0.4)],
      [],
      PRICES
    );
    almost(hours[0].inCostEur, 0.4 * 0.3);
  });

  it("costs null, never 0, when flow has no known price; nothing carried is a true 0", () => {
    // Before any price row: a charging hour reads null cost; a
    // discharge-only hour still prices its (absent) charge as a true
    // 0 and its value as null.
    const hours = hourlyBatteryFlow(
      [bucket("2026-10-09T21:00:00Z", 0.4)],
      [bucket("2026-10-09T20:00:00Z", 0.6)],
      PRICES
    );
    assert.equal(hours[1].inCostEur, null);
    assert.equal(hours[0].inKwh, 0);
    assert.equal(hours[0].inCostEur, 0);
    assert.equal(hours[0].outValueEur, null);
  });
});

describe("dailyBatteryFlow: local-day aggregation", () => {
  const hours = hourlyBatteryFlow(
    [
      bucket("2026-10-16T22:00:00Z", 0.5),
      bucket("2026-10-17T07:00:00Z", 1.0),
    ],
    [bucket("2026-10-16T22:00:00Z", 0.3)],
    [
      price("2026-10-16T22:00:00Z", 0.2),
      price("2026-10-17T07:00:00Z", 0.4),
    ]
  );

  it("groups by local day, so a midnight-crossing hour rides its local day", () => {
    // 22:00Z on 2026-10-16 is local midnight of 2026-10-17: both
    // hours belong to local day 2026-10-17, one interval.
    const days = dailyBatteryFlow(hours);
    assert.equal(days.length, 1);
    assert.equal(days[0].inKwh, 1.5);
    assert.equal(days[0].outKwh, 0.3);
    almost(days[0].inCostEur, 0.5 * 0.2 + 1.0 * 0.4);
    almost(days[0].outValueEur, 0.3 * 0.2);
    // The day bucket's ts is the local midnight.
    assert.equal(
      days[0].tsMs,
      new Date("2026-10-16T22:00:00Z").getTime()
    );
  });

  it("keeps an unknown cost from nulling a known value, and vice versa", () => {
    // Day one: charged with a known price, discharged before any
    // price row (value unknown). Day two: both priced.
    const days = dailyBatteryFlow(
      hourlyBatteryFlow(
        [bucket("2026-10-11T07:00:00Z", 0.5), bucket("2026-10-12T07:00:00Z", 1.0)],
        [bucket("2026-10-10T23:00:00Z", 0.7)],
        [price("2026-10-11T07:00:00Z", 0.3), price("2026-10-12T07:00:00Z", 0.3)]
      )
    );
    assert.equal(days.length, 2);
    // Local day 2026-10-11: the discharge hour (23:00Z on 10-10 is
    // 01:00 local 10-11) precedes the first price row.
    almost(days[0].inCostEur, 0.15);
    assert.equal(days[0].outValueEur, null);
    almost(days[1].inCostEur, 0.3);
    assert.equal(days[1].outValueEur, 0);
  });
});

describe("monthlyBatteryFlow: the year's month roll-up", () => {
  it("groups the days per local month, keyed at each month's first midnight", () => {
    const days = dailyBatteryFlow(
      hourlyBatteryFlow(
        [
          bucket("2026-10-11T07:00:00Z", 0.5),
          bucket("2026-10-12T07:00:00Z", 1.0),
          bucket("2026-11-02T07:00:00Z", 2.0),
        ],
        [],
        [price("2026-10-11T00:00:00Z", 0.3), price("2026-11-02T00:00:00Z", 0.2)]
      )
    );
    const months = monthlyBatteryFlow(days);
    assert.equal(months.length, 2);
    assert.equal(months[0].inKwh, 1.5);
    almost(months[0].inCostEur, 0.45);
    assert.equal(months[1].inKwh, 2.0);
    almost(months[1].inCostEur, 0.4);
    // The month bucket's ts is its calendar month's first local
    // midnight, not the data's first day.
    assert.equal(
      months[0].tsMs,
      new Date("2026-09-30T22:00:00Z").getTime()
    );
  });
});

describe("assembleBatteryFlow: series and totals", () => {
  const interval = (tsMs, inKwh, outKwh, inCost, outValue) => ({
    tsMs,
    inKwh,
    outKwh,
    inCostEur: inCost,
    outValueEur: outValue,
  });

  it("rounds the series and sums it bottom-up, with the arbitrage", () => {
    const { series, totals } = assembleBatteryFlow([
      interval(new Date("2026-10-11T07:00:00Z").getTime(), 0.512, 0.204, 0.1536, 0.0612),
      interval(new Date("2026-10-11T08:00:00Z").getTime(), 1.004, 0, 0.3012, 0),
    ]);
    assert.equal(series[0].in_kwh, 0.512);
    assert.equal(series[0].in_cost_eur, 0.15);
    assert.equal(totals.charged_kwh, 1.516);
    assert.equal(totals.discharged_kwh, 0.204);
    assert.equal(totals.net_kwh, 1.312);
    assert.equal(totals.charge_cost_eur, 0.45);
    assert.equal(totals.discharge_value_eur, 0.06);
    assert.equal(totals.arbitrage_eur, -0.39);
  });

  it("nulls a money total when any flowing interval lacks its price, never a silent 0", () => {
    const { totals } = assembleBatteryFlow([
      interval(new Date("2026-10-11T07:00:00Z").getTime(), 0.5, 0.2, null, null),
      interval(new Date("2026-10-11T08:00:00Z").getTime(), 1.0, 0.1, 0.3, 0.03),
    ]);
    assert.equal(totals.charged_kwh, 1.5);
    assert.equal(totals.charge_cost_eur, null);
    assert.equal(totals.discharge_value_eur, null);
    assert.equal(totals.arbitrage_eur, null);
  });

  it("keeps the two money dimensions independent", () => {
    const { totals } = assembleBatteryFlow([
      interval(new Date("2026-10-11T07:00:00Z").getTime(), 0.5, 0.2, 0.15, null),
    ]);
    assert.equal(totals.charge_cost_eur, 0.15);
    assert.equal(totals.discharge_value_eur, null);
    assert.equal(totals.arbitrage_eur, null);
  });

  it("returns the honest empty state before the data start", () => {
    const { series, totals } = assembleBatteryFlow([]);
    assert.deepEqual(series, []);
    assert.deepEqual(totals, {
      charged_kwh: 0,
      discharged_kwh: 0,
      net_kwh: 0,
      charge_cost_eur: 0,
      discharge_value_eur: 0,
      arbitrage_eur: 0,
    });
    assert.equal(BATTERY_DATA_START, "2026-10-11");
  });
});
