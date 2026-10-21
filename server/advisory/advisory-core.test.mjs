// Unit tests for advisory-core.mjs and narrative-guards.mjs (node:test).
// Covers the pinned section boundaries: the evening pivot exactly at the
// boundary hour on both sides, the C17 practicality gate at exactly 0.05
// and 0.049, the spread gate at 0.03 and 0.029, the confidence mapping for
// worthwhile / below-threshold / empty, the money formatter at
// 0.0629 / 0.0035 / 0.10 / 1.07 - plus per-guard tests for every narrative
// guard and the orchestration behavior (one regeneration, then serve
// without the failing sentences).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildSections,
  buildAdvisoryModelContext,
  validateModelOutput,
  composeAdvisoryCard,
  generateAdvisoryCard,
  attemptModel,
  sanitizeOutput,
  formatEur,
  mapConfidence,
  NO_OPPORTUNITY_STATEMENT,
} from "./advisory-core.mjs";
import { auditServedText } from "./served-text-audit.mjs";

// Tuesday afternoon - the contract example moment.
const NOW = "2026-10-20T15:30:00+02:00";
// Tuesday morning with a full window ahead (for practicality gate tests).
const MORNING = "2026-10-20T13:00:00+02:00";

function baseFacts(overrides = {}) {
  return {
    nowIso: NOW,
    lowPrice: { timestamp: "12:00", price: 0.25 },
    peakPrice: { timestamp: "19:00", price: 0.47 },
    dayAverageEur: 0.38,
    cheapestWindow: { start: "14:00", end: "17:00", averageEur: 0.26 },
    spreadPerKwhEur: 0.12,
    practicalBenefitEur: 0.12,
    co2IntensityGPerKwh: 133,
    solarToday: { actualKwh: 8.6, forecastKwh: 14.4 },
    battery: { socPct: 72, state: "charging", todayInKwh: 4.3, todayOutKwh: 2.4 },
    candidates: [],
    dayCheapestWindow: "12:00-15:00",
    dayCheapestPassed: false,
    tomorrow: {
      pricesPublished: false,
      prices: null,
      solarKwh: 11.99,
      solarScore: 28,
      lowSolar: false,
      compareSolarKwh: 14.4,
    },
    comingDays: [
      { weekday: "Wednesday", date: "2026-10-21", solarKwh: 8.4, solarScore: 20, condition: "cloudy" },
      { weekday: "Friday", date: "2026-10-23", solarKwh: 1.2, solarScore: 5, condition: "rain" },
    ],
    ...overrides,
  };
}

function sectionById(sections, id) {
  return sections.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// Section boundaries: the evening pivot exactly at the boundary hour.
// ---------------------------------------------------------------------------

test("pivot boundary: just before (17:59) is plan mode with no evening section", () => {
  const sections = buildSections(baseFacts(), "2026-10-20T17:59:00+02:00");
  assert.equal(sectionById(sections, "today").mode, "plan");
  assert.equal(sectionById(sections, "today_evening"), undefined);
});

test("pivot boundary: exactly at the hour (18:00) is recap mode with an evening section", () => {
  const facts = baseFacts({
    remainingWindow: { start: "21:00", end: "00:00", averageEur: 0.33, practicalBenefitEur: 0.03 },
    remainingAverageEur: 0.35,
    dayUsageKwh: 18.2,
    dayCostEur: 2.4,
  });
  const sections = buildSections(facts, "2026-10-20T18:00:00+02:00");
  assert.equal(sectionById(sections, "today").mode, "recap");
  const evening = sectionById(sections, "today_evening");
  assert.ok(evening, "today_evening section must exist from the pivot on");
  assert.equal(evening.facts.remaining_window.practical, false);
});

test("no evening section before the pivot even with remaining-window facts", () => {
  const facts = baseFacts({
    remainingWindow: { start: "21:00", end: "00:00", averageEur: 0.33, practicalBenefitEur: 0.09 },
  });
  const sections = buildSections(facts, NOW);
  assert.equal(sectionById(sections, "today_evening"), undefined);
});

// ---------------------------------------------------------------------------
// Section boundaries: the C17 practicality gate at exactly 0.05 and 0.049.
// ---------------------------------------------------------------------------

test("practicality gate: benefit of exactly 0.05 is practical", () => {
  const facts = baseFacts({ nowIso: MORNING, practicalBenefitEur: 0.05 });
  const sections = buildSections(facts, MORNING);
  assert.equal(sectionById(sections, "today").facts.practical, true);
});

test("practicality gate: benefit of 0.049 is not practical", () => {
  const facts = baseFacts({ nowIso: MORNING, practicalBenefitEur: 0.049 });
  const sections = buildSections(facts, MORNING);
  assert.equal(sectionById(sections, "today").facts.practical, false);
});

test("practicality gate: a window starting at the pivot hour is not practical", () => {
  const facts = baseFacts({
    nowIso: MORNING,
    cheapestWindow: { start: "18:00", end: "21:00", averageEur: 0.26 },
    practicalBenefitEur: 0.12,
  });
  const sections = buildSections(facts, MORNING);
  assert.equal(sectionById(sections, "today").facts.practical, false);
});

test("evening window: the C17 gate applies to remaining windows (0.05 vs 0.049)", () => {
  const at = (benefit) =>
    sectionById(
      buildSections(
        baseFacts({
          remainingWindow: { start: "21:00", end: "00:00", averageEur: 0.33, practicalBenefitEur: benefit },
        }),
        "2026-10-20T21:15:00+02:00"
      ),
      "today_evening"
    ).facts.remaining_window.practical;
  assert.equal(at(0.05), true);
  assert.equal(at(0.049), false);
});

// ---------------------------------------------------------------------------
// Null encoding, flags, and omission of missing facts.
// ---------------------------------------------------------------------------

test("unpublished tomorrow prices are null-encoded with the reason in guidance", () => {
  const sections = buildSections(baseFacts(), NOW);
  const tomorrow = sectionById(sections, "tomorrow");
  assert.equal(tomorrow.facts.prices_published, false);
  assert.equal(tomorrow.facts.prices, null);
  assert.match(tomorrow.guidance, /not published/);
});

test("published tomorrow prices carry the real price array", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: true,
      prices: [0.31, 0.3, 0.29, 0.28],
      averageEur: 0.29,
      window: "13:00-16:00",
      solarKwh: 12.5,
      solarScore: 45,
      lowSolar: false,
      compareSolarKwh: 14.4,
    },
  });
  const sections = buildSections(facts, NOW);
  const tomorrow = sectionById(sections, "tomorrow");
  assert.equal(tomorrow.facts.prices_published, true);
  assert.deepEqual(tomorrow.facts.prices, [0.31, 0.3, 0.29, 0.28]);
});

