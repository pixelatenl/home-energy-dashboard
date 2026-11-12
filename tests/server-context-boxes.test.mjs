import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  guardImperativeRegister,
  guardPresentTenseProduction,
  guardProvenance,
  guardUnservedWeather,
  guardWeekBestFraming,
  validateContextBoxSection,
} from "../server/context-box-guards.mjs";
import {
  buildContextBoxSections,
  buildWidgetPrompt,
  contextBoxSignature,
  GAS_UNKNOWN_PRICE_NOTE,
  generateContextBoxNarratives,
  SHORT_DAY_NOTE,
} from "../server/context-boxes.mjs";
import {
  NIGHT_EXPORT_CAVEAT,
  ZONES_INFERENCE_NOTE,
} from "../server/context-box-facts.mjs";

// The context-box seam (contract section 11): adversarial tests per
// guard with named rejection reasons, the corrupt-fixture fallback, the
// bucketed signature's no-regeneration rule, the throttle, the shared
// budget and the journal parity. Fresh module instances per cache test
// come from query-string imports, so the per-widget caches reset.

// ---- Fixtures ----

function usagePageFacts(overrides = {}) {
  return {
    widget: "usage_context",
    period: "day",
    date: "2026-11-16",
    day_status: "in_progress",
    so_far: true,
    window: { start: "2026-11-16T00:00:00+01:00", end: "2026-11-17T00:00:00+01:00" },
    breakdown: {
      total_kwh: 10,
      total_eur: 3.5,
      categories: [
        { name: "Dishwasher", kwh: 2, eur: 0.6, share_pct: 20, class: "measured" },
        { name: "Heat pump", kwh: 3, eur: 0.9, share_pct: 30, class: "estimated" },
      ],
      measured_share_pct: 20,
      semantics: "Energy figures are day or period totals, never live power.",
    },
    rest_of_home: {
      entries: [
        { key: "base_load", name: "Base load", kwh: 1, eur: 0.35, class: "derived", basis: "data-derived per day" },
        { key: "lighting", name: "Lighting", kwh: 1.1, eur: 0.39, class: "model", basis: "evening use of the 36 Hue lights" },
      ],
      unexplained_kwh: 2.9,
      unexplained_eur: 1.02,
      unexplained_framing: "The unexplained share is real usage of unnamed appliances, not an error.",
      semantics: "Energy figures are day or period totals, never live power.",
    },
    over_time: {
      unit: "hour",
      slots: [
        { label: "17:00", kwh: 0.2, eur: 0.06 },
        { label: "18:00", kwh: 3.2, eur: 1.44 },
      ],
      peak_slot: { label: "18:00", kwh: 3.2, eur: 1.44 },
      most_expensive_hours_share_pct: 86,
      price_stats: { average_eur: 0.3, min_eur: 0.1, max_eur: 0.45, peak_label: "18:00" },
      comparison: null,
      semantics: "Energy figures are day or period totals, never live power.",
    },
    ...overrides,
  };
}

function heatPageFacts(overrides = {}) {
  return {
    widget: "heat_context",
    period: "day",
    date: "2026-11-16",
    day_status: "in_progress",
    so_far: true,
    window: null,
    gas: {
      m3: 4.5,
      eur: 9.0,
      price_eur_per_m3: 2.0,
      unknown_price: false,
      midnight_coverage_note: "Gas day totals miss roughly the first half hour after midnight",
    },
    zones: {
      zones: [
        {
          key: "living",
          name: "Living room",
          avg_temp_c: 19.8,
          current_temp_c: 20.1,
          setpoint_avg_c: 20,
          heating: { count: 1, total_hours: 2, inferred: true, inference_note: ZONES_INFERENCE_NOTE },
        },
      ],
      outdoor_avg_c: 7.5,
      warmest_zone: { name: "Living room", avg_temp_c: 19.8 },
      coolest_zone: { name: "Living room", avg_temp_c: 19.8 },
    },
    heating_cost: {
      gas_eur_per_kwh_heat: 0.0556,
      heat_pump_eur_per_kwh_heat: 0.0909,
      heat_pump_class: "estimated",
      assumptions: {
        calorific_kwh_per_m3: 9.9,
        boiler_efficiency: 0.9,
        cop_at_avg_outdoor_temp: 3.1,
        avg_electricity_price_eur_per_kwh: 0.28,
        avg_outdoor_temp_c: 7.5,
      },
      verdict: "gas_cheaper",
    },
    ...overrides,
  };
}

