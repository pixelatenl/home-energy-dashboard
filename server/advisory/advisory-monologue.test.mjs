// Unit tests for the monologue layer (node:test): the figure-verbatim
// extraction and membership rules, the framing rule, the pre-formatted
// section facts, the prompt builder with the verbatim style brief, the
// per-section validation, the one-retry-then-fallback orchestration, and
// the monologue prose audit.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSections, NO_OPPORTUNITY_STATEMENT } from "./advisory-core.mjs";
import {
  MONOLOGUE_STYLE_BRIEF,
  HORIZON_NOTE,
  TOMORROW_UNPUBLISHED_SENTENCE,
  LOW_SOLAR_GRID_NOTE,
  RAIN_DAY_ADVICE,
  buildMonologueSections,
  buildSectionPrompt,
  formatSavingEur,
  generateMonologue,
  validateSectionNarrative,
} from "./advisory-monologue.mjs";
import {
  extractFigureTokens,
  servedFigureSets,
  validateFraming,
  validateNarrativeFigures,
  validateSectionFigures,
} from "./figure-verbatim.mjs";
import { auditMonologueText } from "./served-text-audit.mjs";

const NOW = "2026-10-20T15:30:00+02:00";
const RECAP_NOW = "2026-10-20T19:30:00+02:00";

function baseFacts(overrides = {}) {
  return {
    lowPrice: { timestamp: "13:00", price: 0.23 },
    peakPrice: { timestamp: "19:00", price: 0.46 },
    dayAverageEur: 0.31,
    cheapestWindow: { start: "11:00", end: "14:00", averageEur: 0.23 },
    spreadPerKwhEur: 0.23,
    practicalBenefitEur: 0.08,
    co2IntensityGPerKwh: 133,
    solarToday: { actualKwh: 8.18, forecastKwh: 9.5 },
    battery: { socPct: 72, state: "charging", todayInKwh: 4.3, todayOutKwh: 2.4 },
    candidates: [],
    dayCheapestWindow: "11:00-14:00",
    dayCheapestPassed: false,
    tomorrow: {
      pricesPublished: false,
      prices: null,
      // The facts layer's weekday name for tomorrow (2026-10-21).
      weekday: "Wednesday",
      solarKwh: 2.2,
      solarScore: 15,
      lowSolar: true,
      compareSolarKwh: 8.18,
    },
    comingDays: [
      { weekday: "Friday", date: "2026-10-23", solarKwh: 2.29, solarScore: 8, condition: "rain" },
      { weekday: "Sunday", date: "2026-10-25", solarKwh: 10.87, solarScore: 26, condition: "sunny" },
    ],
    ...overrides,
  };
}

function monologueSections(facts = baseFacts(), now = NOW) {
  return buildMonologueSections(buildSections(facts, now), facts, now);
}

function section(key, facts, now) {
  const found = monologueSections(facts, now).find((s) => s.key === key);
  if (found === undefined) throw new Error(`no monologue section "${key}"`);
  return found;
}

// ---------------------------------------------------------------------------
// Figure token extraction: every figure class, one scan.
// ---------------------------------------------------------------------------

test("extractFigureTokens: currency, times, ranges, kWh, percentages and bare figures", () => {
  const tokens = extractFigureTokens(
    "The low is €0.23 at 13:00, the window 11:00-14:00 saves €0.12 on 1.07 kWh, " +
      "the battery sits at 72% and the forecast is 8.18 kWh at score 26."
  );
  const kinds = tokens.map((t) => `${t.kind}:${t.raw}`);
  assert.ok(kinds.includes("currency:€0.23"));
  assert.ok(kinds.includes("time:13:00"));
  assert.ok(kinds.includes("range:11:00-14:00"));
  assert.ok(kinds.includes("kwh:1.07 kWh"));
  assert.ok(kinds.includes("percent:72%"));
  assert.ok(kinds.includes("kwh:8.18 kWh"));
  assert.ok(kinds.includes("number:26"));
  // The digits inside a currency, kWh or range token are never re-captured.
  assert.ok(!kinds.some((k) => k.startsWith("number:0.23")));
  assert.ok(!kinds.some((k) => k.startsWith("number:1.07")));
  assert.ok(!kinds.some((k) => k.startsWith("time:11:00")));
});

test("extractFigureTokens: negative amounts, the EUR code, padded hours and spaced percentages normalize", () => {
  const tokens = extractFigureTokens("worth -€0.0036, or EUR 0.29, between 9:00 and 10:00, at 5 % charge");
  const currency = tokens.filter((t) => t.kind === "currency").map((t) => t.raw);
  assert.ok(currency.includes("-€0.0036"));
  assert.ok(currency.includes("EUR 0.29"));
  const times = tokens.filter((t) => t.kind === "time").map((t) => t.normalized);
  assert.deepEqual(times, ["09:00", "10:00"]);
  // A percentage with whitespace before the percent sign is the same
  // token as its served form: "5 %" normalizes to "5%".
  const percent = tokens.find((t) => t.kind === "percent");
  assert.equal(percent.raw, "5 %");
  assert.equal(percent.normalized, "5%");
});

test("a percentage with a space before the percent sign matches its served form", () => {
  const facts = { battery_level: "5%" };
  assert.equal(validateNarrativeFigures("The battery is at 5%.", facts).ok, true);
  assert.equal(validateNarrativeFigures("The battery is at 5 %.", facts).ok, true);
  // When a percentage still fails, the rejection names the typography.
  const verdict = validateNarrativeFigures("The battery is at 45 %.", facts);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.problems.some((p) =>
      p.includes('percentage "45 %" matches no served percentage in this section')
    )
  );
  assert.ok(
    verdict.problems.some((p) =>
      p.includes(
        'write percentages exactly as served, for example "5%" without a space'
      )
    )
  );
});

test("validateNarrativeFigures: a computed difference is rejected with the compute-ban hint", () => {
  const facts = { day_average: "€0.16", window_average: "€0.13" };
  const verdict = validateNarrativeFigures(
    "The day average of €0.16 sits above the window average of €0.13, a gap of €0.03.",
    facts
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.problems.some((p) =>
      p.includes('amount "€0.03" matches no served amount in this section') &&
      p.includes("never compute a difference or total")
    ),
    `expected the compute-ban hint, got: ${verdict.problems.join(" | ")}`
  );
});

test("the percentage rejection keeps its own hint line byte-identical", () => {
  const facts = { battery_level: "5%" };
  const verdict = validateNarrativeFigures("The battery is at 45 %.", facts);
  assert.equal(verdict.ok, false);
  // The percent hint predates the currency compute-ban and stays untouched.
  assert.deepEqual(verdict.problems, [
    'percentage "45 %" matches no served percentage in this section (write percentages exactly as served, for example "5%" without a space)',
  ]);
});

// ---------------------------------------------------------------------------
// Membership: the section's own served strings only.
// ---------------------------------------------------------------------------