test("peak_ahead is true while the peak hour is ahead of now and false after", () => {
  const before = sectionById(buildSections(baseFacts(), NOW), "today").facts;
  assert.equal(before.peak_ahead, true); // peak 19:00 vs now 15:30
  const after = sectionById(
    buildSections(baseFacts({ peakPrice: { timestamp: "14:00", price: 0.47 } }), NOW),
    "today"
  ).facts;
  assert.equal(after.peak_ahead, false); // peak 14:00 vs now 15:30
});

test("day_cheapest_passed is carried from the facts layer", () => {
  const sections = buildSections(baseFacts({ dayCheapestPassed: true }), NOW);
  assert.equal(sectionById(sections, "today").facts.day_cheapest_passed, true);
});

test("missing facts omit their clause or section entirely", () => {
  const sections = buildSections(
    baseFacts({ battery: undefined, comingDays: [], co2IntensityGPerKwh: undefined }),
    NOW
  );
  assert.equal(sectionById(sections, "coming_days"), undefined);
  assert.ok(!("battery" in sectionById(sections, "today").facts));
  assert.ok(!("co2_intensity_g_per_kwh" in sectionById(sections, "today").facts));
});

test("a facts layer with nothing to say yields no sections", () => {
  assert.deepEqual(buildSections({}, NOW), []);
});

// ---------------------------------------------------------------------------
// Model context: exactly what reaches the model.
// ---------------------------------------------------------------------------

test("buildAdvisoryModelContext returns exactly now_local, today_date and sections", () => {
  const sections = buildSections(baseFacts(), NOW);
  const context = buildAdvisoryModelContext({
    now_local: "2026-10-20T15:30:00+02:00",
    today_date: "2026-10-20",
    sections,
    secret: "must not reach the model",
  });
  assert.deepEqual(Object.keys(context).sort(), ["now_local", "sections", "today_date"]);
  assert.equal(context.secret, undefined);
  for (const entry of context.sections) {
    const keys = Object.keys(entry).sort();
    assert.ok(
      keys.every((k) => ["days", "facts", "guidance", "id", "mode"].includes(k)),
      `section entries carry only known keys, got ${keys}`
    );
  }
});

// ---------------------------------------------------------------------------
// Spread gate (0.03 vs 0.029) and confidence mapping through the composer.
// ---------------------------------------------------------------------------

test("spread gate: a spread of exactly 0.03 keeps the guidance object", () => {
  const facts = baseFacts({ spreadPerKwhEur: 0.03 });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  assert.ok(card.guidance, "guidance must be present at exactly 0.03");
});

test("spread gate: a spread of 0.029 omits the guidance object (flat day)", () => {
  const facts = baseFacts({ spreadPerKwhEur: 0.029 });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  assert.equal(card.guidance, undefined);
});

test("confidence mapping: worthwhile candidate is high", () => {
  assert.equal(
    mapConfidence([{ label: "dishwasher", kwh: 1.07, savingEur: 0.12, window: "14:00-17:00", worthwhile: true }]),
    "high"
  );
});

test("confidence mapping: all candidates below threshold is medium", () => {
  assert.equal(
    mapConfidence([
      { label: "dishwasher", kwh: 1.07, savingEur: 0.03, window: "14:00-17:00", worthwhile: false },
      { label: "washing machine", kwh: 1.5, savingEur: 0.04, window: "14:00-17:00", worthwhile: false },
    ]),
    "medium"
  );
});

test("confidence mapping: no candidates (thin data) is low", () => {
  assert.equal(mapConfidence([]), "low");
});

// ---------------------------------------------------------------------------
// Money formatter (contract section 9).
// ---------------------------------------------------------------------------

test("money formatter: two decimals when nonzero at two decimals", () => {
  assert.equal(formatEur(0.1), "€0.10");
  assert.equal(formatEur(1.07), "€1.07");
});

test("money formatter: more decimals only when two would show €0.00", () => {
  assert.equal(formatEur(0.0629), "€0.06"); // nonzero at two decimals
  assert.equal(formatEur(0.0035), "€0.004"); // zero at two, smallest nonzero precision
});

test("money formatter: non-finite input renders nothing", () => {
  assert.equal(formatEur(Number.NaN), null);
  assert.equal(formatEur(Number.POSITIVE_INFINITY), null);
});

// ---------------------------------------------------------------------------
// Validation: checker.mjs guards plus the narrative guards.
// ---------------------------------------------------------------------------

function sectionsFor(facts, now = NOW) {
  return buildSections(facts, now);
}

