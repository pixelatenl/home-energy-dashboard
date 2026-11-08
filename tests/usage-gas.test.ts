import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GasInterval, GasUsageData } from "../src/lib/api.ts";
import { knownGasCost } from "../src/lib/gasCard.ts";
import {
  gasAxisLabel,
  gasChartSlots,
  gasSlotBarValue,
  gasSlotCostLabel,
  gasSlotKey,
  gasSlotLabel,
  gasSlotPriceLabel,
  gasStatFigures,
  gasWindowEmpty,
  gasWindowTotals,
  signedM3,
} from "../src/lib/usageGas.ts";

// The Usage tab's gas view models: the Gas/heating stat card's figures
// (docs/spec.md section 7.1) and the gas slot chart's slot series
// (docs/spec.md section 8.1), both fed by /api/heat/gas responses.
// The unknown-price rule renders the dash placeholder, never 0.

interface SeriesInput {
  ts: string;
  m3: number;
  price_eur_per_m3: number | null;
  cost_eur: number | null;
}

// A minimal gas response payload with the given window, granularity,
// series and totals.
function gasData({
  granularity,
  windowStart,
  windowEnd,
  series = [],
  totals,
}: {
  granularity: "hour" | "day" | "month";
  windowStart: string;
  windowEnd: string;
  series?: SeriesInput[];
  totals?: { m3: number; cost_eur: number; hasUnknownPrice: boolean };
}): GasUsageData {
  const totalM3 =
    totals?.m3 ?? series.reduce((sum, interval) => sum + interval.m3, 0);
  return {
    window: { start: windowStart, end: windowEnd },
    granularity,
    series: series as GasInterval[],
    totals: totals ?? {
      m3: totalM3,
      cost_eur: series.reduce(
        (sum, interval) => sum + (interval.cost_eur ?? 0),
        0,
      ),
      hasUnknownPrice: false,
    },
    meta: { note: "Gas day totals miss roughly the first half hour after midnight" },
  };
}

describe("knownGasCost / gasWindowTotals: the honest unknown price", () => {
  it("returns the cost when the price is known", () => {
    assert.equal(knownGasCost({ cost_eur: 3.1, hasUnknownPrice: false }), 3.1);
  });

  it("returns null when hasUnknownPrice is true, never 0", () => {
    assert.equal(knownGasCost({ cost_eur: 0, hasUnknownPrice: true }), null);
    assert.equal(knownGasCost({ cost_eur: 2.5, hasUnknownPrice: true }), null);
  });

  it("returns null for a missing or non-finite cost", () => {
    assert.equal(knownGasCost(null), null);
    assert.equal(knownGasCost({ cost_eur: Number.NaN, hasUnknownPrice: false }), null);
    assert.equal(
      knownGasCost({ cost_eur: Number.POSITIVE_INFINITY, hasUnknownPrice: false }),
      null,
    );
  });

  it("maps a window's totals to m3 plus the known cost", () => {
    const data = gasData({
      granularity: "hour",
      windowStart: "2026-10-20T00:00:00+02:00",
      windowEnd: "2026-10-21T00:00:00+02:00",
      totals: { m3: 2.5, cost_eur: 3.1, hasUnknownPrice: false },
    });
    assert.deepEqual(gasWindowTotals(data), { m3: 2.5, costEur: 3.1 });
    assert.equal(gasWindowTotals(null), null);
  });

  it("keeps the m3 but nulls the cost on an unknown-price window", () => {
    const data = gasData({
      granularity: "hour",
      windowStart: "2026-10-20T00:00:00+02:00",
      windowEnd: "2026-10-21T00:00:00+02:00",
      totals: { m3: 2.5, cost_eur: 0, hasUnknownPrice: true },
    });
    assert.deepEqual(gasWindowTotals(data), { m3: 2.5, costEur: null });
  });
});

describe("signedM3: the delta line's signed m3", () => {
  it("signs positive and negative deltas", () => {
    assert.equal(signedM3(2.5), "+2.50 m\u00b3");
    assert.equal(signedM3(-0.125), "\u22120.13 m\u00b3");
    assert.equal(signedM3(0), "+0.00 m\u00b3");
  });
});

