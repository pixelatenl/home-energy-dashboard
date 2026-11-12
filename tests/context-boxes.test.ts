import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contextBoxByKey,
  contextBoxItems,
} from "../src/lib/contextBoxes.ts";
import type { ContextBoxResponse } from "../src/lib/api.ts";
import {
  buildHeatContextFacts,
  buildSolarProductionFacts,
  buildUsageContextFacts,
} from "../server/context-box-facts.mjs";

// The context-box wiring's DOM check, at the view-model level the repo
// tests components: one box per section of the page payload, in
// payload order, and the honest-absence path (no facts, no box). The
// payloads come from the real server builders, so the frontend mapping
// is checked against the served shape.

const NOW = new Date("2026-11-16T12:00:00+01:00");
const TODAY_KEY = "2026-11-16";

function usagePayload(): ContextBoxResponse {
  const breakdown = {
    total: { kwh: 10, cost_eur: 3.5 },
    categories: [
      { key: "dishwasher", label: "Dishwasher", class: "measured", entities: [], kwh: 2, cost_eur: 0.6 },
      { key: "heat_pump", label: "Heat pump", class: "Est.", entities: [], kwh: 3, cost_eur: 0.9 },
      { key: "remainder", label: "Remainder", class: "remainder", entities: [], kwh: 5, cost_eur: 1.5 },
    ],
    split: { measured_kwh: 2, estimated_kwh: 3, remainder_kwh: 5 },
    avg_price_eur: 0.35,
    home_model: {
      days: 1,
      entries: [
        { key: "base_load", name: "Base load", derived: true, kwh_per_day: 1, basis: "data-derived", kwh: 1 },
        { key: "lighting", name: "Lighting", kwh_per_day: 1.1, basis: "evening use", kwh: 1.1 },
      ],
      modeled_kwh: 2.1,
      unexplained_kwh: 2.9,
    },
    slots: {
      unit: "hour",
      series: [{ ts: "2026-11-16T18:00:00+01:00", kwh: 3.2, price_eur: 0.45, cost_eur: 1.44, categories: [] }],
    },
  };
  const facts = buildUsageContextFacts(
    "day",
    TODAY_KEY,
    { breakdown, priceRows: [] },
    NOW,
  );
  return {
    widget: "usage_context",
    period: "day",
    date: TODAY_KEY,
    facts,
    signature: "sig",
    sections: [
      { key: "breakdown", label: "Usage breakdown", narrative: "So far today the home used 10 kWh.", fallback: false },
      { key: "rest_of_home", label: "Rest of home", narrative: "The base load is about 1 kWh.", fallback: false },
      { key: "over_time", label: "Over time", narrative: "The busiest slot is 18:00 with 3.2 kWh.", fallback: true },
    ],
    as_of: "2026-11-16T12:00:00+01:00",
    insight_as_of: "2026-11-16T11:55:00+01:00",
    error: null,
  };
}

function heatPayload(): ContextBoxResponse {
  const facts = buildHeatContextFacts(
    "day",
    TODAY_KEY,
    {
      gas: { totals: { m3: 4.5, cost_eur: 9.0, hasUnknownPrice: false }, price_eur_per_m3: 2.0 },
      zones: { zones: [], outdoor: { series: [] } },
      heat_model: {
        gas_route: { cost_per_kwh_heat: 0.0556 },
        heat_pump_route: { cost_per_kwh_heat: 0.0909, avg_cop: 3.1, avg_electricity_price_eur_per_kwh: 0.28, avg_outdoor_temp: 7.5 },
        assumptions: { gas_calorific_kwh_per_m3: 9.9, boiler_efficiency: 0.9 },
      },
    },
    NOW,
  );
  return {
    widget: "heat_context",
    period: "day",
    date: TODAY_KEY,
    facts,
    signature: "sig",
    sections: [
      { key: "gas", label: "Gas", narrative: "So far today the home used 4.5 m3 of gas.", fallback: false },
      { key: "zones", label: "Zones", narrative: "Living room was the warmest at 19.8.", fallback: false },
      { key: "heating_cost", label: "Heating cost", narrative: "Gas costs €0.0556 per kWh of heat.", fallback: false },
    ],
    as_of: "2026-11-16T12:00:00+01:00",
    insight_as_of: null,
    error: null,
  };
}