function solarPageFacts() {
  return {
    widget: "solar_production",
    date: "2026-11-16",
    day_status: "in_progress",
    so_far: true,
    actual_kwh: 8.6,
    forecast_kwh: 14.4,
    solar_score: 28,
    condition: "rain",
    export_kwh: 2.1,
    export_eur: 0.5,
    self_consumption_pct: 75.6,
    night_export_caveat: NIGHT_EXPORT_CAVEAT,
    semantics: { energy: "Energy figures are day or period totals, never live power." },
  };
}

// A counting stub in the model seam's shape: prompt in, raw text out.
function stubReturning(responses) {
  const queue = [...responses];
  const stub = async (prompt) => {
    stub.calls += 1;
    stub.prompts.push(prompt);
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  stub.calls = 0;
  stub.prompts = [];
  return stub;
}

const goodNarratives = (widgetFacts) => {
  const sections = buildContextBoxSections(
    widgetFacts.widget,
    widgetFacts
  );
  const narratives = {};
  for (const section of sections) {
    if (section.key === "breakdown") {
      const total = widgetFacts.breakdown.total_kwh;
      const eur = widgetFacts.breakdown.total_eur.toFixed(2);
      narratives[section.key] =
        `So far today the home used ${total} kWh for €${eur}. The heat pump accounts for an estimated 3 kWh of that.`;
    } else if (section.key === "rest_of_home") {
      narratives[section.key] =
        "Of the remaining usage, the base load is about 1 kWh and lighting about 1.1 kWh. 2.9 kWh is real usage of unnamed appliances, not an error.";
    } else if (section.key === "over_time") {
      narratives[section.key] =
        "The busiest slot is 18:00 with 3.2 kWh. The most expensive hours took 86% of the usage.";
    } else if (section.key === "gas") {
      narratives[section.key] =
        "So far today the home used 4.5 m3 of gas for €9.00 at €2.00 per m3.";
    } else if (section.key === "zones") {
      narratives[section.key] =
        "Living room was the warmest zone at 19.8, the coolest at 19.8. Living room heated for 2 across 1 interval.";
    } else if (section.key === "heating_cost") {
      narratives[section.key] =
        "Gas costs €0.0556 per kWh of heat; the heat pump estimate is €0.0909. The gas route is currently the cheaper one.";
    } else if (section.key === "production") {
      narratives[section.key] =
        "So far today the panels produced 8.6 kWh of a forecast 14.4 kWh. It is rain today.";
    }
  }
  return JSON.stringify({ narratives });
};

async function captureLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

// ---- Guards: adversarial cases with named rejection reasons ----

describe("context-box guards", () => {
  it("guardUnservedWeather rejects weather words without a condition fact, by name", () => {
    const facts = { total_kwh: "10 kWh" };
    const verdict = guardUnservedWeather("Rain is expected this afternoon.", facts);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /weather word "Rain"/);
    assert.match(verdict.problems[0], /no condition fact is served/);
    // With a condition fact served, weather vocabulary is allowed.
    assert.equal(guardUnservedWeather("Rain is expected.", { condition: "rain" }).ok, true);
    // Non-weather prose passes without a condition.
    assert.equal(guardUnservedWeather("The home used 10 kWh.", facts).ok, true);
  });

  it("guardPresentTenseProduction rejects present-tense production, totals pass", () => {
    const verdict = guardPresentTenseProduction(
      "The panels are producing right now."
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /present tense/);
    assert.match(verdict.problems[0], /never live power/);
    assert.equal(
      guardPresentTenseProduction("The panels produced 8.6 kWh today.").ok,
      true
    );
  });

  it("guardWeekBestFraming rejects best-day claims without the marker fact", () => {
    const verdict = guardWeekBestFraming(
      "Friday is the best day of the week for solar.",
      {}
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /best-day claim/);
    assert.match(verdict.problems[0], /no best-day marker fact/);
    assert.equal(
      guardWeekBestFraming("Friday is the best day of the week.", { week_best: true }).ok,
      true
    );
    assert.equal(guardWeekBestFraming("Friday brings 8.4 kWh.", {}).ok, true);
  });

  it("guardProvenance requires hedging on estimated figures and forbids it on measured", () => {
    const facts = {
      estimated_figures: ["3 kWh", "€0.90"],
      measured_figures: ["2 kWh", "€0.60"],
    };
    const unhedged = guardProvenance("The heat pump used 3 kWh of the 10 kWh.", facts);
    assert.equal(unhedged.ok, false);
    assert.match(unhedged.problems[0], /"3 kWh" without hedging/);
    assert.equal(
      guardProvenance("The heat pump estimate is about 3 kWh.", facts).ok,
      true
    );
    const hedgedMeasured = guardProvenance("The dishwasher used about 2 kWh.", facts);
    assert.equal(hedgedMeasured.ok, false);
    assert.match(hedgedMeasured.problems[0], /measured figure "2 kWh"/);
    assert.match(hedgedMeasured.problems[0], /never hedged/);
    assert.equal(guardProvenance("The dishwasher used 2 kWh.", facts).ok, true);
  });

  it("guardImperativeRegister bans imperatives and gates advice on a verdict fact", () => {
    const imperative = guardImperativeRegister("Run the dishwasher in the cheap hours.", {});
    assert.equal(imperative.ok, false);
    assert.match(imperative.problems[0], /imperative-mood sentence/);
    assert.match(imperative.problems[0], /banned in context boxes/);
    const adviceNoVerdict = guardImperativeRegister("You should charge the battery at night.", {});
    assert.equal(adviceNoVerdict.ok, false);
    assert.match(adviceNoVerdict.problems[0], /no verdict or opportunity fact/);
    // With a verdict served, declarative-comparative advice passes.
    assert.equal(
      guardImperativeRegister(
        "Gas costs €0.0556 per kWh of heat against an estimated €0.0909 for the heat pump.",
        { verdict: "gas_cheaper" }
      ).ok,
      true
    );
    // Even with a verdict, an imperative is still banned.
    assert.equal(
      guardImperativeRegister("Charge the battery now.", { verdict: "hp_cheaper" }).ok,
      false
    );
  });

  it("validateContextBoxSection enforces section-scoped figure membership", () => {
    const sections = buildContextBoxSections("usage_context", usagePageFacts());
    const breakdown = sections.find((s) => s.key === "breakdown");
    // A figure from no served fact is rejected with the amount named.
    const verdict = validateContextBoxSection("The home used €9.99 today.", breakdown);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.reasons.some((r) => /amount "€9\.99"/.test(r)));
    // A figure belonging to another section's facts is rejected here.
    const cross = validateContextBoxSection("The busiest slot is 18:00 with 3.2 kWh.", breakdown);
    assert.equal(cross.ok, false);
    assert.ok(cross.reasons.some((r) => /"3\.2 kWh"/.test(r) || /"18:00"/.test(r)));
    // The same narrative in its own section passes the figure check.
    const overTime = sections.find((s) => s.key === "over_time");
    assert.equal(validateContextBoxSection("The busiest slot is 18:00 with 3.2 kWh.", overTime).ok, true);
  });
});