describe("gasWindowEmpty: the honest empty window", () => {
  it("is empty only for a loaded window without intervals", () => {
    assert.equal(
      gasWindowEmpty(
        gasData({
          granularity: "day",
          windowStart: "2026-10-01T00:00:00+02:00",
          windowEnd: "2026-11-01T00:00:00+01:00",
          series: [],
        }),
      ),
      true,
    );
    assert.equal(
      gasWindowEmpty(
        gasData({
          granularity: "day",
          windowStart: "2026-10-01T00:00:00+02:00",
          windowEnd: "2026-11-01T00:00:00+01:00",
          series: [
            {
              ts: "2026-09-30T22:00:00.000Z",
              m3: 1,
              price_eur_per_m3: 1.2,
              cost_eur: 1.2,
            },
          ],
        }),
      ),
      false,
    );
    assert.equal(gasWindowEmpty(null), false);
  });
});

describe("gasStatFigures: the Gas/heating stat's mode-aware figures", () => {
  const current = gasData({
    granularity: "day",
    windowStart: "2026-10-12T00:00:00+02:00",
    windowEnd: "2026-10-19T00:00:00+02:00",
    totals: { m3: 12.5, cost_eur: 15.25, hasUnknownPrice: false },
  });
  const previous = gasData({
    granularity: "day",
    windowStart: "2026-10-05T00:00:00+02:00",
    windowEnd: "2026-10-12T00:00:00+02:00",
    totals: { m3: 10, cost_eur: 12, hasUnknownPrice: false },
  });

  it("leads with m3 and carries the cost beneath in energy mode", () => {
    const figures = gasStatFigures(current, previous, "energy");
    assert.equal(figures.headline, "12.50 m\u00b3");
    assert.equal(figures.secondary, "\u20ac15.25");
    assert.equal(figures.deltaM3, "+2.50 m\u00b3");
    assert.equal(figures.deltaCost, "+\u20ac3.25");
  });

  it("leads with the cost and carries the m3 beneath in cost mode", () => {
    const figures = gasStatFigures(current, previous, "cost");
    assert.equal(figures.headline, "\u20ac15.25");
    assert.equal(figures.secondary, "12.50 m\u00b3");
    assert.equal(figures.deltaM3, "+2.50 m\u00b3");
    assert.equal(figures.deltaCost, "+\u20ac3.25");
  });

  it("signs a negative delta with the minus sign", () => {
    const figures = gasStatFigures(previous, current, "energy");
    assert.equal(figures.deltaM3, "\u22122.50 m\u00b3");
    assert.equal(figures.deltaCost, "\u2212\u20ac3.25");
  });

  it("reads the cost as the dash, never 0, when the current window's price is unknown", () => {
    const unknown = gasData({
      granularity: "day",
      windowStart: "2026-10-12T00:00:00+02:00",
      windowEnd: "2026-10-19T00:00:00+02:00",
      totals: { m3: 12.5, cost_eur: 0, hasUnknownPrice: true },
    });
    const energy = gasStatFigures(unknown, previous, "energy");
    assert.equal(energy.headline, "12.50 m\u00b3");
    assert.equal(energy.secondary, "\u2014");
    assert.equal(energy.deltaCost, "\u2014");
    const cost = gasStatFigures(unknown, previous, "cost");
    assert.equal(cost.headline, "\u2014");
    assert.equal(cost.secondary, "12.50 m\u00b3");
    assert.equal(cost.deltaCost, "\u2014");
  });

  it("shows the cost delta only when both windows have a known price", () => {
    const previousUnknown = gasData({
      granularity: "day",
      windowStart: "2026-10-05T00:00:00+02:00",
      windowEnd: "2026-10-12T00:00:00+02:00",
      totals: { m3: 10, cost_eur: 0, hasUnknownPrice: true },
    });
    const figures = gasStatFigures(current, previousUnknown, "energy");
    assert.equal(figures.deltaM3, "+2.50 m\u00b3");
    assert.equal(figures.deltaCost, "\u2014");
  });

  it("reads both deltas as the dash when the previous fetch failed", () => {
    const figures = gasStatFigures(current, null, "energy");
    assert.equal(figures.headline, "12.50 m\u00b3");
    assert.equal(figures.secondary, "\u20ac15.25");
    assert.equal(figures.deltaM3, "\u2014");
    assert.equal(figures.deltaCost, "\u2014");
  });

  it("renders all dashes when the current fetch failed", () => {
    assert.deepEqual(gasStatFigures(null, previous, "cost"), {
      headline: "\u2014",
      secondary: "\u2014",
      deltaM3: "\u2014",
      deltaCost: "\u2014",
    });
  });
});

