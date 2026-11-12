import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContextBoxSections,
  generateContextBoxNarratives,
} from "../server/context-boxes.mjs";
import {
  checkContextBoxConsistency,
  checkContextBoxSection,
  guardVerdictClaim,
} from "../server/context-box-guards.mjs";
import { auditContextBoxText } from "../server/advisory/served-text-audit.mjs";
import {
  buildHeatContextFacts,
  buildSolarProductionFacts,
  buildUsageContextFacts,
} from "../server/context-box-facts.mjs";

// Prompt 5: the debug probes and audits. The peek never calls the
// model (opening debug costs zero Mistral calls), the rejection
// journal mirrors the log lines, the consistency view applies the
// checker rules per box type, and the served-text audit covers the new
// sentence population including the fallback sentences - an audit miss
// fails this runner.

const NOW = new Date("2026-11-16T12:00:00+01:00");
const TODAY_KEY = "2026-11-16";

function usageFacts() {
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
      series: [
        { ts: "2026-11-16T17:00:00+01:00", kwh: 0.2, price_eur: 0.3, cost_eur: 0.06, categories: [] },
        { ts: "2026-11-16T18:00:00+01:00", kwh: 3.2, price_eur: 0.45, cost_eur: 1.44, categories: [] },
      ],
    },
  };
  return buildUsageContextFacts("day", TODAY_KEY, { breakdown, priceRows: [] }, NOW);
}

function heatFacts() {
  // Raw getHeatZones shape: series points plus heating intervals.
  const dayStart = Date.parse("2026-11-16T00:00:00+01:00");
  const point = (hour, temp, setpoint) => ({
    ts: new Date(dayStart + hour * 3_600_000).toISOString(),
    temp,
    setpoint,
  });
  return buildHeatContextFacts(
    "day",
    TODAY_KEY,
    {
      gas: { totals: { m3: 4.5, cost_eur: 9.0, hasUnknownPrice: false }, price_eur_per_m3: 2.0 },
      zones: {
        zones: [
          {
            key: "living",
            name: "Living room",
            series: [point(0, 19.5, 20), point(1, 19.8, 20), point(2, 20.1, 20)],
            heatingIntervals: [
              {
                from: new Date(dayStart).toISOString(),
                to: new Date(dayStart + 2 * 3_600_000).toISOString(),
              },
            ],
          },
        ],
        outdoor: { series: [{ ts: new Date(dayStart).toISOString(), temp: 7.0 }, { ts: new Date(dayStart + 3_600_000).toISOString(), temp: 8.0 }] },
      },
      heat_model: {
        gas_route: { cost_per_kwh_heat: 0.0556 },
        heat_pump_route: { cost_per_kwh_heat: 0.0909, avg_cop: 3.1, avg_electricity_price_eur_per_kwh: 0.28, avg_outdoor_temp: 7.5 },
        assumptions: { gas_calorific_kwh_per_m3: 9.9, boiler_efficiency: 0.9 },
      },
    },
    NOW,
  );
}

function solarFacts() {
  return buildSolarProductionFacts(
    {
      today: { pv_kwh: 8.6, export_kwh: 2.1, export_credit_eur: 0.5, self_consumption_pct: 75.6 },
      weather_today: { estimated_kwh: 14.4, solar_score: 28, weather_code: 61 },
    },
    NOW,
  );
}