test("validateModelOutput accepts a clean quiet-day note", () => {
  const verdicts = validateModelOutput(
    { warning: null, contextNote: "No appliance run-up clears the bar today." },
    sectionsFor(baseFacts())
  );
  assert.equal(verdicts.ok, true);
  assert.deepEqual(verdicts.reasons, []);
});

test("validateModelOutput rejects a fabricated price-plus-hour pair", () => {
  const verdicts = validateModelOutput(
    { warning: "Prices hit EUR 0.31 at 16:00.", contextNote: null },
    sectionsFor(baseFacts())
  );
  assert.equal(verdicts.ok, false);
  assert.match(verdicts.reasons[0], /matches no point on the day's curve/);
});

test("validateModelOutput rejects even a curve-matching price pair: figures are card-rendered", () => {
  const verdicts = validateModelOutput(
    { warning: "The low is EUR 0.25 at 12:00.", contextNote: null },
    sectionsFor(baseFacts())
  );
  assert.equal(verdicts.ok, false);
  // The checker itself raises no curve mismatch for the matching pair; the
  // figure ban (guardNoFigures) is what rejects the sentence.
  assert.ok(!verdicts.reasons.some((r) => /curve/.test(r)));
  assert.ok(verdicts.reasons.some((r) => /figure marker/.test(r)));
});

test("validateModelOutput rejects a battery state claim that mismatches the facts", () => {
  const verdicts = validateModelOutput(
    { warning: "The battery is discharging at 45%.", contextNote: null },
    sectionsFor(baseFacts()) // battery says charging at 72%
  );
  assert.equal(verdicts.ok, false);
  assert.ok(verdicts.reasons.some((r) => /discharging/.test(r)));
});

test("validateModelOutput rejects a tomorrow price while unpublished", () => {
  const verdicts = validateModelOutput(
    { warning: null, contextNote: "Tomorrow will be cheap at EUR 0.19 per kWh." },
    sectionsFor(baseFacts()) // tomorrow unpublished
  );
  assert.equal(verdicts.ok, false);
  assert.match(verdicts.reasons[0], /not published/);
});

test("validateModelOutput rejects a tomorrow price figure even once published: figures are card-rendered", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: true,
      prices: [0.31, 0.3, 0.29],
      averageEur: 0.29,
      window: "13:00-16:00",
      solarKwh: 12.5,
      solarScore: 45,
      lowSolar: false,
      compareSolarKwh: 14.4,
    },
  });
  const verdicts = validateModelOutput(
    { warning: null, contextNote: "Tomorrow averages around EUR 0.29 per kWh." },
    sectionsFor(facts)
  );
  assert.equal(verdicts.ok, false);
  // guardTomorrowPrice is inert once published (no "not published" reason);
  // the figure ban is what rejects the sentence.
  assert.ok(!verdicts.reasons.some((r) => /not published/.test(r)));
  assert.ok(verdicts.reasons.some((r) => /figure marker/.test(r)));
});

test("validateModelOutput rejects a price for a day beyond tomorrow", () => {
  const verdicts = validateModelOutput(
    { warning: null, contextNote: "Friday should be cheap at EUR 0.20 per kWh." },
    sectionsFor(baseFacts())
  );
  assert.equal(verdicts.ok, false);
  assert.match(verdicts.reasons[0], /beyond tomorrow/);
});

test("validateModelOutput rejects arithmetic expressions", () => {
  const verdicts = validateModelOutput(
    { warning: null, contextNote: "The saving is 0.38 - 0.26 per kWh." },
    sectionsFor(baseFacts())
  );
  assert.equal(verdicts.ok, false);
});

test("validateModelOutput rejects internal vocabulary", () => {
  const verdicts = validateModelOutput(
    { warning: null, contextNote: "The C17 gate says the threshold is met." },
    sectionsFor(baseFacts())
  );
  assert.equal(verdicts.ok, false);
  assert.ok(verdicts.reasons.some((r) => /internal vocabulary/.test(r)));
});

test("validateModelOutput rejects NaN and Infinity", () => {
  const verdicts = validateModelOutput(
    { warning: "The average is NaN.", contextNote: "Prices hit Infinity." },
    sectionsFor(baseFacts())
  );
  assert.equal(verdicts.ok, false);
  assert.ok(verdicts.reasons.some((r) => /NaN/.test(r)));
  assert.ok(verdicts.reasons.some((r) => /Infinity/.test(r)));
});

// ---------------------------------------------------------------------------
// Composer: SummaryInsight shape and deterministic content.
// ---------------------------------------------------------------------------

const SUMMARY_INSIGHT_KEYS = new Set([
  "primary_action",
  "supporting_facts",
  "warning",
  "context_note",
  "no_opportunity",
  "candidates",
  "guidance",
  "outlook",
  "advisory",
  "lowPrice",
  "peakPrice",
  "battery",
  "priceSentence",
  "batterySentence",
  "achievements",
  // Transport fields: owned by the summary insight path, never composed.
  "generated_at",
  "insight_as_of",
  "state",
  "stale",
  "error",
]);

test("composed payloads carry only SummaryInsight content fields and no transport fields", () => {
  const facts = baseFacts();
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  for (const key of Object.keys(card)) {
    assert.ok(SUMMARY_INSIGHT_KEYS.has(key), `unexpected payload field: ${key}`);
  }
  for (const transport of ["generated_at", "insight_as_of", "state", "stale", "error"]) {
    assert.ok(!(transport in card), `transport field must never be composed: ${transport}`);
  }
});