// ---- Section building ----

describe("buildContextBoxSections", () => {
  it("builds the seven sections with fallbacks, budgets and parity notes", () => {
    const usage = buildContextBoxSections("usage_context", usagePageFacts());
    assert.deepEqual(usage.map((s) => s.key), ["breakdown", "rest_of_home", "over_time"]);
    const heat = buildContextBoxSections("heat_context", heatPageFacts());
    assert.deepEqual(heat.map((s) => s.key), ["gas", "zones", "heating_cost"]);
    const solar = buildContextBoxSections("solar_production", solarPageFacts());
    assert.deepEqual(solar.map((s) => s.key), ["production"]);
    for (const section of [...usage, ...heat, ...solar]) {
      assert.ok(section.fallback_sentences.length > 0);
      assert.equal(section.budget, 4);
    }
    // Parity notes: short-day on in-progress periods, the zones
    // inference note, the gas unknown-price note, the solar caveat.
    assert.ok(usage[0].notes.some((n) => n.required === SHORT_DAY_NOTE));
    assert.ok(heat.find((s) => s.key === "zones").notes.some((n) => n.required === ZONES_INFERENCE_NOTE));
    const gasUnknown = buildContextBoxSections(
      "heat_context",
      heatPageFacts({
        gas: { ...heatPageFacts().gas, eur: null, price_eur_per_m3: null, unknown_price: true },
      })
    );
    assert.ok(
      gasUnknown.find((s) => s.key === "gas").notes.some((n) => n.required === GAS_UNKNOWN_PRICE_NOTE)
    );
    assert.ok(solar[0].notes.some((n) => n.required === NIGHT_EXPORT_CAVEAT));
    // Honest absence: a null page-fact section yields no box.
    const empty = buildContextBoxSections("usage_context", { ...usagePageFacts(), breakdown: null, rest_of_home: null, over_time: null });
    assert.deepEqual(empty, []);
  });

  it("the widget prompt assembles section-scoped blocks from the single brief", () => {
    const sections = buildContextBoxSections("usage_context", usagePageFacts());
    const prompt = buildWidgetPrompt("usage_context", sections);
    assert.match(prompt, /Widget: usage_context/);
    assert.ok(prompt.includes('Section "breakdown"'));
    assert.ok(prompt.includes('Section "over_time"'));
    assert.ok(!prompt.includes('Section "gas"'));
    const retry = buildWidgetPrompt("usage_context", sections, {
      breakdown: ["imperative-mood sentence banned"],
    });
    assert.match(retry, /rejected for these sections and reasons: breakdown: imperative-mood sentence banned/);
  });
});

