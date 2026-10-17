import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicablePrice,
  assembleProduction,
  dailyProductionIntervals,
  feedInTariffEur,
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

describe("feedInTariffEur: the flat export rate from the environment", () => {
  const withEnv = (value, fn) => () => {
    const saved = process.env.EMS_FEED_IN_TARIFF_EUR;
    if (value === undefined) {
      delete process.env.EMS_FEED_IN_TARIFF_EUR;
    } else {
      process.env.EMS_FEED_IN_TARIFF_EUR = value;
    }
    try {
      fn();
    } finally {
      if (saved === undefined) {
        delete process.env.EMS_FEED_IN_TARIFF_EUR;
      } else {
        process.env.EMS_FEED_IN_TARIFF_EUR = saved;
      }
    }
  };

  it("reads a positive tariff", () => {
    withEnv("0.12", () => {
      assert.equal(feedInTariffEur(), 0.12);
    })();
  });

  it("treats unset, empty, zero and invalid values as not configured", () => {
    for (const value of [undefined, "", "0", "0.00", "abc", "-0.1"]) {
      withEnv(value, () => {
        assert.equal(feedInTariffEur(), null);
      })();
    }
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
    assert.equal(series[0].selfConsumptionAvoidedCostEur, null);
    assert.equal(totals.hasUnknownPrice, true);
    assert.equal(totals.kwh, 0.4);
    assert.equal(totals.avoidedCostEur, 0);
  });

  it("carries the hour's split and prices the home share at the same price", () => {
    const rows = [
      bucket("2026-10-10T22:00:00Z", 0.5),
      bucket("2026-10-10T23:00:00Z", 1.0),
    ];
    // Hour one: 0.3 of the 0.5 to home, 0.2 to grid. Hour two: 1.0
    // split 0.4 home / 0.6 battery.
    const splitByTs = new Map([
      [
        new Date("2026-10-10T22:00:00Z").getTime(),
        { solarToHomeKwh: 0.3, solarToGridKwh: 0.2, solarToBatteryKwh: 0 },
      ],
      [
        new Date("2026-10-10T23:00:00Z").getTime(),
        { solarToHomeKwh: 0.4, solarToGridKwh: 0, solarToBatteryKwh: 0.6 },
      ],
    ]);
    const { series, totals } = assembleProduction(
      hourlyProductionIntervals(rows, PRICES, splitByTs)
    );
    assert.equal(series[0].solarToHomeKwh, 0.3);
    assert.equal(series[0].solarToGridKwh, 0.2);
    assert.equal(series[0].solarToBatteryKwh, 0);
    // The self-consumed cost is bottom-up at the hour's own price:
    // 0.3 x 0.10, never the avoided cost's share of an average.
    assert.equal(series[0].selfConsumptionAvoidedCostEur, 0.03);
    assert.equal(series[1].selfConsumptionAvoidedCostEur, 0.12);
    // Totals: 0.7 kWh self-consumed of 1.5 produced, 0.15 EUR.
    assert.equal(totals.selfConsumedKwh, 0.7);
    assert.equal(totals.selfConsumedShare, 0.467);
    assert.equal(totals.selfConsumptionAvoidedCostEur, 0.15);
  });

  it("reads hours without a split as the zero split", () => {
    const rows = [bucket("2026-10-10T22:00:00Z", 0.5)];
    const { series } = assembleProduction(
      hourlyProductionIntervals(rows, PRICES)
    );
    assert.equal(series[0].solarToHomeKwh, 0);
    assert.equal(series[0].solarToGridKwh, 0);
    assert.equal(series[0].solarToBatteryKwh, 0);
    assert.equal(series[0].selfConsumptionAvoidedCostEur, 0);
  });

  it("carries the export counter's raw kWh, coalescing absent hours to 0", () => {
    const rows = [
      bucket("2026-10-10T22:00:00Z", 0.5),
      bucket("2026-10-10T23:00:00Z", 1.0),
    ];
    const exportByTs = new Map([
      [new Date("2026-10-10T23:00:00Z").getTime(), 0.6],
    ]);
    const [a, b] = hourlyProductionIntervals(
      rows,
      PRICES,
      new Map(),
      exportByTs
    );
    assert.equal(a.exportKwh, 0);
    assert.equal(b.exportKwh, 0.6);
  });

  it("carries a null exportKwh when the export counter is not registered", () => {
    const rows = [bucket("2026-10-10T22:00:00Z", 0.5)];
    const [hour] = hourlyProductionIntervals(rows, PRICES, new Map(), null);
    assert.equal(hour.exportKwh, null);
  });

  it("gives export-only hours their own interval with 0 kWh produced", () => {
    // Evening battery export (21:00Z, after the price rows) rides
    // the export counter in an hour with no PV row: it must not
    // silently drop out of the series, must not flag an unknown
    // price (nothing was produced), and must carry its earnings.
    const rows = [bucket("2026-10-10T22:00:00Z", 0.5)];
    const exportByTs = new Map([
      [new Date("2026-10-11T21:00:00Z").getTime(), 0.6],
    ]);
    const { series, totals } = assembleProduction(
      hourlyProductionIntervals(rows, PRICES, new Map(), exportByTs),
      0.12
    );
    const evening = series[1];
    assert.equal(series.length, 2);
    assert.equal(evening.kwh, 0);
    assert.equal(evening.avoidedCostEur, 0);
    assert.equal(evening.exportKwh, 0.6);
    assert.equal(evening.exportEarningsEur, 0.07);
    assert.equal(totals.exportKwh, 0.6);
    assert.equal(totals.exportEarningsEur, 0.07);
    assert.equal(totals.hasUnknownPrice, false);
  });
});