test("servedFigureSets: exact strings, padded times, normalized ranges", () => {
  const sets = servedFigureSets({
    low_price: "€0.23",
    low_hour: "13:00",
    window: "11:00-14:00",
    score: "26",
    note: "a plain string",
  });
  assert.ok(sets.exact.has("€0.23"));
  assert.ok(sets.exact.has("26"));
  assert.ok(sets.times.has("13:00"));
  assert.ok(sets.ranges.has("11:00-14:00"));
});

test("validateNarrativeFigures: verbatim figures pass, each mismatch class rejects with the figure named", () => {
  const facts = section("today").facts;
  const ok = validateNarrativeFigures(
    "The low is €0.23 at 13:00 and the cheapest window 11:00-14:00 averages €0.23 against €0.31, with 8.18 kWh of sun and the battery at 72%.",
    facts
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.problems, []);

  for (const [narrative, named] of [
    ["You could save €0.51 this afternoon.", "€0.51"],
    ["Power dips to 0.23 per kWh.", '"0.23"'],
    ["The window is 14:00-17:00.", "14:00-17:00"],
    ["Tomorrow brings 2.2 kWh.", "2.2 kWh"],
    ["The battery is at 45%.", "45%"],
    ["The low sits at EUR 0.23.", "EUR 0.23"],
  ]) {
    const verdict = validateNarrativeFigures(narrative, facts);
    assert.equal(verdict.ok, false, `expected rejection: ${narrative}`);
    assert.ok(
      verdict.problems.some((p) => p.includes(named)),
      `expected the reason to name ${named}, got: ${verdict.problems.join(" | ")}`
    );
  }
});

test("validateNarrativeFigures: word-form ranges pass when both boundary hours are served", () => {
  const verdict = validateNarrativeFigures(
    "Run it between 11:00 and 14:00.",
    section("today").facts
  );
  assert.equal(verdict.ok, true);
});

// ---------------------------------------------------------------------------
// The framing rule.
// ---------------------------------------------------------------------------

test("validateFraming: an opportunity claim requires a positive, above-threshold candidate", () => {
  const claim = "The battery is your largest opportunity today.";
  assert.equal(validateFraming(claim, { action_available: false }).ok, false);
  assert.equal(validateFraming(claim, {}).ok, false);
  const verdict = validateFraming(claim, { action_available: false });
  assert.match(verdict.problems[0], /opportunity/);
  assert.equal(validateFraming(claim, { action_available: true }).ok, true);
  assert.equal(
    validateFraming("Nothing here frames anything.", { action_available: false }).ok,
    true
  );
});

test("validateSectionFigures combines membership and framing", () => {
  const facts = section("today", baseFacts({
    candidates: [{ label: "battery", kwh: 1.2, savingEur: -0.0036, window: "11:00-14:00", worthwhile: false }],
  })).facts;
  const verdict = validateSectionFigures(
    "The battery is your largest opportunity today, worth -€0.0036.",
    facts
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.problems.length, 1);
  assert.match(verdict.problems[0], /opportunity/);
});

// ---------------------------------------------------------------------------
// Pre-formatted fact strings and fallbacks.
// ---------------------------------------------------------------------------

test("formatSavingEur renders cents and above naturally, sub-cent values at minimal precision", () => {
  // A saving of a cent or more serves at two decimals: the natural
  // household reading the model reaches for.
  assert.equal(formatSavingEur(0.1217), "€0.12");
  assert.equal(formatSavingEur(0.12), "€0.12");
  assert.equal(formatSavingEur(0.5), "€0.50");
  assert.equal(formatSavingEur(-0.1217), "-€0.12");
  // A sub-cent saving keeps the minimal-precision display, the first
  // decimal rendering that reads back exactly.
  assert.equal(formatSavingEur(0.0036), "€0.0036");
  assert.equal(formatSavingEur(-0.0036), "-€0.0036");
  assert.equal(formatSavingEur(Number.NaN), null);
});

test("monologue sections are labeled TODAY, TOMORROW and the weekday short names", () => {
  const sections = monologueSections();
  assert.deepEqual(sections.map((s) => s.label), ["TODAY", "TOMORROW", "FRI", "SUN"]);
  assert.equal(sections[0].budget, 3); // quiet plan day
  assert.equal(sections[1].budget, 3);
  // The rain-poorest day carries the weakest-day line plus the pinned
  // rain-day advice; the strong best day carries the forecast framing
  // plus the pinned positive advice (budget guidance 2 for both
  // advice-carrying days).
  assert.deepEqual(sections[2].fallback_sentences, [
    "Friday looks like the week's weakest solar day at 2.29 kWh.",
    RAIN_DAY_ADVICE,
  ]);
  assert.equal(sections[2].facts.advice, RAIN_DAY_ADVICE);
  assert.equal(sections[2].budget, 2);
  assert.deepEqual(sections[3].fallback_sentences, [
    "Sunday looks the best for solar: score 26 and 10.87 kWh expected.",
    "With 10.87 kWh expected, it is a good day to run your large appliances on solar.",
  ]);
  assert.equal(
    sections[3].facts.advice,
    "With 10.87 kWh expected, it is a good day to run your large appliances on solar."
  );
  assert.equal(sections[3].budget, 2);
});

test("weekday sections at or above a solar score of 20 serve the positive advice, below it none", async () => {
  // The owner decision of 22 October: the threshold itself (20) and a
  // strong day (24) serve the advice; a day below it (14) serves none.
  // Sunday is rain but not the week's poorest - the exact shape of the
  // live finding - so the positive advice serves, never the negative.
  const facts = baseFacts({
    comingDays: [
      { weekday: "Saturday", date: "2026-10-24", solarKwh: 6.0, solarScore: 20, condition: "cloudy" },
      { weekday: "Sunday", date: "2026-10-25", solarKwh: 10.05, solarScore: 24, condition: "rain" },
      { weekday: "Monday", date: "2026-10-26", solarKwh: 3.0, solarScore: 14, condition: "sunny" },
    ],
  });
  const sat = section("sat", facts);
  assert.equal(
    sat.facts.advice,
    "With 6 kWh expected, it is a good day to run your large appliances on solar."
  );
  assert.ok(sat.fallback_sentences.includes(sat.facts.advice));
  assert.deepEqual(sat.notes, [
    { required: sat.facts.advice, append: sat.facts.advice },
  ]);
  assert.equal(sat.budget, 2);
  const sun = section("sun", facts);
  assert.equal(
    sun.facts.advice,
    "With 10.05 kWh expected, it is a good day to run your large appliances on solar."
  );
  const mon = section("mon", facts);
  assert.equal(mon.facts.advice, undefined);
  assert.ok(mon.fallback_sentences.every((s) => !s.includes("good day to run")));
  assert.equal(mon.budget, 1);
  // The woven advice passes parity: accepted, served exactly once.
  const stub = async () => ({
    narratives: {
      sat: `Saturday brings 6 kWh of sun. With 6 kWh expected, it is a good day to run your large appliances on solar.`,
      sun: `Sunday looks the best for solar: score 24 and 10.05 kWh expected. With 10.05 kWh expected, it is a good day to run your large appliances on solar.`,
    },
  });
  const { payload, sections: report } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  for (const key of ["sat", "sun"]) {
    const entry = report.find((s) => s.key === key);
    assert.equal(entry.offered, true, key);
    assert.equal(entry.ok, true, JSON.stringify(entry.reasons));
  }
  const satPayload = payload.find((s) => s.label === "SAT");
  assert.equal(
    satPayload.narrative.split(sat.facts.advice).length - 1,
    1,
    "the woven advice is not appended a second time"
  );
  const sunPayload = payload.find((s) => s.label === "SUN");
  assert.equal(
    sunPayload.narrative.split(sun.facts.advice).length - 1,
    1,
    "the woven advice is not appended a second time"
  );
  const audit = auditMonologueText(payload);
  assert.equal(audit.ok, true, JSON.stringify(audit.failures));
});