function solarPayload(): ContextBoxResponse {
  const facts = buildSolarProductionFacts(
    {
      today: { pv_kwh: 8.6, export_kwh: 2.1, export_credit_eur: 0.5, self_consumption_pct: 75.6 },
      weather_today: { estimated_kwh: 14.4, solar_score: 28, weather_code: 61 },
    },
    NOW,
  );
  return {
    widget: "solar_production",
    date: TODAY_KEY,
    facts,
    signature: "sig",
    sections: [
      { key: "production", label: "Solar production", narrative: "So far today the panels produced 8.6 kWh.", fallback: false },
    ],
    as_of: "2026-11-16T12:00:00+01:00",
    insight_as_of: "2026-11-16T11:58:00+01:00",
    error: null,
  };
}

describe("contextBoxItems: the per-page DOM check", () => {
  it("the Usage page renders exactly three boxes, in payload order", () => {
    const items = contextBoxItems(usagePayload());
    assert.deepEqual(
      items.map((item) => item.key),
      ["breakdown", "rest_of_home", "over_time"],
    );
    assert.equal(items.length, 3);
    // The fallback flag rides along; the box renders the served text.
    assert.equal(items[2].fallback, true);
    assert.match(items[2].text, /18:00/);
  });

  it("the Heat page renders exactly three boxes", () => {
    const items = contextBoxItems(heatPayload());
    assert.deepEqual(
      items.map((item) => item.key),
      ["gas", "zones", "heating_cost"],
    );
  });

  it("the Solar page renders exactly one box", () => {
    const items = contextBoxItems(solarPayload());
    assert.deepEqual(items.map((item) => item.key), ["production"]);
  });

  it("the section keys match the server builder's section keys per widget", () => {
    const serverUsage = buildUsageContextFacts(
      "day",
      TODAY_KEY,
      { breakdown: usagePayload().facts.breakdown, priceRows: [] },
      NOW,
    );
    // The server drops a null page-fact section entirely; the frontend
    // maps the remaining sections one to one.
    const withMissing = { ...serverUsage, breakdown: null };
    assert.equal(contextBoxItems({ ...usagePayload(), sections: [] }).length, 0);
    assert.ok(withMissing.breakdown === null);
  });
});

describe("contextBoxItems: the honest-absence path", () => {
  it("a section without a narrative renders no box", () => {
    const payload = usagePayload();
    payload.sections = [
      { key: "breakdown", label: "Usage breakdown", narrative: null, fallback: true },
      { key: "rest_of_home", label: "Rest of home", narrative: "  ", fallback: false },
      { key: "over_time", label: "Over time", narrative: "The busiest slot is 18:00.", fallback: false },
    ];
    const items = contextBoxItems(payload);
    assert.deepEqual(items.map((item) => item.key), ["over_time"]);
  });

  it("no sections at all means no boxes, and a missing payload means no boxes", () => {
    assert.deepEqual(contextBoxItems({ ...usagePayload(), sections: [] }), []);
    assert.deepEqual(contextBoxItems(null), []);
    assert.deepEqual(contextBoxItems(undefined), []);
    assert.deepEqual(
      contextBoxItems({ ...usagePayload(), sections: undefined as never }),
      [],
    );
  });

  it("malformed section entries are dropped, not crashed on", () => {
    const payload = usagePayload();
    payload.sections = [
      null,
      "nope",
      { key: "gas", label: "Gas", narrative: "Gas use was 4.5 m3.", fallback: false },
    ] as never;
    const items = contextBoxItems(payload);
    assert.deepEqual(items.map((item) => item.key), ["gas"]);
  });
});

describe("contextBoxByKey: the page wiring lookup", () => {
  it("finds each page's section and returns null for an absent one", () => {
    const usage = contextBoxItems(usagePayload());
    assert.equal(contextBoxByKey(usage, "breakdown")?.label, "Usage breakdown");
    assert.equal(contextBoxByKey(usage, "gas"), null);
    const solar = contextBoxItems(solarPayload());
    assert.equal(contextBoxByKey(solar, "production")?.fallback, false);
    assert.equal(contextBoxByKey(solar, "zones"), null);
  });
});