test("no-opportunity state leads with the honest constant and keeps real candidates", () => {
  const facts = baseFacts({
    candidates: [
      { label: "washing machine", kwh: 1.5, savingEur: 0.04, window: "14:00-17:00", worthwhile: false },
      { label: "dishwasher", kwh: 1.07, savingEur: 0.03, window: "14:00-17:00", worthwhile: false },
    ],
  });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  assert.equal(card.no_opportunity, true);
  assert.equal(card.primary_action, null);
  assert.equal(card.supporting_facts[0], NO_OPPORTUNITY_STATEMENT);
  // Largest real opportunity first, with its true amount.
  assert.equal(card.candidates[0].label, "washing machine");
  assert.equal(card.candidates[0].saving_eur, 0.04);
});

test("a worthwhile candidate produces the server-injected primary action", () => {
  const facts = baseFacts({
    candidates: [
      { label: "dishwasher", kwh: 1.07, savingEur: 0.12, window: "14:00-17:00", worthwhile: true },
    ],
  });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  assert.equal(card.no_opportunity, false);
  assert.deepEqual(card.primary_action, {
    what: "Run the dishwasher",
    when: "14:00-17:00",
    saving_eur: 0.12,
    confidence: "high",
  });
});

test("the passed-hours fact uses the best-price-left-today reservation", () => {
  const facts = baseFacts({
    nowIso: "2026-10-20T16:30:00+02:00",
    cheapestWindow: { start: "17:00", end: "20:00", averageEur: 0.29 },
    practicalBenefitEur: 0.09,
    dayCheapestPassed: true,
  });
  const card = composeAdvisoryCard(
    buildSections(facts, "2026-10-20T16:30:00+02:00"),
    {},
    facts
  );
  assert.match(card.guidance.line, /best price left today/);
  assert.doesNotMatch(card.guidance.line, /today's lowest price/i);
});

test("the rain poor day yields the pinned advice line with kWh verbatim", () => {
  const card = composeAdvisoryCard(buildSections(baseFacts(), NOW), {}, baseFacts());
  assert.equal(
    card.outlook.poor_day.advice,
    "With rain expected, it is not a good day to run your large appliances."
  );
  assert.match(card.outlook.poor_day.line, /1\.2 kWh/);
});

test("the best solar day below GOOD_SOLAR_SCORE never claims genuinely good", () => {
  const card = composeAdvisoryCard(buildSections(baseFacts(), NOW), {}, baseFacts());
  assert.equal(card.outlook.best_solar_day.good, false);
  assert.match(card.outlook.best_solar_day.line, /week's best solar/);
  assert.doesNotMatch(card.outlook.best_solar_day.line, /genuinely good/i);
});

test("a genuinely better tomorrow fires the prefer verdict with the comparison strip", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: true,
      prices: [0.31, 0.3, 0.29],
      averageEur: 0.29,
      window: "13:00-16:00",
      solarKwh: 12.5,
      solarScore: 45,
      lowSolar: false,
      compareSolarKwh: 14.4,
    },
  });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  assert.equal(card.advisory.type, "defer");
  assert.equal(card.advisory.triggered, true);
  assert.equal(card.advisory.tomorrow_average_eur, 0.29);
  assert.equal(card.advisory.compare_average_eur, 0.38);
  assert.equal(card.advisory.price_difference_per_kwh, -0.09);
});

test("low-solar tomorrow yields the grid-reliance fact with the hedge word usually", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: false,
      prices: null,
      solarKwh: 4.2,
      solarScore: 12,
      lowSolar: true,
      compareSolarKwh: 14.4,
    },
  });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  assert.equal(card.advisory.triggered, false);
  assert.match(card.advisory.line, /lean on the grid/);
  assert.match(card.advisory.line, /usually/);
});

test("outlook days beyond tomorrow never carry a price", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: true,
      prices: [0.31],
      averageEur: 0.29,
      window: "13:00-16:00",
      solarKwh: 12.5,
      solarScore: 45,
      lowSolar: false,
      compareSolarKwh: 14.4,
    },
  });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  for (const day of card.outlook.days) {
    if (day.date !== "2026-10-21") assert.equal(day.average_price_eur, null);
  }
});

test("the composer drops unvalidated model sentences even when called directly", () => {
  const facts = baseFacts();
  const card = composeAdvisoryCard(
    buildSections(facts, NOW),
    { warning: "Prices hit EUR 0.31 at 16:00.", contextNote: "A clean note." },
    facts
  );
  assert.equal(card.warning, null);
  assert.equal(card.context_note, "A clean note.");
});

// ---------------------------------------------------------------------------
// Achievement lines (contract section 4): server-written, recap mode only,
// deterministic templates with honest absence below the thresholds.
// ---------------------------------------------------------------------------

// After the evening pivot: the today section is in recap mode.
const RECAP_NOW = "2026-10-20T18:30:00+02:00";

test("achievement pin: a good recap day carries both exact lines with verbatim figures", () => {
  const facts = baseFacts({
    nowIso: RECAP_NOW,
    solar_share_pct: 62,
    battery_earned_eur: 1.4,
  });
  const card = composeAdvisoryCard(buildSections(facts, RECAP_NOW), {}, facts);
  assert.deepEqual(card.achievements, [
    "Your own solar covered 62% of today's usage.",
    "Your battery earned €1.40 today.",
  ]);
});

test("achievement boundary: solar share exactly 40 renders and 39 omits", () => {
  const at = (share) => {
    const facts = baseFacts({ nowIso: RECAP_NOW, solar_share_pct: share });
    return composeAdvisoryCard(buildSections(facts, RECAP_NOW), {}, facts)
      .achievements;
  };
  assert.deepEqual(at(40), ["Your own solar covered 40% of today's usage."]);
  assert.deepEqual(at(39), []);
});

test("achievement boundary: battery earnings exactly 1.00 render and 0.99 omit", () => {
  const at = (earned) => {
    const facts = baseFacts({ nowIso: RECAP_NOW, battery_earned_eur: earned });
    return composeAdvisoryCard(buildSections(facts, RECAP_NOW), {}, facts)
      .achievements;
  };
  assert.deepEqual(at(1.0), ["Your battery earned €1.00 today."]);
  assert.deepEqual(at(0.99), []);
});

