import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GasUsageData } from "../src/lib/api.ts";
import {
  formatM3,
  gasCardFigures,
  gasCardView,
  gasCostLabel,
} from "../src/lib/gasCard.ts";

// The Today hub's Gas/heating card view model: the three
// /api/heat/gas responses (day, week, month, all anchored on today)
// mapped to the card's headline, cost and week/month sub-lines.
// Unknown price renders as the dash placeholder, never 0.

// A minimal gas response payload with the given totals.
function gasResponse(
  m3: number,
  costEur: number,
  hasUnknownPrice = false,
): GasUsageData {
  return {
    window: {
      start: "2026-10-20T00:00:00+02:00",
      end: "2026-10-21T00:00:00+02:00",
    },
    granularity: "hour",
    series: [],
    totals: { m3, cost_eur: costEur, hasUnknownPrice },
    meta: { note: "Gas day totals miss roughly the first half hour after midnight" },
  };
}

describe("formatM3: the gas volume's unit format", () => {
  it("formats a volume as cubic meters at two decimals", () => {
    assert.equal(formatM3(2.5), "2.50 m\u00b3");
    assert.equal(formatM3(0), "0.00 m\u00b3");
  });

  it("renders the dash placeholder without a volume", () => {
    assert.equal(formatM3(null), "\u2014");
  });
});

describe("gasCostLabel: today's cost with an honest unknown price", () => {
  it("formats a known cost with the euro sign", () => {
    assert.equal(gasCostLabel({ cost_eur: 3.1, hasUnknownPrice: false }), "\u20ac3.10");
  });

  it("renders the dash, never 0, when hasUnknownPrice is true", () => {
    assert.equal(gasCostLabel({ cost_eur: 0, hasUnknownPrice: true }), "\u2014");
    assert.equal(gasCostLabel({ cost_eur: 2.5, hasUnknownPrice: true }), "\u2014");
  });

  it("renders the dash when the totals are missing or the cost is not a trustworthy number", () => {
    assert.equal(gasCostLabel(null), "\u2014");
    assert.equal(
      gasCostLabel({ cost_eur: Number.NaN, hasUnknownPrice: false }),
      "\u2014",
    );
  });
});

describe("gasCardFigures: the card's figures from the three period responses", () => {
  it("renders the headline, cost and week/month sub-lines from the payload", () => {
    const figures = gasCardFigures(
      gasResponse(2.5, 3.1),
      gasResponse(12.34, 15.2),
      gasResponse(40.001, 49.5),
    );
    assert.equal(figures.headlineM3, "2.50 m\u00b3");
    assert.equal(figures.costLabel, "\u20ac3.10");
    assert.equal(figures.weekM3, "12.34 m\u00b3");
    assert.equal(figures.monthM3, "40.00 m\u00b3");
  });

  it("keeps the week and month figures when the day request failed", () => {
    const figures = gasCardFigures(null, gasResponse(12, 15.2), gasResponse(40, 49.5));
    assert.equal(figures.headlineM3, "\u2014");
    assert.equal(figures.costLabel, "\u2014");
    assert.equal(figures.weekM3, "12.00 m\u00b3");
    assert.equal(figures.monthM3, "40.00 m\u00b3");
  });

  it("renders all dashes when every request failed", () => {
    assert.deepEqual(gasCardFigures(null, null, null), {
      headlineM3: "\u2014",
      costLabel: "\u2014",
      weekM3: "\u2014",
      monthM3: "\u2014",
    });
  });

  it("shows the unknown-price dash for the cost but keeps the m3 headline", () => {
    const figures = gasCardFigures(gasResponse(2.5, 0, true), null, null);
    assert.equal(figures.headlineM3, "2.50 m\u00b3");
    assert.equal(figures.costLabel, "\u2014");
  });
});

describe("gasCardView: the skeleton phase and the settled figures", () => {
  it("reports loading (the skeleton owns the card) until the first load settles", () => {
    assert.equal(
      gasCardView({ day: null, week: null, month: null, status: "loading" })
        .loading,
      true,
    );
  });

  it("reports settled with the payload's figures once the load landed", () => {
    const view = gasCardView({
      day: gasResponse(2.5, 3.1),
      week: gasResponse(12, 15.2),
      month: gasResponse(40, 49.5),
      status: "ok",
    });
    assert.equal(view.loading, false);
    assert.equal(view.headlineM3, "2.50 m\u00b3");
    assert.equal(view.costLabel, "\u20ac3.10");
    assert.equal(view.weekM3, "12.00 m\u00b3");
    assert.equal(view.monthM3, "40.00 m\u00b3");
  });
});