test("the negative rain advice keeps precedence over the positive advice", () => {
  // A rain-poorest day at or above the score threshold serves only the
  // negative advice - never both.
  const facts = baseFacts({
    comingDays: [
      { weekday: "Friday", date: "2026-10-23", solarKwh: 2.29, solarScore: 28, condition: "rain" },
      { weekday: "Sunday", date: "2026-10-25", solarKwh: 10.87, solarScore: 26, condition: "sunny" },
    ],
  });
  const fri = section("fri", facts);
  assert.equal(fri.facts.advice, RAIN_DAY_ADVICE);
  assert.ok(fri.fallback_sentences.includes(RAIN_DAY_ADVICE));
  assert.ok(
    fri.fallback_sentences.every(
      (s) => !s.includes("good day to run your large appliances on solar")
    ),
    "the positive advice never serves beside the negative advice"
  );
  assert.deepEqual(fri.notes, [
    { required: RAIN_DAY_ADVICE, append: RAIN_DAY_ADVICE },
  ]);
  assert.equal(fri.budget, 2);
});

test("weekday narratives may not conclude there is nothing worth doing without the negative advice", () => {
  // A neutral weekday section (not the week's best, not rain-poorest)
  // so the named weekday reason is the only rejection in play.
  const facts = baseFacts({
    comingDays: [
      { weekday: "Friday", date: "2026-10-23", solarKwh: 2.29, solarScore: 8, condition: "rain" },
      { weekday: "Saturday", date: "2026-10-24", solarKwh: 6.0, solarScore: 22, condition: "cloudy" },
      { weekday: "Sunday", date: "2026-10-25", solarKwh: 10.87, solarScore: 26, condition: "sunny" },
    ],
  });
  const sat = section("sat", facts);
  assert.equal(sat.facts.advice !== undefined, true);
  for (const text of [
    "The forecast is rain, so there is nothing worth doing.",
    "The day's figures are strong, yet the forecast is rain, so there is nothing worth doing.",
    "With rain in the forecast, the day is not worth acting on.",
    "The rain means there is nothing to act on.",
  ]) {
    const verdict = validateSectionNarrative(text, sat);
    assert.equal(verdict.ok, false, `expected rejection: ${text}`);
    assert.ok(
      verdict.reasons.some((r) => r.includes("without the served negative advice")),
      `expected a named weekday reason: ${text}`
    );
  }
  // The rain-poorest day carries the negative advice: the phrasing is
  // honest there and passes.
  const fri = section("fri", facts);
  assert.equal(fri.facts.advice, RAIN_DAY_ADVICE);
  const verdict = validateSectionNarrative(
    "With rain expected, there is nothing worth doing.",
    fri
  );
  assert.equal(verdict.ok, true, JSON.stringify(verdict.reasons));
});

test("the no-opportunity phrasing ban leaves TODAY and TOMORROW untouched", () => {
  const facts = baseFacts();
  const today = section("today", facts);
  const todayVerdict = validateSectionNarrative(
    "The remaining window is not worth acting on, so there is nothing worth doing.",
    today
  );
  assert.equal(todayVerdict.ok, true, JSON.stringify(todayVerdict.reasons));
  const tomorrow = section("tomorrow", facts);
  const tomorrowVerdict = validateSectionNarrative(
    "Tomorrow evening is not worth acting on.",
    tomorrow
  );
  assert.equal(tomorrowVerdict.ok, true, JSON.stringify(tomorrowVerdict.reasons));
});

test("a dry poorest day carries no rain-day advice", () => {
  const facts = baseFacts({
    comingDays: [
      { weekday: "Friday", date: "2026-10-23", solarKwh: 2.29, solarScore: 8, condition: "cloudy" },
      { weekday: "Sunday", date: "2026-10-25", solarKwh: 10.87, solarScore: 26, condition: "sunny" },
    ],
  });
  const fri = section("fri", facts);
  assert.equal(fri.facts.advice, undefined);
  assert.ok(fri.fallback_sentences.every((s) => s !== RAIN_DAY_ADVICE));
});

test("an action day carries the appliance facts verbatim and a budget of 5", () => {
  const facts = baseFacts({
    candidates: [
      { label: "dishwasher", kwh: 1.07, savingEur: 0.12, window: "11:00-14:00", worthwhile: true },
    ],
  });
  const today = section("today", facts);
  assert.equal(today.budget, 5);
  assert.equal(today.facts.action_available, true);
  assert.equal(today.facts.appliance_saving, "€0.12");
  assert.equal(today.facts.appliance_load, "1.07 kWh");
  // The imperative register: the command is generic, carries the window
  // and the price advantage, never the saving, and never frames an
  // opportunity; the specific appliance, its measured load and the
  // saving live in the supporting baseline sentence, exactly once.
  assert.ok(
    today.fallback_sentences.some(
      (s) =>
        s ===
        "Run your large appliances between 11:00 and 14:00 to pay today's lowest price, about €0.23/kWh against a day average of €0.31."
    )
  );
  assert.ok(
    today.fallback_sentences.some(
      (s) =>
        s === "Your dishwasher used 1.07 kWh today; shifting it into that window saves €0.12."
    )
  );
  const joined = today.fallback_sentences.join(" ");
  assert.equal(joined.split("€0.12").length - 1, 1, "the saving appears exactly once");
  assert.ok(!joined.includes("largest opportunity"));
  assert.ok(!joined.includes("Run the dishwasher"));
});