test("achievement honest absence: null facts omit the lines with no substitute", () => {
  const facts = baseFacts({
    nowIso: RECAP_NOW,
    solar_share_pct: null,
    battery_earned_eur: null,
  });
  const card = composeAdvisoryCard(buildSections(facts, RECAP_NOW), {}, facts);
  assert.ok(Array.isArray(card.achievements));
  assert.deepEqual(card.achievements, []);
});

test("plan mode never renders achievement lines even with qualifying facts", () => {
  const facts = baseFacts({ solar_share_pct: 62, battery_earned_eur: 1.4 });
  const sections = buildSections(facts, NOW); // 15:30, before the pivot
  assert.equal(sectionById(sections, "today").mode, "plan");
  const card = composeAdvisoryCard(sections, {}, facts);
  assert.deepEqual(card.achievements, []);
});

test("recap sections carry the new facts null-encoded; plan sections never carry them", () => {
  const recapFacts = baseFacts({
    nowIso: RECAP_NOW,
    solar_share_pct: 62,
    battery_earned_eur: 1.4,
  });
  const recap = sectionById(buildSections(recapFacts, RECAP_NOW), "today").facts;
  assert.equal(recap.solar_share_pct, 62);
  assert.equal(recap.battery_earned_eur, 1.4);
  const recapMissing = sectionById(
    buildSections(baseFacts({ nowIso: RECAP_NOW }), RECAP_NOW),
    "today"
  ).facts;
  assert.equal(recapMissing.solar_share_pct, null);
  assert.equal(recapMissing.battery_earned_eur, null);
  const plan = sectionById(buildSections(baseFacts(), NOW), "today").facts;
  assert.ok(!("solar_share_pct" in plan));
  assert.ok(!("battery_earned_eur" in plan));
});

test("the served-text audit accepts the composed achievement lines", () => {
  const facts = baseFacts({
    nowIso: RECAP_NOW,
    solar_share_pct: 62,
    battery_earned_eur: 1.4,
  });
  const card = composeAdvisoryCard(buildSections(facts, RECAP_NOW), {}, facts);
  const audit = auditServedText(card);
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.failures, []);
});

test("the audit rejects flattery, a lowercase opening and a missing period in achievement lines", () => {
  const audit = auditServedText({
    achievements: ["well done on the solar today"],
  });
  assert.equal(audit.ok, false);
  const failures = audit.failures.map((f) => `${f.path}: ${f.rule}`);
  assert.ok(failures.some((x) => x.startsWith("achievements[0]: sentence must open")));
  assert.ok(failures.some((x) => x.includes("must always end in a period")));
  assert.ok(failures.some((x) => x.includes('"well done"')));
});

// ---------------------------------------------------------------------------
// Audit fix pass: non-finite facts are missing facts (F1), figure and
// register bans on every model slot (F2, F4, F5, F8), the widened
// no-opportunity guard (F3), and the A18/A19 fixtures pinned end to end.
// ---------------------------------------------------------------------------

test("F1: non-finite prices are missing facts on both call paths", async () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const facts = baseFacts({
      lowPrice: { timestamp: "12:00", price: bad },
      peakPrice: { timestamp: "19:00", price: bad },
    });
    // Direct compose path.
    const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
    assert.equal(card.priceSentence, null);
    assert.equal(card.lowPrice, undefined);
    assert.equal(card.peakPrice, undefined);
    assert.ok(!card.supporting_facts.some((f) => /Prices range/.test(f)));
    assert.equal(auditServedText(card).ok, true);
    // The today section the model receives omits the corrupt price points.
    const today = sectionById(buildSections(facts, NOW), "today").facts;
    assert.ok(!("low" in today));
    assert.ok(!("peak" in today));
    // Orchestration path: generateAdvisoryCard composes the same card.
    const generated = await generateAdvisoryCard(
      facts,
      NOW,
      async () => ({ warning: null, contextNote: "A clean note." })
    );
    assert.equal(generated.priceSentence, null);
    assert.equal(generated.lowPrice, undefined);
    assert.equal(generated.context_note, "A clean note.");
  }
});

test("F1: a non-finite battery SOC omits the battery sentence on both call paths", async () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const facts = baseFacts({
      battery: { socPct: bad, state: "charging", todayInKwh: 4.3, todayOutKwh: 2.4 },
    });
    const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
    assert.equal(card.batterySentence, null);
    assert.equal(card.battery, undefined);
    assert.equal(auditServedText(card).ok, true);
    const today = sectionById(buildSections(facts, NOW), "today").facts;
    assert.ok(!("battery" in today));
    const generated = await generateAdvisoryCard(
      facts,
      NOW,
      async () => ({ warning: null, contextNote: "A clean note." })
    );
    assert.equal(generated.batterySentence, null);
    assert.equal(generated.battery, undefined);
  }
});

test("F1: a non-finite cheapest-window average omits the guidance object", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const facts = baseFacts({
      cheapestWindow: { start: "14:00", end: "17:00", averageEur: bad },
    });
    const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
    assert.equal(card.guidance, undefined);
    assert.equal(auditServedText(card).ok, true);
    const today = sectionById(buildSections(facts, NOW), "today").facts;
    assert.ok(!("cheapest_window" in today));
  }
});