describe("gasSlotKey: the join key per granularity", () => {
  it("keys hours by the UTC hour start", () => {
    assert.equal(
      gasSlotKey("2026-10-19T22:30:00.000Z", "hour"),
      String(Date.parse("2026-10-19T22:00:00.000Z")),
    );
  });

  it("keys days by the local date and months by YYYY-MM", () => {
    assert.equal(gasSlotKey("2026-10-13T22:00:00.000Z", "day"), "2026-10-14");
    assert.equal(gasSlotKey("2026-02-28T23:00:00.000Z", "month"), "2026-03");
  });
});

describe("gasChartSlots: the slot mapping per period", () => {
  it("emits 24 hourly slots for a day and joins the series by hour", () => {
    const data = gasData({
      granularity: "hour",
      windowStart: "2026-10-20T00:00:00+02:00",
      windowEnd: "2026-10-21T00:00:00+02:00",
      series: [
        {
          ts: "2026-10-19T22:00:00.000Z",
          m3: 1.5,
          price_eur_per_m3: 1.2,
          cost_eur: 1.8,
        },
        {
          ts: "2026-10-20T03:00:00.000Z",
          m3: 0.4,
          price_eur_per_m3: 1.3,
          cost_eur: 0.52,
        },
      ],
    });
    const slots = gasChartSlots(data);
    assert.equal(slots.length, 24);
    assert.equal(slots[0].hasData, true);
    assert.equal(slots[0].m3, 1.5);
    assert.equal(slots[0].costEur, 1.8);
    assert.equal(slots[5].hasData, true);
    assert.equal(slots[5].m3, 0.4);
    assert.equal(slots[1].hasData, false);
    assert.equal(slots[1].m3, 0);
    assert.equal(slots[1].costEur, null);
  });

  it("emits 25 hourly slots on a DST fall-back day", () => {
    const data = gasData({
      granularity: "hour",
      windowStart: "2026-10-25T00:00:00+02:00",
      windowEnd: "2026-10-26T00:00:00+01:00",
    });
    assert.equal(gasChartSlots(data).length, 25);
  });

  it("emits 7 daily slots for a week", () => {
    const data = gasData({
      granularity: "day",
      windowStart: "2026-10-12T00:00:00+02:00",
      windowEnd: "2026-10-19T00:00:00+02:00",
      series: [
        {
          ts: "2026-10-13T22:00:00.000Z",
          m3: 2,
          price_eur_per_m3: 1.1,
          cost_eur: 2.2,
        },
      ],
    });
    const slots = gasChartSlots(data);
    assert.equal(slots.length, 7);
    assert.equal(slots[2].hasData, true);
    assert.equal(slots[2].m3, 2);
    assert.equal(slots[0].hasData, false);
  });

  it("emits one slot per calendar day for a month, the days ahead empty", () => {
    const series = Array.from(
      { length: 10 },
      (_, day) =>
        ({
          // Oct 1..10 local midnight, as the server's daily buckets
          // serialize them (UTC instants).
          ts: new Date(Date.UTC(2026, 8, 30, 22) + day * 86_400_000).toISOString(),
          m3: 1,
          price_eur_per_m3: 1.2,
          cost_eur: 1.2,
        }) as SeriesInput,
    );
    const data = gasData({
      granularity: "day",
      windowStart: "2026-10-01T00:00:00+02:00",
      windowEnd: "2026-11-01T00:00:00+01:00",
      series,
    });
    const slots = gasChartSlots(data);
    assert.equal(slots.length, 31);
    assert.equal(slots[0].hasData, true);
    assert.equal(slots[9].hasData, true);
    // The days ahead sit on the axis without a bar.
    assert.equal(slots[10].hasData, false);
    assert.equal(slots[10].m3, 0);
    assert.equal(slots[10].costEur, null);
    assert.equal(slots[30].hasData, false);
  });

  it("emits 12 monthly slots for a year and joins by YYYY-MM", () => {
    const data = gasData({
      granularity: "month",
      windowStart: "2026-01-01T00:00:00+01:00",
      windowEnd: "2027-01-01T00:00:00+01:00",
      series: [
        {
          ts: "2026-02-28T23:00:00.000Z",
          m3: 120,
          price_eur_per_m3: 1.25,
          cost_eur: 150,
        },
      ],
    });
    const slots = gasChartSlots(data);
    assert.equal(slots.length, 12);
    assert.equal(slots[2].hasData, true);
    assert.equal(slots[2].m3, 120);
    assert.equal(slots[2].costEur, 150);
    assert.equal(slots[0].hasData, false);
  });
});