test("a battery action composes its own fallback sentence, never the large-appliances imperative", () => {
  const facts = baseFacts({
    candidates: [
      { label: "Battery recharge", kwh: 2.4, savingEur: 0.1217, window: "21:00-00:00", worthwhile: true },
    ],
  });
  const today = section("today", facts);
  assert.equal(today.facts.action_available, true);
  assert.equal(today.facts.appliance, "Battery recharge");
  assert.equal(today.facts.appliance_saving, "€0.12");
  assert.equal(today.facts.appliance_window, "21:00-00:00");
  assert.ok(
    today.fallback_sentences.includes(
      "The battery can recharge in 21:00-00:00 and save €0.12."
    )
  );
  const joined = today.fallback_sentences.join(" ");
  assert.ok(!joined.includes("Run your large appliances"));
  assert.ok(!joined.includes("Your Battery recharge used"));
  assert.equal(joined.split("€0.12").length - 1, 1, "the saving appears exactly once");
});

test("the fallback-only TODAY path serves the battery action sentence", async () => {
  const facts = baseFacts({
    candidates: [
      { label: "Battery recharge", kwh: 2.4, savingEur: 0.1217, window: "21:00-00:00", worthwhile: true },
    ],
  });
  const stub = async () => ({ narratives: { today: "This saves €9.99." } });
  const { payload } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  const today = payload.find((s) => s.label === "TODAY");
  assert.equal(today.narrative, null);
  assert.ok(
    today.fallback_sentences.includes(
      "The battery can recharge in 21:00-00:00 and save €0.12."
    )
  );
  const audit = auditMonologueText(payload);
  assert.equal(audit.ok, true, JSON.stringify(audit.failures));
});

test("a recap TODAY composes the battery action sentence with the recap sentences", () => {
  const facts = baseFacts({
    candidates: [
      { label: "Battery recharge", kwh: 2.4, savingEur: 0.1217, window: "21:00-00:00", worthwhile: true },
    ],
    solar_share_pct: 62,
    battery_earned_eur: 1.4,
    remainingWindow: { start: "21:00", end: "00:00", averageEur: 0.33, practicalBenefitEur: 0.02 },
    remainingAverageEur: 0.35,
    dayUsageKwh: 18.2,
    dayCostEur: 2.4,
    dayCheapestPassed: true,
  });
  const today = section("today", facts, RECAP_NOW);
  assert.equal(today.mode, "recap");
  assert.equal(today.budget, 5);
  assert.ok(today.fallback_sentences.includes("Your own solar covered 62% of today's usage."));
  assert.ok(today.fallback_sentences.includes("Your battery earned €1.40 today."));
  // The battery action sentence composes with the recap sentences and is
  // never squeezed out by the recap priorities.
  const batteryLine = "The battery can recharge in 21:00-00:00 and save €0.12.";
  assert.ok(today.fallback_sentences.includes(batteryLine));
  assert.equal(
    today.fallback_sentences[today.fallback_sentences.length - 1],
    batteryLine
  );
});

test("a coming day dated tomorrow belongs to TOMORROW only", () => {
  const facts = baseFacts({
    comingDays: [
      { weekday: "Wednesday", date: "2026-10-21", solarKwh: 5.0, solarScore: 20, condition: "cloudy" },
      { weekday: "Friday", date: "2026-10-23", solarKwh: 2.29, solarScore: 8, condition: "rain" },
    ],
  });
  const labels = monologueSections(facts).map((s) => s.label);
  assert.deepEqual(labels, ["TODAY", "TOMORROW", "FRI"]);
});

test("recap mode folds the evening window into TODAY with a budget of 4", () => {
  const facts = baseFacts({
    solar_share_pct: 62,
    battery_earned_eur: 1.4,
    remainingWindow: { start: "21:00", end: "00:00", averageEur: 0.33, practicalBenefitEur: 0.02 },
    remainingAverageEur: 0.35,
    dayUsageKwh: 18.2,
    dayCostEur: 2.4,
    dayCheapestPassed: true,
  });
  const today = section("today", facts, RECAP_NOW);
  assert.equal(today.mode, "recap");
  assert.equal(today.budget, 4);
  assert.equal(today.facts.solar_share, "62%");
  assert.equal(today.facts.battery_earned, "€1.40");
  assert.equal(today.facts.evening_window, "21:00-00:00");
  assert.equal(today.facts.evening_worth_using, false);
  assert.ok(today.fallback_sentences.includes("Your own solar covered 62% of today's usage."));
  assert.ok(today.fallback_sentences.includes("Your battery earned €1.40 today."));
  assert.ok(today.fallback_sentences.some((s) => s.startsWith("The remaining window is 21:00-00:00")));
  assert.ok(today.fallback_sentences.length <= 4);
});

test("a quiet plan day leads its fallback with the pinned no-opportunity statement", () => {
  const today = section("today");
  assert.ok(today.fallback_sentences.includes(NO_OPPORTUNITY_STATEMENT));
  assert.equal(today.facts.action_available, false);
});

test("a low-solar unpublished TOMORROW carries the hedged grid note in facts and fallback", () => {
  const tomorrow = section("tomorrow");
  assert.equal(tomorrow.facts.prices_published, false);
  // The served weekday name for tomorrow, from the facts layer.
  assert.equal(tomorrow.facts.weekday, "Wednesday");
  assert.equal(tomorrow.facts.solar_forecast, "2.2 kWh");
  assert.equal(tomorrow.facts.solar_today, "8.18 kWh");
  assert.equal(tomorrow.facts.grid_note, LOW_SOLAR_GRID_NOTE);
  assert.deepEqual(tomorrow.fallback_sentences, [
    TOMORROW_UNPUBLISHED_SENTENCE,
    "Little sun is forecast tomorrow: 2.2 kWh against 8.18 kWh today, so the house will lean on the grid and prices are usually firmer in that case; a better picture follows once tomorrow's prices are published.",
    HORIZON_NOTE,
  ]);
});

test("a non-low-solar unpublished TOMORROW carries no grid note and the plain solar sentence", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: false,
      prices: null,
      solarKwh: 11.99,
      solarScore: 28,
      lowSolar: false,
      compareSolarKwh: 8.18,
    },
  });
  const tomorrow = section("tomorrow", facts);
  assert.equal(tomorrow.facts.grid_note, undefined);
  assert.deepEqual(tomorrow.fallback_sentences, [
    TOMORROW_UNPUBLISHED_SENTENCE,
    "The forecast is 11.99 kWh of sun, against 8.18 kWh today.",
    HORIZON_NOTE,
  ]);
});

test("the horizon note serves with a published TOMORROW whenever sections beyond tomorrow exist", () => {
  // The owner decision of 22 October: parity with the retired card -
  // the note serves on the beyond-tomorrow condition alone, regardless
  // of tomorrow's publication status.
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: true,
      prices: [0.31, 0.3, 0.29],
      averageEur: 0.29,
      window: "13:00-16:00",
      windowAverageEur: 0.24,
      weekday: "Wednesday",
      solarKwh: 12.5,
      solarScore: 45,
      lowSolar: false,
      compareSolarKwh: 8.18,
    },
  });
  const tomorrow = section("tomorrow", facts);
  assert.equal(tomorrow.facts.horizon_note, HORIZON_NOTE);
  assert.equal(
    tomorrow.fallback_sentences[tomorrow.fallback_sentences.length - 1],
    HORIZON_NOTE,
    "the note is the final fallback sentence"
  );
  assert.ok(
    tomorrow.notes.some((note) => note.required === HORIZON_NOTE),
    "the parity append guarantees the note in the served narrative"
  );
});