test("F1 pin: the audit's non-finite repro composes no corrupt token", () => {
  const facts = {
    nowIso: NOW,
    lowPrice: { timestamp: "12:00", price: Number.NaN },
    peakPrice: { timestamp: "19:00", price: 0.47 },
    battery: { socPct: Number.NaN, state: "charging" },
    cheapestWindow: { start: "14:00", end: "17:00", averageEur: Number.NaN },
    spreadPerKwhEur: 0.12,
    dayAverageEur: 0.38,
  };
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  // The corrupt low drops; the honest peak-only fallback remains.
  assert.equal(card.priceSentence, "The peak price so far is €0.47 at 19:00.");
  assert.equal(card.batterySentence, null);
  assert.equal(card.guidance, undefined);
  assert.equal(card.lowPrice, undefined);
  assert.equal(card.battery, undefined);
  assert.equal(auditServedText(card).ok, true);
});

test("F2 pin: a contextNote restating the achievement figure is rejected and never served", () => {
  const facts = baseFacts({
    nowIso: RECAP_NOW,
    solar_share_pct: 62,
    battery_earned_eur: 1.4,
  });
  const sections = buildSections(facts, RECAP_NOW);
  const note = "Your own solar covered 62% of today's usage.";
  const verdicts = validateModelOutput({ warning: null, contextNote: note }, sections);
  assert.equal(verdicts.ok, false);
  assert.ok(verdicts.reasons.some((r) => /figure marker/.test(r)));
  const card = composeAdvisoryCard(sections, { warning: null, contextNote: note }, facts);
  assert.equal(card.context_note, null);
  // The deterministic server line still renders, exactly once.
  assert.deepEqual(card.achievements, [
    "Your own solar covered 62% of today's usage.",
    "Your battery earned €1.40 today.",
  ]);
});

test("F3 pin: the no-opportunity statement and deferral advice are rejected from both slots", () => {
  const warning = "No action worth taking today - wait until tomorrow.";
  const warningVerdicts = validateModelOutput(
    { warning, contextNote: null },
    sectionsFor(baseFacts())
  );
  assert.equal(warningVerdicts.ok, false);
  assert.ok(warningVerdicts.reasons.some((r) => /no-opportunity statement/.test(r)));
  assert.ok(warningVerdicts.reasons.some((r) => /deferral/.test(r)));
  const card = composeAdvisoryCard(
    sectionsFor(baseFacts()),
    { warning, contextNote: null },
    baseFacts()
  );
  assert.equal(card.warning, null);
  // The contextNote slot keeps its existing rejection.
  const noteVerdicts = validateModelOutput(
    { warning: null, contextNote: warning },
    sectionsFor(baseFacts())
  );
  assert.equal(noteVerdicts.ok, false);
  assert.ok(noteVerdicts.reasons.some((r) => /no-opportunity statement/.test(r)));
});

test("F4 pin: a paraphrased tomorrow price while unpublished is rejected", () => {
  const note = "Prices for the day after today will sit around EUR 0.20.";
  const verdicts = validateModelOutput(
    { warning: null, contextNote: note },
    sectionsFor(baseFacts())
  );
  assert.equal(verdicts.ok, false);
  assert.ok(verdicts.reasons.some((r) => /not published/.test(r)));
  const card = composeAdvisoryCard(
    sectionsFor(baseFacts()),
    { warning: null, contextNote: note },
    baseFacts()
  );
  assert.equal(card.context_note, null);
});

test("F5 pin: fabricated figures without price-hour markers are rejected", () => {
  for (const note of [
    "You used 45 kWh today, which is more than usual.",
    "Your battery earned €3.50 today.",
  ]) {
    const verdicts = validateModelOutput(
      { warning: null, contextNote: note },
      sectionsFor(baseFacts())
    );
    assert.equal(verdicts.ok, false, `expected rejection: ${note}`);
    assert.ok(verdicts.reasons.some((r) => /figure marker/.test(r)));
  }
});

test("F8 pin: flattery and exclamation marks are rejected from both slots", () => {
  for (const [slot, text] of [
    ["warning", "Well done today, you are doing brilliantly with your energy use."],
    ["contextNote", "You are doing a superb job managing the house today."],
    ["warning", "Prices spike soon!"],
    ["contextNote", "Prices spike soon!"],
  ]) {
    const output =
      slot === "warning" ? { warning: text, contextNote: null } : { warning: null, contextNote: text };
    const verdicts = validateModelOutput(output, sectionsFor(baseFacts()));
    assert.equal(verdicts.ok, false, `expected rejection (${slot}): ${text}`);
    assert.ok(verdicts.reasons.some((r) => /exclamation|flattery/.test(r)));
  }
});

test("composeAdvisoryCard throws a clear error when facts.nowIso is missing", () => {
  const facts = { ...baseFacts() };
  delete facts.nowIso;
  assert.throws(
    () => composeAdvisoryCard(buildSections(facts, NOW), {}, facts),
    /facts\.nowIso/
  );
});

// Runs one fixture through the same orchestration as advisory-scenarios.mjs.
async function runFixture(file) {
  const fixture = JSON.parse(
    readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8")
  );
  const sections = buildSections(fixture.facts, fixture.now);
  const context = buildAdvisoryModelContext({
    now_local: fixture.now,
    today_date: fixture.now.slice(0, 10),
    sections,
  });
  const stub = async () => fixture.stub;
  let attempt = await attemptModel(context, stub);
  if (!attempt.verdicts.ok) {
    attempt = await attemptModel(context, stub);
  }
  const served = sanitizeOutput(attempt.output, attempt.verdicts);
  const card = composeAdvisoryCard(sections, served, {
    ...fixture.facts,
    nowIso: fixture.now,
  });
  return { attempt, served, card };
}