function stubReturning(responses) {
  const queue = [...responses];
  const stub = async () => {
    stub.calls += 1;
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  stub.calls = 0;
  return stub;
}

const GOOD = {
  usage_context: JSON.stringify({
    narratives: {
      breakdown: "So far today the home used 10 kWh for €3.50. The heat pump accounts for an estimated 3 kWh of that.",
      rest_of_home: "Of the remaining usage, the base load is about 1 kWh and lighting about 1.1 kWh. 2.9 kWh is real usage of unnamed appliances, not an error.",
      over_time: "The busiest slot is 18:00 with 3.2 kWh. The most expensive hours took 100% of the usage.",
    },
  }),
  heat_context: JSON.stringify({
    narratives: {
      gas: "So far today the home used 4.5 m3 of gas for €9.00 at €2.00 per m3.",
      zones: "Living room was the warmest zone at 19.8. Living room heated for 2 across 1 interval.",
      heating_cost: "Gas costs €0.0556 per kWh of heat; the heat pump estimate is €0.0909. The gas route is currently the cheaper one.",
    },
  }),
  solar_production: JSON.stringify({
    narratives: {
      production: "So far today the panels produced 8.6 kWh of a forecast 14.4 kWh. Today's condition is rain.",
    },
  }),
};

describe("the debug peek costs zero Mistral calls", () => {
  it("peek serves the cache and its state without touching the seam", async () => {
    const mod = await import("../server/context-boxes.mjs?debug=peek");
    const facts = usageFacts();
    const anchor = { period: "day", date: TODAY_KEY };
    const stub = stubReturning([GOOD.usage_context]);
    const generated = await mod.getContextBoxInsight("usage_context", facts, anchor, { stub });
    assert.equal(generated.state, "fresh");
    assert.equal(stub.calls, 1);
    // The peek: fresh against the same signature, no call.
    const peeked = mod.peekContextBoxInsight("usage_context", facts, anchor);
    assert.equal(peeked.state, "fresh");
    assert.equal(peeked.signature, generated.signature);
    assert.equal(stub.calls, 1);
    assert.equal(peeked.sections.length, 3);
    // A changed signature peeks as stale, still no call.
    const moved = usageFacts();
    moved.breakdown.total_kwh = 12;
    const stalePeek = mod.peekContextBoxInsight("usage_context", moved, anchor);
    assert.equal(stalePeek.state, "stale");
    assert.equal(stalePeek.generatedAt, generated.generatedAt);
    assert.equal(stub.calls, 1);
    // No cache at all: null, no call.
    const mod2 = await import("../server/context-boxes.mjs?debug=peek2");
    assert.equal(mod2.peekContextBoxInsight("heat_context", heatFacts(), { period: "day", date: TODAY_KEY }), null);
  });

  it("the rejection journal mirrors the log lines per widget", async () => {
    const mod = await import("../server/context-boxes.mjs?debug=journal");
    const facts = usageFacts();
    const anchor = { period: "day", date: TODAY_KEY };
    const bad = JSON.stringify({
      narratives: {
        breakdown: "Run the dishwasher now.",
        rest_of_home: "Of the remaining usage, the base load is about 1 kWh.",
        over_time: "The busiest slot is 18:00 with 3.2 kWh.",
      },
    });
    const stub = stubReturning([bad, GOOD.usage_context]);
    await mod.getContextBoxInsight("usage_context", facts, anchor, { stub });
    const journal = mod.contextBoxRejectionJournal("usage_context");
    assert.equal(journal.length, 1);
    assert.equal(journal[0].key, "breakdown");
    assert.equal(journal[0].attempt, 1);
    assert.ok(journal[0].reasons.some((r) => /imperative-mood/.test(r)));
    assert.ok(typeof journal[0].at === "string");
    // Another widget's journal stays empty.
    assert.deepEqual(mod.contextBoxRejectionJournal("heat_context"), []);
  });
});

describe("the consistency view: checker rules per box type", () => {
  it("served narratives pass when figures match the facts", () => {
    const sections = buildContextBoxSections("heat_context", heatFacts());
    const served = sections.map((section) => ({
      ...section,
      narrative:
        section.key === "gas"
          ? "So far today the home used 4.5 m3 of gas for €9.00 at €2.00 per m3."
          : section.key === "zones"
            ? "Living room was the warmest zone at 19.8."
            : "Gas costs €0.0556 per kWh of heat; the heat pump estimate is €0.0909.",
    }));
    const results = checkContextBoxConsistency(served);
    assert.equal(results.length, 3);
    for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
  });

  it("a figure that matches no fact is rejected with the amount named", () => {
    const sections = buildContextBoxSections("usage_context", usageFacts());
    const breakdown = sections.find((s) => s.key === "breakdown");
    const result = checkContextBoxSection({ ...breakdown, narrative: "The home used €9.99 today." });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => /amount "€9\.99"/.test(p)));
  });

  it("a verdict sentence requires the verdict fact", () => {
    // Without the verdict fact, a cheaper-route sentence is rejected.
    const noVerdict = guardVerdictClaim("The gas route is the cheaper one.", {});
    assert.equal(noVerdict.ok, false);
    assert.match(noVerdict.problems[0], /verdict sentence/);
    assert.match(noVerdict.problems[0], /no verdict fact/);
    // With the verdict fact served, it passes.
    assert.equal(
      guardVerdictClaim("The gas route is currently the cheaper one.", { verdict: "gas_cheaper" }).ok,
      true
    );
    // Non-verdict prose passes without the fact.
    assert.equal(guardVerdictClaim("The home used 10 kWh.", {}).ok, true);
    // The heating_cost box with its verdict served passes consistency
    // even with the verdict sentence in the served text.
    const sections = buildContextBoxSections("heat_context", heatFacts());
    const cost = sections.find((s) => s.key === "heating_cost");
    const result = checkContextBoxSection({
      ...cost,
      narrative: "Gas costs €0.0556 per kWh of heat; the heat pump estimate is €0.0909. The gas route is currently the cheaper one.",
    });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
  });

  it("the fallback sentences themselves pass the consistency check", () => {
    for (const [widget, facts] of [
      ["usage_context", usageFacts()],
      ["heat_context", heatFacts()],
      ["solar_production", solarFacts()],
    ]) {
      const sections = buildContextBoxSections(widget, facts);
      const results = checkContextBoxConsistency(sections);
      for (const result of results) {
        assert.equal(result.ok, true, `${widget}/${result.key}: ${JSON.stringify(result.problems)}`);
      }
    }
  });
});