test("the horizon note is absent when no sections beyond tomorrow exist", () => {
  // Published and unpublished alike: without beyond-tomorrow sections
  // the TOMORROW section carries no horizon note at all.
  const published = baseFacts({
    comingDays: [],
    tomorrow: {
      pricesPublished: true,
      prices: [0.31, 0.3, 0.29],
      averageEur: 0.29,
      window: "13:00-16:00",
      windowAverageEur: 0.24,
      weekday: "Wednesday",
      solarKwh: 12.5,
      solarScore: 45,
      lowSolar: false,
      compareSolarKwh: 8.18,
    },
  });
  const publishedTomorrow = section("tomorrow", published);
  assert.equal(publishedTomorrow.facts.horizon_note, undefined);
  assert.ok(!publishedTomorrow.fallback_sentences.includes(HORIZON_NOTE));
  assert.ok(!publishedTomorrow.notes.some((n) => n.required === HORIZON_NOTE));
  const unpublished = baseFacts({ comingDays: [] });
  const unpublishedTomorrow = section("tomorrow", unpublished);
  assert.ok(!unpublishedTomorrow.fallback_sentences.includes(HORIZON_NOTE));
  assert.ok(
    unpublishedTomorrow.fallback_sentences.includes(
      TOMORROW_UNPUBLISHED_SENTENCE
    ),
    "tomorrow's own unpublished sentence still serves"
  );
});

test("a published tomorrow serves its average, window and window average pre-formatted", () => {
  const facts = baseFacts({
    tomorrow: {
      pricesPublished: true,
      prices: [0.31, 0.3, 0.29],
      averageEur: 0.29,
      window: "13:00-16:00",
      windowAverageEur: 0.24,
      weekday: "Wednesday",
      solarKwh: 12.5,
      solarScore: 45,
      lowSolar: false,
      compareSolarKwh: 8.18,
    },
  });
  const tomorrow = section("tomorrow", facts);
  assert.equal(tomorrow.facts.average_price, "€0.29");
  assert.equal(tomorrow.facts.today_average, "€0.31");
  assert.equal(tomorrow.facts.cheap_window, "13:00-16:00");
  // The window's own average fact, so a narrative attributes a price to
  // the window from it, never from the day average.
  assert.equal(tomorrow.facts.cheap_window_average, "€0.24");
  assert.equal(tomorrow.facts.weekday, "Wednesday");
  assert.ok(tomorrow.fallback_sentences[0].startsWith("Tomorrow averages €0.29 per kWh"));
});

test("an unpublished tomorrow serves no window average", () => {
  const tomorrow = section("tomorrow");
  assert.equal(tomorrow.facts.prices_published, false);
  assert.equal(tomorrow.facts.cheap_window_average, undefined);
});

// ---------------------------------------------------------------------------
// The prompt builder: the style brief verbatim.
// ---------------------------------------------------------------------------

test("buildSectionPrompt embeds the style brief verbatim, one section at a time", () => {
  const today = section("today");
  const prompt = buildSectionPrompt(today);
  assert.ok(prompt.startsWith(MONOLOGUE_STYLE_BRIEF));
  assert.ok(prompt.includes("Write the TODAY section of the advisory."));
  assert.ok(prompt.includes('"low_price":"€0.23"'));
  assert.ok(!prompt.includes('"solar_forecast":"2.2 kWh"')); // tomorrow's facts stay in tomorrow
  assert.ok(!prompt.includes("Your previous attempt was rejected")); // no feedback on a first attempt
});

test("a TODAY section prompt carries only its own facts, never another section's", () => {
  const sections = monologueSections();
  const today = sections.find((s) => s.key === "today");
  const prompt = buildSectionPrompt(today);
  // The section's own fact set, verbatim.
  assert.ok(prompt.includes(`Facts: ${JSON.stringify(today.facts)}`));
  // No other section's fact value leaks into the prompt. Values that
  // TODAY legitimately serves itself (its actual solar is tomorrow's
  // comparison figure) are its own; everything else stays out.
  const ownValues = new Set(Object.values(today.facts));
  for (const other of sections.filter((s) => s.key !== "today")) {
    for (const value of Object.values(other.facts)) {
      if (
        typeof value === "string" &&
        value !== "" &&
        !ownValues.has(value)
      ) {
        assert.ok(
          !prompt.includes(JSON.stringify(value)),
          `foreign value ${value}`
        );
      }
    }
  }
});

test("buildSectionPrompt appends the rejection reasons as retry feedback, nothing else", () => {
  const today = section("today");
  const reasons = [
    'amount "€0.51" matches no served amount in this section (amounts carry the currency marker exactly as served; never compute a difference or total; state the amounts side by side exactly as served)',
    "contains an exclamation mark; model sentences are warm but factual",
  ];
  const prompt = buildSectionPrompt(today, reasons);
  assert.ok(prompt.startsWith(MONOLOGUE_STYLE_BRIEF));
  assert.ok(prompt.endsWith(
    "Your previous attempt was rejected for these reasons: " +
      'amount "€0.51" matches no served amount in this section (amounts carry the currency marker exactly as served; never compute a difference or total; state the amounts side by side exactly as served); ' +
      "contains an exclamation mark; model sentences are warm but factual. " +
      "Write the section again, correcting exactly these issues; every figure must be a verbatim copy of a served fact of this section."
  ));
  // The feedback line carries the section's own facts and the brief, so the
  // retry corrects against the same self-contained prompt plus the reasons.
  assert.ok(prompt.includes(`Facts: ${JSON.stringify(today.facts)}`));
  // An empty or absent reasons list produces the plain first-attempt prompt.
  assert.ok(!buildSectionPrompt(today, []).includes("Your previous attempt was rejected"));
});