test("A18 pin: corrupt facts never compose a non-finite token into a served sentence", async () => {
  const { attempt, served, card } = await runFixture("A18.json");
  assert.equal(attempt.verdicts.ok, true);
  assert.equal(
    served.contextNote,
    "The figures are patchy tonight, so the card sticks to what is certain."
  );
  assert.equal(card.priceSentence, null);
  assert.equal(card.batterySentence, null);
  assert.equal(card.lowPrice, undefined);
  assert.equal(card.peakPrice, undefined);
  assert.equal(card.battery, undefined);
  assert.equal(card.guidance, undefined);
  assert.deepEqual(card.achievements, []);
  assert.ok(!card.supporting_facts.some((f) => /Prices range/.test(f)));
  assert.equal(auditServedText(card).ok, true);
  for (const sentence of [
    card.warning,
    card.context_note,
    card.priceSentence,
    card.batterySentence,
    ...(card.achievements ?? []),
    ...(card.supporting_facts ?? []),
  ]) {
    if (typeof sentence === "string") {
      assert.ok(
        !/\b(NaN|null|undefined|Infinity)\b/i.test(sentence),
        `served sentence carries a missing-data token: ${sentence}`
      );
    }
  }
});

test("A19 pin: register violations are rejected with readable reasons and served without", async () => {
  const { attempt, served, card } = await runFixture("A19.json");
  assert.equal(attempt.verdicts.ok, false);
  assert.ok(attempt.verdicts.reasons.some((r) => /no-opportunity statement/.test(r)));
  assert.ok(attempt.verdicts.reasons.some((r) => /deferral/.test(r)));
  assert.ok(attempt.verdicts.reasons.some((r) => /figure marker/.test(r)));
  assert.ok(attempt.verdicts.reasons.some((r) => /well done/.test(r)));
  assert.ok(attempt.verdicts.reasons.some((r) => /brilliant/.test(r)));
  assert.equal(served.warning, null);
  assert.equal(served.contextNote, null);
  assert.equal(card.warning, null);
  assert.equal(card.context_note, null);
  // The server-written achievement lines still carry the positives.
  assert.deepEqual(card.achievements, [
    "Your own solar covered 62% of today's usage.",
    "Your battery earned €1.40 today.",
  ]);
  assert.equal(auditServedText(card).ok, true);
});

// ---------------------------------------------------------------------------
// Orchestration: one regeneration attempt, then serve without failures.
// ---------------------------------------------------------------------------

test("generateAdvisoryCard regenerates once and serves the passing sentences", async () => {
  const facts = baseFacts();
  let calls = 0;
  const stub = async () => {
    calls += 1;
    if (calls === 1) {
      return { warning: "Prices hit EUR 0.31 at 16:00.", contextNote: null };
    }
    return { warning: null, contextNote: "The day is running quiet so far." };
  };
  const card = await generateAdvisoryCard(facts, NOW, stub);
  assert.equal(calls, 2);
  assert.equal(card.warning, null);
  assert.equal(card.context_note, "The day is running quiet so far.");
});

test("generateAdvisoryCard serves without failing sentences when both attempts fail", async () => {
  const facts = baseFacts();
  let calls = 0;
  const stub = async () => {
    calls += 1;
    return { warning: "The C17 gate is open.", contextNote: null };
  };
  const card = await generateAdvisoryCard(facts, NOW, stub);
  assert.equal(calls, 2, "exactly one regeneration attempt");
  assert.equal(card.warning, null);
});

test("generateAdvisoryCard makes a single model call when the first attempt passes", async () => {
  const facts = baseFacts();
  let calls = 0;
  const stub = async () => {
    calls += 1;
    return { warning: null, contextNote: "Nothing worth scheduling today." };
  };
  const card = await generateAdvisoryCard(facts, NOW, stub);
  assert.equal(calls, 1);
  assert.equal(card.context_note, "Nothing worth scheduling today.");
});

test("attemptModel and sanitizeOutput expose the verdicts a runner serves with", async () => {
  const facts = baseFacts();
  const sections = buildSections(facts, NOW);
  const context = buildAdvisoryModelContext({
    now_local: "2026-10-20T15:30:00+02:00",
    today_date: "2026-10-20",
    sections,
  });
  const { output, verdicts } = await attemptModel(context, async () => ({
    warning: null,
    contextNote: "Tomorrow will be cheap at EUR 0.19 per kWh.",
  }));
  assert.equal(verdicts.ok, false);
  const safe = sanitizeOutput(output, verdicts);
  assert.equal(safe.contextNote, null);
});

// ---------------------------------------------------------------------------
// Contract section 4 output rules: the contextNote on action days, the
// action-restatement ban, and the no-opportunity / deferral phrasing ban.
// ---------------------------------------------------------------------------

function actionDayFacts() {
  return baseFacts({
    candidates: [
      { label: "dishwasher", kwh: 1.07, savingEur: 0.12, window: "14:00-17:00", worthwhile: true },
    ],
  });
}

test("rule 1: a contextNote on an action day is rejected and served as null", () => {
  const facts = actionDayFacts();
  const sections = buildSections(facts, NOW);
  const verdicts = validateModelOutput(
    { warning: null, contextNote: "The afternoon looks calm." },
    sections
  );
  assert.equal(verdicts.ok, false);
  assert.match(verdicts.reasons[0], /must be null when an action exists/);

  // The composer serves a null context_note even when called directly with the note.
  const card = composeAdvisoryCard(
    sections,
    { warning: null, contextNote: "The afternoon looks calm." },
    facts
  );
  assert.equal(card.context_note, null);
});

test("rule 1 control: a quiet-day contextNote is accepted and served", () => {
  const facts = baseFacts(); // no candidates
  const sections = buildSections(facts, NOW);
  const note = "No appliance run-up clears the bar today.";
  const verdicts = validateModelOutput(
    { warning: null, contextNote: note },
    sections
  );
  assert.equal(verdicts.ok, true);
  const card = composeAdvisoryCard(sections, { warning: null, contextNote: note }, facts);
  assert.equal(card.context_note, note);
});