// ---- Generator: one call per widget, one retry, fallback, parity ----

describe("generateContextBoxNarratives", () => {
  it("serves the accepted narrative and appends an omitted parity note verbatim", async () => {
    const facts = heatPageFacts();
    const sections = buildContextBoxSections("heat_context", facts);
    const stub = stubReturning([goodNarratives(facts)]);
    const result = await generateContextBoxNarratives("heat_context", sections, stub);
    assert.equal(stub.calls, 1);
    const zones = result.sections.find((s) => s.key === "zones");
    assert.equal(zones.fallback, false);
    assert.ok(zones.narrative.includes(ZONES_INFERENCE_NOTE));
    assert.equal(zones.sentenceCount <= zones.budget + 1, true); // budget logged, not asserted
    const gas = result.sections.find((s) => s.key === "gas");
    assert.equal(gas.fallback, false);
  });

  it("retries once with the named reasons, then serves the fallback for a corrupt fixture", async () => {
    const facts = usagePageFacts();
    const sections = buildContextBoxSections("usage_context", facts);
    const corrupt = "this is not json at all {{{";
    const stub = stubReturning([corrupt, corrupt]);
    const result = await generateContextBoxNarratives("usage_context", sections, stub);
    assert.equal(stub.calls, 2);
    for (const section of result.sections) {
      assert.equal(section.fallback, true);
      assert.ok(section.narrative.length > 0);
      assert.ok(section.rejected_attempts.length > 0);
    }
    assert.equal(result.modelOk, false);
  });

  it("retries once with rejection feedback and accepts the corrected narrative", async () => {
    const facts = usagePageFacts();
    const sections = buildContextBoxSections("usage_context", facts);
    const bad = JSON.stringify({
      narratives: {
        breakdown: "Run the dishwasher now.",
        rest_of_home: "Nothing to say.",
        over_time: "No figures here.",
      },
    });
    const stub = stubReturning([bad, goodNarratives(facts)]);
    const result = await generateContextBoxNarratives("usage_context", sections, stub);
    assert.equal(stub.calls, 2);
    assert.match(stub.prompts[1], /imperative-mood sentence/);
    const breakdown = result.sections.find((s) => s.key === "breakdown");
    assert.equal(breakdown.fallback, false);
    assert.equal(breakdown.retried, true);
    assert.ok(breakdown.narrative.includes("10 kWh"));
  });
});