describe("the gas chart's per-slot rules", () => {
  const slot = {
    ts: "2026-10-19T22:00:00.000Z",
    m3: 1.5,
    costEur: null,
    priceEurPerM3: null,
    hasData: true,
  };

  it("bars the m3 in energy mode and the cost in cost mode", () => {
    assert.equal(gasSlotBarValue(slot, "energy"), 1.5);
    assert.equal(gasSlotBarValue({ ...slot, costEur: 1.8 }, "cost"), 1.8);
  });

  it("gives a slot without its price row no bar, never a 0 cost", () => {
    assert.equal(gasSlotBarValue(slot, "cost"), 0);
    assert.equal(gasSlotCostLabel(slot), "\u2014");
    assert.equal(gasSlotPriceLabel(slot), "\u2014");
    assert.equal(gasSlotCostLabel({ ...slot, costEur: 1.8 }), "\u20ac1.80");
    assert.equal(
      gasSlotPriceLabel({ ...slot, priceEurPerM3: 1.2345 }),
      "\u20ac1.2345/m\u00b3",
    );
  });
});

describe("the gas chart's labels", () => {
  const day = gasChartSlots(
    gasData({
      granularity: "hour",
      windowStart: "2026-10-20T00:00:00+02:00",
      windowEnd: "2026-10-21T00:00:00+02:00",
    }),
  );

  it("labels an hour slot HH:00 local and the axis every third hour", () => {
    assert.equal(gasSlotLabel(day[5], "hour"), "05:00");
    assert.equal(gasAxisLabel(day[0], 0, "hour"), "00");
    assert.equal(gasAxisLabel(day[1], 1, "hour"), "");
    assert.equal(gasAxisLabel(day[3], 3, "hour"), "03");
  });

  it("labels a day slot with its weekday and day, the axis the first weekday then day numbers", () => {
    const week = gasChartSlots(
      gasData({
        granularity: "day",
        windowStart: "2026-10-12T00:00:00+02:00",
        windowEnd: "2026-10-19T00:00:00+02:00",
      }),
    );
    assert.equal(gasSlotLabel(week[2], "day"), "Wed 14 Oct");
    assert.equal(gasAxisLabel(week[0], 0, "day"), "Mon");
    assert.equal(gasAxisLabel(week[2], 2, "day"), "14");
  });

  it("labels a month slot with the month name, the axis its abbreviation", () => {
    const year = gasChartSlots(
      gasData({
        granularity: "month",
        windowStart: "2026-01-01T00:00:00+01:00",
        windowEnd: "2027-01-01T00:00:00+01:00",
      }),
    );
    assert.equal(gasSlotLabel(year[2], "month"), "March");
    assert.equal(gasAxisLabel(year[2], 2, "month"), "Mar");
  });
});