test("rule 2: a contextNote restating the action's name, figures or window is rejected", () => {
  const facts = actionDayFacts();
  const sections = buildSections(facts, NOW);
  for (const note of [
    "The dishwasher is a good run for this window.",
    "It saves EUR 0.12 on a full load.",
    "A 1.07 kWh run fits the window well.",
    "Run it between 14:00 and 17:00.",
  ]) {
    const verdicts = validateModelOutput({ warning: null, contextNote: note }, sections);
    assert.equal(verdicts.ok, false, `expected rejection: ${note}`);
    assert.ok(
      verdicts.reasons.some((r) => /restates the action/.test(r)),
      `expected a restatement reason for: ${note}`
    );
  }
});

test("rule 3: the no-opportunity statement and deferral phrasing are rejected", () => {
  const facts = baseFacts(); // quiet day - the rule applies unconditionally
  const sections = buildSections(facts, NOW);
  for (const note of [
    "No action worth taking today.",
    "Just wait until tomorrow for the cheaper prices.",
    "It is best to hold off until the weekend.",
  ]) {
    const verdicts = validateModelOutput({ warning: null, contextNote: note }, sections);
    assert.equal(verdicts.ok, false, `expected rejection: ${note}`);
  }
});

test("rule 3: both phrasings are reported when a note carries them together", () => {
  const facts = actionDayFacts();
  const sections = buildSections(facts, NOW);
  const verdicts = validateModelOutput(
    { warning: null, contextNote: "No action worth taking today - wait until tomorrow." },
    sections
  );
  assert.equal(verdicts.ok, false);
  assert.ok(verdicts.reasons.some((r) => /no-opportunity statement/.test(r)));
  assert.ok(verdicts.reasons.some((r) => /deferral/.test(r)));
});

test("generateAdvisoryCard serves a null context_note when the stub keeps returning one on an action day", async () => {
  const facts = actionDayFacts();
  let calls = 0;
  const stub = async () => {
    calls += 1;
    return { warning: null, contextNote: "The afternoon looks calm." };
  };
  const card = await generateAdvisoryCard(facts, NOW, stub);
  assert.equal(calls, 2, "one regeneration attempt");
  assert.equal(card.context_note, null);
});

// ---------------------------------------------------------------------------
// Contract section 8/9 pins: the exact low-solar line (F3), the negative
// money convention, and the advance prefer verdict.
// ---------------------------------------------------------------------------

test("F3 pin: the low-solar advisory line is exact, hedge word and spacing intact", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: false,
      prices: null,
      solarKwh: 4.2,
      solarScore: 12,
      lowSolar: true,
      compareSolarKwh: 14.4,
    },
  });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  assert.equal(
    card.advisory.line,
    "Little sun is expected tomorrow (4.2 kWh), so the house will lean on the grid; prices are usually firmer in that case."
  );
});

test("money formatter: negative amounts carry the sign before the euro symbol", () => {
  assert.equal(formatEur(-0.04), "-€0.04");
  assert.equal(formatEur(-1.07), "-€1.07");
  assert.equal(formatEur(-0.0035), "-€0.004");
});

test("a negative cheapest window states its average honestly in the guidance line", () => {
  const facts = baseFacts({
    lowPrice: { timestamp: "13:00", price: -0.05 },
    dayAverageEur: 0.2,
    cheapestWindow: { start: "12:00", end: "15:00", averageEur: -0.04 },
    spreadPerKwhEur: 0.51,
    practicalBenefitEur: 0.24,
    nowIso: "2026-10-20T12:30:00+02:00",
  });
  const card = composeAdvisoryCard(
    buildSections(facts, "2026-10-20T12:30:00+02:00"),
    {},
    facts
  );
  assert.equal(
    card.guidance.line,
    "The cheapest remaining window is 12:00-15:00, averaging -€0.04 against a day average of €0.20."
  );
});

test("a worthwhile candidate on a negative-price day keeps its saving positive", () => {
  const facts = baseFacts({
    lowPrice: { timestamp: "13:00", price: -0.05 },
    dayAverageEur: 0.2,
    cheapestWindow: { start: "12:00", end: "15:00", averageEur: -0.04 },
    spreadPerKwhEur: 0.51,
    practicalBenefitEur: 0.24,
    nowIso: "2026-10-20T12:30:00+02:00",
    candidates: [
      { label: "dishwasher", kwh: 1.07, savingEur: 0.26, window: "12:00-15:00", worthwhile: true },
    ],
  });
  const card = composeAdvisoryCard(
    buildSections(facts, "2026-10-20T12:30:00+02:00"),
    {},
    facts
  );
  assert.equal(card.no_opportunity, false);
  assert.equal(card.primary_action.saving_eur, 0.26);
  assert.equal(card.primary_action.confidence, "high");
});

test("an advance verdict fires the prefer trigger for today", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: true,
      prices: [0.45],
      averageEur: 0.45,
      window: "17:00-20:00",
      solarKwh: 5.0,
      solarScore: 18,
      lowSolar: true,
      compareSolarKwh: 14.4,
    },
  });
  const card = composeAdvisoryCard(buildSections(facts, NOW), {}, facts);
  assert.equal(card.advisory.type, "advance");
  assert.equal(card.advisory.triggered, true);
  assert.equal(card.advisory.price_difference_per_kwh, 0.07);
  assert.match(card.advisory.line, /run heavy usage now/);
  // The comparison strip is server-computed from the facts.
  assert.equal(card.advisory.tomorrow_average_eur, 0.45);
  assert.equal(card.advisory.compare_average_eur, 0.38);
});