// ---- Signature, caching, throttle, budget, journal ----

describe("context-box caching and budget", () => {
  it("the bucketed signature ignores snapshot drift but pins the anchor", () => {
    const base = usagePageFacts();
    const drifted = usagePageFacts();
    drifted.breakdown.total_kwh = 10.2; // same 0.5 bucket
    const anchor = { period: "day", date: "2026-11-16" };
    assert.equal(
      contextBoxSignature("usage_context", base, anchor),
      contextBoxSignature("usage_context", drifted, anchor)
    );
    const moved = usagePageFacts();
    moved.breakdown.total_kwh = 12; // different bucket
    assert.notEqual(
      contextBoxSignature("usage_context", base, anchor),
      contextBoxSignature("usage_context", moved, anchor)
    );
    assert.notEqual(
      contextBoxSignature("usage_context", base, anchor),
      contextBoxSignature("usage_context", base, { period: "day", date: "2026-11-15" })
    );
    assert.notEqual(
      contextBoxSignature("usage_context", base, anchor),
      contextBoxSignature("heat_context", base, anchor)
    );
  });

  it("serves the cache without a model call on snapshot refresh, and force bypasses the floor", async () => {
    const mod = await import("../server/context-boxes.mjs?cache=refresh");
    const facts = usagePageFacts();
    const anchor = { period: "day", date: "2026-11-16" };
    const stub = stubReturning([goodNarratives(facts)]);
    const first = await mod.getContextBoxInsight("usage_context", facts, anchor, { stub });
    assert.equal(first.state, "fresh");
    assert.equal(stub.calls, 1);
    assert.equal(first.sections.length, 3);
    assert.ok(first.sections.every((s) => s.fallback === false));
    // Snapshot refresh with trivial drift: same signature, no new call.
    const drifted = usagePageFacts();
    drifted.breakdown.total_kwh = 10.2;
    const second = await mod.getContextBoxInsight("usage_context", drifted, anchor, { stub });
    assert.equal(stub.calls, 1);
    assert.equal(second.state, "fresh");
    assert.equal(second.insight_as_of ?? second.generatedAt, first.generatedAt);
    // A real change with the floor still up: throttled, stale served.
    const moved = usagePageFacts();
    moved.breakdown.total_kwh = 12;
    const throttled = await mod.getContextBoxInsight("usage_context", moved, anchor, { stub });
    assert.equal(stub.calls, 1);
    assert.equal(throttled.state, "stale");
    assert.equal(throttled.generatedAt, first.generatedAt);
    // force bypasses the interval but not the budget.
    const forcedStub = stubReturning([goodNarratives(moved)]);
    const forced = await mod.getContextBoxInsight("usage_context", moved, anchor, {
      stub: forcedStub,
      force: true,
    });
    assert.equal(forcedStub.calls, 1);
    assert.equal(stub.calls, 1);
    assert.equal(forced.state, "fresh");
  });

  it("never bypasses the shared daily budget, even on force", async () => {
    const mod = await import("../server/context-boxes.mjs?cache=budget");
    process.env.MISTRAL_DAILY_CALL_LIMIT = "0";
    try {
      const stub = stubReturning([goodNarratives(solarPageFacts())]);
      const lines = await captureLogs(async () => {
        const result = await mod.getContextBoxInsight(
          "solar_production",
          solarPageFacts(),
          { date: "2026-11-16" },
          { stub, force: true }
        );
        assert.equal(result.error, "daily_limit_reached");
        assert.ok(result.sections.every((s) => s.fallback === true));
      });
      assert.equal(stub.calls, 0);
      assert.ok(
        lines.some(
          (l) =>
            /^\[mistral\] widget=solar_production signature=\w+ reason=force outcome=skipped_daily_limit$/.test(
              l
            )
        )
      );
    } finally {
      delete process.env.MISTRAL_DAILY_CALL_LIMIT;
    }
  });

  it("logs journal parity: one [mistral] line per call plus per-section and rejection lines", async () => {
    const mod = await import("../server/context-boxes.mjs?cache=journal");
    const facts = usagePageFacts();
    const bad = JSON.stringify({
      narratives: {
        breakdown: "Run the dishwasher now.",
        rest_of_home: "Of the remaining usage, the base load is about 1 kWh.",
        over_time: "The busiest slot is 18:00 with 3.2 kWh.",
      },
    });
    const stub = stubReturning([bad, goodNarratives(facts)]);
    const lines = await captureLogs(async () => {
      const result = await mod.getContextBoxInsight(
        "usage_context",
        facts,
        { period: "day", date: "2026-11-16" },
        { stub }
      );
      assert.equal(result.state, "fresh");
    });
    assert.ok(
      lines.some((l) =>
        /^\[mistral\] widget=usage_context signature=\w+ reason=signature_change outcome=ok$/.test(l)
      )
    );
    assert.ok(
      lines.some((l) =>
        /^context-box usage_context breakdown attempt 1 rejected: .*imperative-mood sentence/.test(l)
      )
    );
    assert.ok(
      lines.some((l) => /^context-box usage_context breakdown: accepted, sentences \d+\/4$/.test(l))
    );
  });

  it("fail-soft: a dead model serves the stale cache, then the fallbacks", async () => {
    const mod = await import("../server/context-boxes.mjs?cache=failsoft");
    const facts = solarPageFacts();
    const good = stubReturning([goodNarratives(facts)]);
    const first = await mod.getContextBoxInsight("solar_production", facts, { date: "2026-11-16" }, { stub: good });
    assert.equal(first.state, "fresh");
    // Signature change plus a dead seam: stale cache served, error set.
    const moved = solarPageFacts();
    moved.actual_kwh = 12;
    const dead = stubReturning([null]);
    const lines = await captureLogs(async () => {
      const stale = await mod.getContextBoxInsight("solar_production", moved, { date: "2026-11-16" }, { stub: dead, force: true });
      assert.equal(stale.state, "stale");
      assert.equal(stale.error, "ai_unavailable");
      assert.equal(stale.generatedAt, first.generatedAt);
      assert.ok(stale.sections[0].narrative.length > 0);
    });
    assert.ok(lines.some((l) => /outcome=error:ai_unavailable/.test(l)));
    // No cache at all: pure fallback payload.
    const mod2 = await import("../server/context-boxes.mjs?cache=failsoft2");
    const dead2 = stubReturning([null]);
    const result = await mod2.getContextBoxInsight("solar_production", facts, { date: "2026-11-16" }, { stub: dead2 });
    assert.equal(result.state, "error");
    assert.equal(result.error, "ai_unavailable");
    assert.equal(result.sections[0].fallback, true);
    assert.ok(result.sections[0].narrative.includes(NIGHT_EXPORT_CAVEAT));
  });
});