test("the style brief carries the tuning register: generic imperatives without the saving, note weaving, context sentence, best-day framing", () => {
  const brief = MONOLOGUE_STYLE_BRIEF;
  assert.ok(
    brief.includes(
      "speak of your large appliances and never name a specific appliance"
    )
  );
  assert.ok(
    brief.includes("a run instruction names the window and the price advantage and never the saving")
  );
  // The supporting-sentence example keeps only its form: bracketed
  // slots, never concrete figures.
  assert.ok(
    brief.includes(
      "Your [appliance] used [appliance_load] today; shifting it into that window saves [appliance_saving]."
    )
  );
  assert.ok(!brief.includes("1.07"));
  assert.ok(!brief.includes("€0.12"));
  assert.ok(
    brief.includes(
      "When the section is TODAY and there is a real action with a small saving, you may close with one meaning-only sentence that puts the saving in perspective"
    )
  );
  assert.ok(
    brief.includes(
      "It never states a yearly or monthly amount, never carries any figure, and appears at most once."
    )
  );
  assert.ok(
    brief.includes(
      "When the facts carry a served note, weave it into your narrative word for word where it fits best."
    )
  );
  assert.ok(brief.includes("spend one sentence on that household context"));
  assert.ok(
    brief.includes(
      "When the facts mark this section as the week's best solar day, keep the forecast framing, with its own score and expected energy."
    )
  );
  assert.ok(
    brief.includes(
      "Attribute a price to a window only from the window's own average fact, never from the day average."
    )
  );
  // The date ban: calendar dates and years never appear in prose; the
  // weekday label anchors the day.
  assert.ok(
    brief.includes(
      "Never write calendar dates or years; the weekday label already anchors the day."
    )
  );
  // No computed differences or totals between served amounts.
  assert.ok(
    brief.includes(
      "Never compute a difference or a total between served amounts; state each amount exactly as served and compare by placing them side by side."
    )
  );
  // Weekday sections speak of their day by weekday name only.
  assert.ok(
    brief.includes(
      "In a weekday section, refer to the day only by its weekday name; never write 'today'."
    )
  );
  // Tomorrow's weekday comes from the served fact, never a guess.
  assert.ok(
    brief.includes(
      "Use the served weekday name for tomorrow; never guess the day of the week."
    )
  );
  // The battery recharge load is future draw, never "used today".
  assert.ok(
    brief.includes(
      "For the battery recharge action, the load is what the recharge will draw, not what it used today; never write that the battery used its load today."
    )
  );
  // A saving is stated as served, never explained by a constructed
  // comparison.
  assert.ok(
    brief.includes(
      "State a saving exactly as served; never construct a price comparison to explain it."
    )
  );
  // Weather words stay within the served condition.
  assert.ok(
    brief.includes(
      "Describe the weather only as the served condition states; add no other weather words."
    )
  );
  // The owner decision of 22 October: the condition never carries the
  // judgment; a rainy day can still deliver strong solar output.
  assert.ok(
    brief.includes(
      "The condition describes the weather, never the production; never conclude from the condition alone that there is nothing worth doing; a rainy day can still deliver strong solar output."
    )
  );
  // The register stays uncontracted.
  assert.ok(brief.includes("No contractions: write 'it is', not 'it's'."));
  // Self-containment: the brief never invites cross-day mentions or
  // carries another section's figures.
  assert.ok(!brief.includes("Mention other days"));
  assert.ok(!brief.includes("10.87"));
  assert.ok(!brief.includes("score 26"));
});

// ---------------------------------------------------------------------------
// Per-section validation: figure-verbatim replaces the figure ban; the
// other narrative guards stay.
// ---------------------------------------------------------------------------

test("validateSectionNarrative accepts verbatim prose and rejects each guard class", () => {
  const today = section("today");
  const clean =
    "Today's lowest price is €0.23 at 13:00 and the peak is €0.46 at 19:00.";
  assert.equal(validateSectionNarrative(clean, today).ok, true);

  // The replaced ban: figures are now allowed when verbatim (P1 world).
  assert.deepEqual(validateSectionNarrative(clean, today).reasons, []);

  for (const [narrative, pattern] of [
    ["The low is €0.23 at 13:00!", /exclamation mark/],
    ["Prices hit EUR 0.31 at 16:00.", /no served amount/],
    ["The saving is 0.31 - 0.23.", /arithmetic expression/],
    ["The C17 gate is open.", /internal vocabulary/],
    ["The average is NaN.", /NaN/],
    ["Well done on the solar today.", /flattery/],
    ["No action worth taking today.", /no-opportunity statement/],
  ]) {
    const verdict = validateSectionNarrative(narrative, today);
    assert.equal(verdict.ok, false, `expected rejection: ${narrative}`);
    assert.ok(verdict.reasons.some((r) => pattern.test(r)), `${narrative}: ${verdict.reasons.join(" | ")}`);
  }
});

test("a tomorrow price in prose rejects while tomorrow is unpublished", () => {
  const tomorrow = section("tomorrow");
  const verdict = validateSectionNarrative(
    "Tomorrow will be cheap at €0.19 per kWh.",
    tomorrow,
    { tomorrowPublished: false }
  );
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some((r) => /not published/.test(r)));
});

test("the week-best framing rule accepts a best-framed SUN narrative and rejects a poor one", () => {
  const sun = section("sun"); // baseFacts marks Sunday the week's best
  assert.equal(sun.facts.week_best, true);
  // Accepts: the narrative frames the day as the week's best.
  const best = validateSectionNarrative(
    "Sunday looks the best for solar: score 26 and 10.87 kWh expected.",
    sun
  );
  assert.equal(best.ok, true, best.reasons.join(" | "));
  // Rejects: the live failure, the week's best day called a poor day.
  const poor = validateSectionNarrative(
    "Sunday looks like a poor solar day at 10.87 kWh.",
    sun
  );
  assert.equal(poor.ok, false);
  assert.ok(
    poor.reasons.includes(
      "the facts mark this day as the week's best solar day; frame it as the week's best"
    )
  );
  // Rejects: no framing as the week's best at all.
  const noBest = validateSectionNarrative(
    "Sunday brings 10.87 kWh of sun at score 26.",
    sun
  );
  assert.equal(noBest.ok, false);
  assert.ok(
    noBest.reasons.includes(
      "the facts mark this day as the week's best solar day; frame it as the week's best"
    )
  );
  // Inert on a section without the marker: the poorest day may say poor.
  const fri = section("fri");
  assert.equal(fri.facts.week_best, false);
  assert.equal(
    validateSectionNarrative("Friday looks like the week's weakest solar day.", fri).ok,
    true
  );
});

// ---------------------------------------------------------------------------
// Orchestration: one retry per section, then the fallback sentences.
// ---------------------------------------------------------------------------

test("generateMonologue accepts clean narratives on the first call", async () => {
  const facts = baseFacts();
  let todayCalls = 0;
  const stub = async (prompt) => {
    if (prompt.includes("Write the TODAY section")) todayCalls += 1;
    return {
      narratives: {
        today: "Today's lowest price is €0.23 at 13:00 and the peak is €0.46 at 19:00.",
      },
    };
  };
  const { payload, sections } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  const today = sections.find((s) => s.key === "today");
  assert.equal(todayCalls, 1, "one call for the section whose narrative was offered");
  assert.equal(today.ok, true);
  assert.equal(today.offered, true);
  assert.equal(today.sentenceCount, 2); // the model sentence plus the appended statement
  const todayPayload = payload.find((s) => s.label === "TODAY");
  assert.equal(typeof todayPayload.narrative, "string");
  assert.ok(todayPayload.narrative.includes(NO_OPPORTUNITY_STATEMENT));
  assert.ok(Array.isArray(todayPayload.fallback_sentences));
  assert.equal(todayPayload.facts.low_price, "€0.23");
  // Sections without a stub narrative serve their fallbacks, no rejection.
  const sun = sections.find((s) => s.key === "sun");
  assert.equal(sun.offered, false);
  assert.equal(sun.ok, true);
  const sunPayload = payload.find((s) => s.label === "SUN");
  assert.equal(sunPayload.narrative, null);
  // The strong Sunday serves its day line plus the positive advice.
  assert.equal(sunPayload.fallback_sentences.length, 2);
});