describe("export earnings: the flat tariff, never the dynamic price", () => {
  const rows = [bucket("2026-10-10T22:00:00Z", 0.5)];
  const exportByTs = new Map([
    [new Date("2026-10-10T22:00:00Z").getTime(), 0.6],
  ]);
  const intervals = () =>
    hourlyProductionIntervals(rows, PRICES, new Map(), exportByTs);

  it("prices the export kWh at the flat tariff, independent of the hour's price", () => {
    // 0.6 kWh exported at a 0.12 EUR/kWh tariff: 0.07 EUR, never the
    // 0.10 grid price the hour itself costs.
    const { series, totals } = assembleProduction(intervals(), 0.12);
    assert.equal(series[0].exportKwh, 0.6);
    assert.equal(series[0].exportEarningsEur, 0.07);
    assert.equal(totals.exportKwh, 0.6);
    assert.equal(totals.exportEarningsEur, 0.07);
  });

  it("earnings stay null, never a silent 0, when the tariff is unset", () => {
    const { series, totals } = assembleProduction(intervals());
    assert.equal(series[0].exportEarningsEur, null);
    // The measured export kWh is still reported.
    assert.equal(series[0].exportKwh, 0.6);
    assert.equal(totals.exportKwh, 0.6);
    assert.equal(totals.exportEarningsEur, null);
    assert.equal(totals.totalCostNetEur, null);
  });

  it("earnings and export kWh stay null when the export counter is not registered", () => {
    const { series, totals } = assembleProduction(
      hourlyProductionIntervals(rows, PRICES, new Map(), null),
      0.12
    );
    assert.equal(series[0].exportKwh, null);
    assert.equal(series[0].exportEarningsEur, null);
    assert.equal(totals.exportKwh, null);
    assert.equal(totals.exportEarningsEur, null);
    assert.equal(totals.totalCostNetEur, null);
  });

  it("combines the self-consumption savings with the export earnings", () => {
    const splitByTs = new Map([
      [
        new Date("2026-10-10T22:00:00Z").getTime(),
        { solarToHomeKwh: 0.3, solarToGridKwh: 0.2, solarToBatteryKwh: 0 },
      ],
    ]);
    const { series, totals } = assembleProduction(
      hourlyProductionIntervals(rows, PRICES, splitByTs, exportByTs),
      0.12
    );
    assert.equal(series[0].selfConsumptionAvoidedCostEur, 0.03);
    assert.equal(series[0].exportEarningsEur, 0.07);
    // Savings plus earnings: 0.03 + 0.07.
    assert.equal(totals.totalCostNetEur, 0.1);
  });
});