describe("the served-text audit over the context-box population", () => {
  it("audits every section's served narrative and all fallback sentences clean", async () => {
    for (const [widget, facts, good] of [
      ["usage_context", usageFacts(), GOOD.usage_context],
      ["heat_context", heatFacts(), GOOD.heat_context],
      ["solar_production", solarFacts(), GOOD.solar_production],
    ]) {
      const sections = buildContextBoxSections(widget, facts);
      const generated = await generateContextBoxNarratives(
        widget,
        sections,
        stubReturning([good]),
      );
      const payload = {
        sections: sections.map((section) => {
          const line = generated.sections.find((s) => s.key === section.key);
          return {
            key: section.key,
            label: section.label,
            narrative: line?.narrative ?? null,
            fallback_sentences: section.fallback_sentences,
          };
        }),
      };
      const audit = auditContextBoxText(payload);
      assert.equal(audit.ok, true, `${widget}: ${JSON.stringify(audit.failures)}`);
    }
  });

  it("audits the fallback sentences even when a narrative was accepted", () => {
    const sections = buildContextBoxSections("solar_production", solarFacts());
    const audit = auditContextBoxText({
      sections: sections.map((s) => ({
        key: s.key,
        label: s.label,
        narrative: "So far today the panels produced 8.6 kWh.",
        fallback_sentences: s.fallback_sentences,
      })),
    });
    assert.equal(audit.ok, true, JSON.stringify(audit.failures));
  });

  it("audit misses fail the runner: EUR code, loose euro, flattery and a missing period are caught", () => {
    const section = {
      key: "heating_cost",
      label: "Heating cost",
      narrative: "Gas costs EUR 0.0556 per kWh of heat.",
      fallback_sentences: ["Great job, the gas route is € 0.06 cheaper"],
    };
    const audit = auditContextBoxText({ sections: [section] });
    assert.equal(audit.ok, false);
    const rules = audit.failures.map((f) => f.rule);
    assert.ok(rules.some((r) => /never the code EUR/.test(r)));
    assert.ok(rules.some((r) => /flush against the amount/.test(r)));
    assert.ok(rules.some((r) => /internal vocabulary "great job"/.test(r)));
    assert.ok(rules.some((r) => /must always end in a period/.test(r)));
  });
});