test("generateMonologue retries once per section, then serves the fallback", async () => {
  const facts = baseFacts();
  let todayCalls = 0;
  const stub = async (prompt) => {
    if (prompt.includes("Write the TODAY section")) todayCalls += 1;
    return { narratives: { today: "You could save €0.51 this afternoon." } };
  };
  const { payload, sections } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  const today = sections.find((s) => s.key === "today");
  assert.equal(todayCalls, 2, "exactly one retry for the failing section");
  assert.equal(today.ok, false);
  assert.equal(today.retried, true);
  assert.ok(today.reasons.some((r) => r.includes("€0.51")));
  // Each rejected attempt is reported with its own readable reasons,
  // one entry per attempt, so a fallback is diagnosable from the log.
  assert.equal(today.rejected_attempts.length, 2);
  assert.deepEqual(
    today.rejected_attempts.map((a) => a.attempt),
    [1, 2]
  );
  for (const attempt of today.rejected_attempts) {
    assert.ok(attempt.reasons.some((r) => r.includes("€0.51")));
  }
  const todayPayload = payload.find((s) => s.label === "TODAY");
  assert.equal(todayPayload.narrative, null);
  assert.ok(todayPayload.fallback_sentences.includes(NO_OPPORTUNITY_STATEMENT));
});

test("a rejected first attempt reports its reasons even when the retry accepts", async () => {
  const facts = baseFacts();
  let calls = 0;
  const stub = async (prompt) => {
    if (!prompt.includes("Write the TODAY section")) return {};
    calls += 1;
    return {
      narratives: {
        today:
          calls === 1
            ? "You could save €0.51 this afternoon."
            : "Today's lowest price is €0.23 at 13:00 and the peak is €0.46 at 19:00.",
      },
    };
  };
  const { sections } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  const today = sections.find((s) => s.key === "today");
  assert.equal(today.ok, true);
  assert.equal(today.retried, true);
  assert.equal(today.rejected_attempts.length, 1);
  assert.equal(today.rejected_attempts[0].attempt, 1);
  assert.ok(today.rejected_attempts[0].reasons.some((r) => r.includes("€0.51")));
});

test("the retry's model call receives the previous rejection reasons as prompt feedback", async () => {
  const facts = baseFacts();
  const todayPrompts = [];
  const stub = async (prompt) => {
    if (!prompt.includes("Write the TODAY section")) return {};
    todayPrompts.push(prompt);
    return { narratives: { today: "You could save €0.51 this afternoon." } };
  };
  await generateMonologue(buildSections(facts, NOW), facts, NOW, stub);
  assert.equal(todayPrompts.length, 2, "the first attempt and one retry");
  // The first attempt is the plain self-contained prompt.
  assert.ok(!todayPrompts[0].includes("Your previous attempt was rejected"));
  // The retry carries the rejection reasons verbatim as feedback.
  assert.ok(
    todayPrompts[1].startsWith(MONOLOGUE_STYLE_BRIEF),
    "the retry keeps the brief"
  );
  assert.ok(
    todayPrompts[1].includes(
      "Your previous attempt was rejected for these reasons:"
    )
  );
  assert.ok(
    todayPrompts[1].includes(
      'amount "€0.51" matches no served amount in this section (amounts carry the currency marker exactly as served; never compute a difference or total; state the amounts side by side exactly as served)'
    )
  );
  assert.ok(
    todayPrompts[1].endsWith(
      "Write the section again, correcting exactly these issues; every figure must be a verbatim copy of a served fact of this section."
    )
  );
});

test("buildSectionPrompt deduplicates identical rejection reasons, preserving order", () => {
  const today = section("today");
  const r1 =
    'amount "€0.51" matches no served amount in this section (amounts carry the currency marker exactly as served; never compute a difference or total; state the amounts side by side exactly as served)';
  const r2 = "contains an exclamation mark; model sentences are warm but factual";
  const prompt = buildSectionPrompt(today, [r1, r2, r1, r2, r1]);
  assert.equal(
    prompt.split(r1).length - 1,
    1,
    "an identical reason appears once in the feedback line"
  );
  assert.equal(prompt.split(r2).length - 1, 1);
  assert.ok(
    prompt.indexOf(r1) < prompt.indexOf(r2),
    "the first occurrence's order is preserved"
  );
});

test("the retry feedback line deduplicates the reasons of one failed attempt", async () => {
  const facts = baseFacts();
  const todayPrompts = [];
  const stub = async (prompt) => {
    if (!prompt.includes("Write the TODAY section")) return {};
    todayPrompts.push(prompt);
    // The same fabricated amount twice: two identical rejection
    // reasons from one attempt.
    return { narratives: { today: "You could save €0.51 today or €0.51 tonight." } };
  };
  await generateMonologue(buildSections(facts, NOW), facts, NOW, stub);
  assert.equal(todayPrompts.length, 2);
  const reason =
    'amount "€0.51" matches no served amount in this section (amounts carry the currency marker exactly as served; never compute a difference or total; state the amounts side by side exactly as served)';
  assert.equal(
    todayPrompts[1].split(reason).length - 1,
    1,
    "the repeated figure yields one deduped reason in the retry prompt"
  );
});

test("generateMonologue survives a throwing stub by serving fallbacks", async () => {
  const facts = baseFacts();
  const { sections } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    async () => {
      throw new Error("stub failure");
    }
  );
  assert.ok(sections.every((s) => s.offered === false && s.ok === true));
});

test("generateMonologue collapses internal whitespace in the produced narrative", async () => {
  const facts = baseFacts();
  const stub = async () => ({
    narratives: {
      today:
        "Today's lowest price is €0.23 at 13:00.\n\tThe peak is €0.46 at 19:00.\n\n  A calm day overall.  ",
    },
  });
  const { payload, sections } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  const today = payload.find((s) => s.label === "TODAY");
  assert.ok(
    today.narrative.startsWith(
      "Today's lowest price is €0.23 at 13:00. The peak is €0.46 at 19:00. A calm day overall."
    ),
    today.narrative
  );
  // No newline, tab or space run survives into the stored narrative.
  assert.ok(!today.narrative.includes("\n"));
  assert.ok(!today.narrative.includes("\t"));
  assert.ok(!/ {2}/.test(today.narrative));
  // The validation ran against the collapsed narrative and accepted it.
  const report = sections.find((s) => s.key === "today");
  assert.equal(report.ok, true);
});