describe("dailyProductionIntervals: kWh from the daily aggregate, cost bottom-up", () => {
  // energy_daily buckets are local days: local midnight on 2026-10-11
  // (CEST) is 22:00Z on 2026-10-10, and the local day's hours run from
  // that instant up to (not including) 22:00Z the next day.
  const dayRows = [bucket("2026-10-10T22:00:00Z", 1.5)];
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
    // Local day 2026-10-10 starts at 22:00Z on 2026-10-09; both of its
    // producing hours precede the first price row.
    const hours = [
      bucket("2026-10-09T22:00:00Z", 0.4),
      bucket("2026-10-09T23:00:00Z", 1.0),
    ];
    const [day] = dailyProductionIntervals(
      [bucket("2026-10-09T22:00:00Z", 1.4)],
      hours,
      PRICES
    );
    assert.equal(day.costEur, null);
  });

  it("keeps an hour that crosses local midnight with the day it falls in", () => {
    // 22:00Z on 2026-10-11 is local midnight of 2026-10-12: that hour
    // must not contribute to local day 2026-10-11's cost.
    const hours = [
      ...hourRows,
      bucket("2026-10-11T22:00:00Z", 9.9),
    ];
    const [day] = dailyProductionIntervals(dayRows, hours, PRICES);
    assert.equal(day.kwh, 1.5);
    assert.equal(Math.round(day.costEur * 100) / 100, 0.35);
  });

  it("costs a producing day with no hourly buckets null", () => {
    const [day] = dailyProductionIntervals(dayRows, [], PRICES);
    assert.equal(day.costEur, null);
  });

  it("costs a zero-production day zero", () => {
    const [day] = dailyProductionIntervals(
      [bucket("2026-10-10T22:00:00Z", 0)],
      [],
      PRICES
    );
    assert.equal(day.costEur, 0);
  });

  it("aggregates the local day's hourly split and prices the home share bottom-up", () => {
    // The same day's hours: 0.3 of hour one's 0.5 to home, 0.4 of
    // hour two's 1.0 (the rest charging the battery).
    const splitByDay = new Map([
      [
        "2026-10-11",
        {
          solarToHomeKwh: 0.7,
          solarToGridKwh: 0.2,
          solarToBatteryKwh: 0.6,
          hours: [
            {
              tsMs: new Date("2026-10-10T22:00:00Z").getTime(),
              solarToHomeKwh: 0.3,
            },
            {
              tsMs: new Date("2026-10-10T23:00:00Z").getTime(),
              solarToHomeKwh: 0.4,
            },
          ],
        },
      ],
    ]);
    const [day] = dailyProductionIntervals(
      dayRows,
      hourRows,
      PRICES,
      splitByDay
    );
    assert.equal(day.solarToHomeKwh, 0.7);
    assert.equal(day.solarToGridKwh, 0.2);
    assert.equal(day.solarToBatteryKwh, 0.6);
    // Bottom-up over the day's self-consuming hours: 0.3 x 0.10 +
    // 0.4 x 0.30, never the day's home share times one price.
    assert.equal(Math.round(day.selfConsumedCostEur * 100) / 100, 0.15);
  });

  it("carries null split fields for a producing day the hourly aggregate lagged away", () => {
    const [day] = dailyProductionIntervals(dayRows, [], PRICES);
    assert.equal(day.kwh, 1.5);
    assert.equal(day.solarToHomeKwh, null);
    assert.equal(day.solarToGridKwh, null);
    assert.equal(day.solarToBatteryKwh, null);
    assert.equal(day.selfConsumedCostEur, null);
  });

  it("aggregates the local day's export counter sum, keeping midnight-crossing hours with their day", () => {
    // 22:00Z on 2026-10-11 is local midnight of 2026-10-12: that
    // export hour must not leak into local day 2026-10-11's sum.
    const exportByDay = new Map([
      ["2026-10-11", 0.8],
      ["2026-10-12", 0.4],
    ]);
    const [day] = dailyProductionIntervals(
      dayRows,
      hourRows,
      PRICES,
      new Map(),
      exportByDay
    );
    assert.equal(day.exportKwh, 0.8);
    // The same map priced at a flat tariff: 0.8 x 0.12.
    const { series, totals } = assembleProduction(
      dailyProductionIntervals(dayRows, hourRows, PRICES, new Map(), exportByDay),
      0.12
    );
    assert.equal(series[0].exportEarningsEur, 0.1);
    assert.equal(totals.exportKwh, 0.8);
    assert.equal(totals.exportEarningsEur, 0.1);
  });

  it("reads a day absent from the export series as 0 exported, a null map as unknown", () => {
    const [day] = dailyProductionIntervals(
      dayRows,
      hourRows,
      PRICES,
      new Map(),
      new Map()
    );
    assert.equal(day.exportKwh, 0);
    const [unknown] = dailyProductionIntervals(
      dayRows,
      hourRows,
      PRICES,
      new Map(),
      null
    );
    assert.equal(unknown.exportKwh, null);
  });

  it("costs the self-consumed share null when a self-consuming hour has no known price", () => {
    const splitByDay = new Map([
      [
        "2026-10-10",
        {
          solarToHomeKwh: 0.7,
          solarToGridKwh: 0.2,
          solarToBatteryKwh: 0.5,
          hours: [
            {
              tsMs: new Date("2026-10-09T22:00:00Z").getTime(),
              solarToHomeKwh: 0.4,
            },
          ],
        },
      ],
    ]);
    const [day] = dailyProductionIntervals(
      [bucket("2026-10-09T22:00:00Z", 1.4)],
      [bucket("2026-10-09T22:00:00Z", 1.4)],
      PRICES,
      splitByDay
    );
    assert.equal(day.selfConsumedCostEur, null);
  });
});

describe("assembleProduction: series, totals and peak", () => {
  it("sums the series exactly and picks the peak interval", () => {
    const intervals = [
      {
        tsMs: new Date("2026-10-10T22:00:00Z").getTime(),
        kwh: 0.512,
        costEur: 0.0512,
        solarToHomeKwh: 0.3,
        solarToGridKwh: 0.212,
        solarToBatteryKwh: 0,
        selfConsumedCostEur: 0.030000000000000002,
      },
      {
        tsMs: new Date("2026-10-10T23:00:00Z").getTime(),
        kwh: 1.004,
        costEur: 0.3012,
        solarToHomeKwh: 0.4,
        solarToGridKwh: 0,
        solarToBatteryKwh: 0.604,
        selfConsumedCostEur: 0.12,
      },
    ];
    const { series, totals, peak } = assembleProduction(intervals);
    assert.equal(series[0].kwh, 0.512);
    assert.equal(series[0].avoidedCostEur, 0.05);
    assert.equal(series[0].solarToHomeKwh, 0.3);
    assert.equal(series[0].selfConsumptionAvoidedCostEur, 0.03);
    assert.equal(totals.kwh, 1.516);
    assert.equal(totals.avoidedCostEur, 0.35);
    assert.equal(totals.hasUnknownPrice, false);
    assert.equal(totals.selfConsumedKwh, 0.7);
    assert.equal(totals.selfConsumedShare, 0.462);
    assert.equal(totals.selfConsumptionAvoidedCostEur, 0.15);
    assert.equal(peak.kwh, 1.004);
    assert.equal(peak.ts, series[1].ts);
  });

  it("returns the honest empty state for a window before the data start", () => {
    const { series, totals, peak } = assembleProduction([]);
    assert.deepEqual(series, []);
    assert.deepEqual(totals, {
      kwh: 0,
      avoidedCostEur: 0,
      hasUnknownPrice: false,
      selfConsumedKwh: 0,
      // Null, never 0: nothing was produced, so no share exists.
      selfConsumedShare: null,
      selfConsumptionAvoidedCostEur: 0,
      exportKwh: 0,
      // Null, never 0: no tariff is configured, so no earnings exist.
      exportEarningsEur: null,
      totalCostNetEur: null,
    });
    assert.equal(peak, null);
    assert.equal(SOLAR_DATA_START, "2026-10-10");
  });

  it("excludes unknown self-consumed costs from the total, never the kWh", () => {
    const { totals } = assembleProduction([
      {
        tsMs: new Date("2026-10-10T22:00:00Z").getTime(),
        kwh: 0.5,
        costEur: 0.05,
        solarToHomeKwh: 0.3,
        solarToGridKwh: 0.2,
        solarToBatteryKwh: 0,
        selfConsumedCostEur: null,
      },
      {
        tsMs: new Date("2026-10-10T23:00:00Z").getTime(),
        kwh: 1.0,
        costEur: 0.3,
        solarToHomeKwh: 0.4,
        solarToGridKwh: 0,
        solarToBatteryKwh: 0.6,
        selfConsumedCostEur: 0.12,
      },
    ]);
    assert.equal(totals.kwh, 1.5);
    assert.equal(totals.selfConsumedKwh, 0.7);
    assert.equal(totals.selfConsumptionAvoidedCostEur, 0.12);
  });
});