// ---------------------------------------------------------------------------
// Content parity for server-owned notes: every note a section serves must
// appear verbatim in the final narrative; missing notes are appended,
// woven notes are never duplicated.
// ---------------------------------------------------------------------------

test("content parity: missing notes are appended verbatim, woven notes are not duplicated", async () => {
  const facts = baseFacts(); // quiet TODAY, low-solar unpublished TOMORROW, rain-poorest FRI
  const stub = async () => ({
    narratives: {
      today: "The afternoon looks calm.",
      tomorrow:
        `Tomorrow brings much less sun than today: 2.2 kWh against 8.18 kWh, ` +
        `${LOW_SOLAR_GRID_NOTE}.`,
      fri: "Friday will be wet.",
    },
  });
  const { payload } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  // TODAY: the pinned statement is appended (the model never writes it).
  const today = payload.find((s) => s.label === "TODAY");
  assert.ok(today.narrative.startsWith("The afternoon looks calm."));
  assert.ok(today.narrative.includes(NO_OPPORTUNITY_STATEMENT));
  // TOMORROW: the grid note is woven, so only the horizon appends.
  const tomorrow = payload.find((s) => s.label === "TOMORROW");
  assert.equal(
    tomorrow.narrative.match(new RegExp(LOW_SOLAR_GRID_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))
      ?.length,
    1,
    "the woven grid note is not appended a second time"
  );
  assert.ok(tomorrow.narrative.includes(HORIZON_NOTE));
  // FRI: the pinned rain-day advice is appended.
  const fri = payload.find((s) => s.label === "FRI");
  assert.ok(fri.narrative.includes(RAIN_DAY_ADVICE));
});

test("content parity: the grid note rides the composed hedged sentence when not woven", async () => {
  const facts = baseFacts();
  const stub = async () => ({
    narratives: { tomorrow: "Tomorrow will be dull." },
  });
  const { payload, sections } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  const tomorrow = payload.find((s) => s.label === "TOMORROW");
  const expectedAppend =
    "Little sun is forecast tomorrow: 2.2 kWh against 8.18 kWh today, " +
    `${LOW_SOLAR_GRID_NOTE}.`;
  assert.ok(tomorrow.narrative.includes("Tomorrow will be dull."));
  assert.ok(tomorrow.narrative.includes(expectedAppend));
  assert.ok(tomorrow.narrative.includes(HORIZON_NOTE));
  const report = sections.find((s) => s.key === "tomorrow");
  assert.equal(report.sentenceCount, 3); // dull + hedged + horizon, budget 3
  // The appended prose passes the sentence audit.
  const audit = auditMonologueText(payload);
  assert.equal(audit.ok, true, JSON.stringify(audit.failures));
});

test("content parity: the woven horizon note is not appended a second time", async () => {
  const facts = baseFacts();
  const stub = async () => ({
    narratives: {
      tomorrow: `Tomorrow's prices are not published yet. ${HORIZON_NOTE}`,
    },
  });
  const { payload, sections } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    stub
  );
  const tomorrow = payload.find((s) => s.label === "TOMORROW");
  assert.equal(
    tomorrow.narrative.split(HORIZON_NOTE).length - 1,
    1,
    "the woven horizon note serves exactly once"
  );
  const report = sections.find((s) => s.key === "tomorrow");
  assert.equal(report.offered, true);
  assert.equal(report.ok, true);
  // The woven prose passes the sentence audit.
  const audit = auditMonologueText(payload);
  assert.equal(audit.ok, true, JSON.stringify(audit.failures));
});

test("content parity: qualifying achievement lines append to a recap narrative that omits them", async () => {
  const facts = baseFacts({
    solar_share_pct: 62,
    battery_earned_eur: 1.4,
    remainingWindow: { start: "21:00", end: "00:00", averageEur: 0.33, practicalBenefitEur: 0.02 },
    remainingAverageEur: 0.35,
    dayUsageKwh: 18.2,
    dayCostEur: 2.4,
    dayCheapestPassed: true,
  });
  const stub = async () => ({ narratives: { today: "The day ran quietly." } });
  const { payload } = await generateMonologue(
    buildSections(facts, RECAP_NOW),
    facts,
    RECAP_NOW,
    stub
  );
  const today = payload.find((s) => s.label === "TODAY");
  assert.ok(today.narrative.includes("The day ran quietly."));
  assert.ok(today.narrative.includes("Your own solar covered 62% of today's usage."));
  assert.ok(today.narrative.includes("Your battery earned €1.40 today."));
  const audit = auditMonologueText(payload);
  assert.equal(audit.ok, true, JSON.stringify(audit.failures));
});

test("the monologue payload shape is label, narrative, fallback_sentences, facts", async () => {
  const facts = baseFacts();
  const { payload } = await generateMonologue(
    buildSections(facts, NOW),
    facts,
    NOW,
    async () => ({})
  );
  for (const sectionPayload of payload) {
    assert.deepEqual(
      Object.keys(sectionPayload).sort(),
      ["facts", "fallback_sentences", "label", "narrative"]
    );
  }
});

// ---------------------------------------------------------------------------
// The monologue prose audit.
// ---------------------------------------------------------------------------

test("auditMonologueText accepts clean served prose and fallbacks", () => {
  const sections = monologueSections();
  const payload = sections.map((s) => ({
    label: s.label,
    narrative: null,
    fallback_sentences: s.fallback_sentences,
    facts: s.facts,
  }));
  const audit = auditMonologueText(payload);
  assert.equal(audit.ok, true, JSON.stringify(audit.failures));
});

test("auditMonologueText rejects a lowercase opening, a missing period, the EUR code and flattery", () => {
  const payload = [
    {
      label: "TODAY",
      narrative: "the low is €0.23 at 13:00. Well done, EUR 0.23 saved.",
      fallback_sentences: [],
      facts: {},
    },
  ];
  const audit = auditMonologueText(payload);
  assert.equal(audit.ok, false);
  const rules = audit.failures.map((f) => `${f.path}: ${f.rule}`);
  assert.ok(rules.some((x) => x.includes("sentence must open")));
  assert.ok(rules.some((x) => x.includes("never the code EUR")));
  assert.ok(rules.some((x) => x.includes('"well done"')));
  assert.ok(audit.failures.every((f) => f.path.startsWith("monologue[0] TODAY")));
});

test("auditMonologueText treats the pinned no-opportunity statement as a title", () => {
  const audit = auditMonologueText([
    {
      label: "TODAY",
      narrative: null,
      fallback_sentences: ["Today was quiet.", NO_OPPORTUNITY_STATEMENT],
      facts: {},
    },
  ]);
  assert.equal(audit.ok, true, JSON.stringify(audit.failures));
});
