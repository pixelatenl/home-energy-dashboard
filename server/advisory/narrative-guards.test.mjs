// Unit tests for narrative-guards.mjs (node:test). The five guards of
// contract section 6: the tomorrow-price prohibition while unpublished,
// the beyond-tomorrow price prohibition, the arithmetic-expression ban,
// the internal vocabulary ban, and the NaN/Infinity ban. Each guard is a
// pure function returning { ok, problems }.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  guardTomorrowPrice,
  guardBeyondTomorrowPrice,
  guardArithmetic,
  guardInternalVocabulary,
  guardNonFiniteText,
  guardNoFigures,
  guardRegister,
  guardActionRestatement,
  guardNoOpportunityPhrasing,
  guardWeekBestFraming,
} from "./narrative-guards.mjs";

// The selected candidate the restatement tests run against, in the today
// section's fact shape (contract section 3).
const CANDIDATE = {
  label: "dishwasher",
  kwh: 1.07,
  saving_eur: 0.12,
  window: "14:00-17:00",
};

test("guardTomorrowPrice: rejects tomorrow prices while unpublished only", () => {
  const text = "Tomorrow will be cheap at EUR 0.19 per kWh.";
  assert.equal(guardTomorrowPrice(text, { tomorrowPublished: false }).ok, false);
  assert.equal(guardTomorrowPrice(text, { tomorrowPublished: true }).ok, true);
  // No price figure: solar talk about tomorrow is fine.
  assert.equal(
    guardTomorrowPrice("Tomorrow brings 12 kWh of sun.", { tomorrowPublished: false }).ok,
    true
  );
});

test("guardTomorrowPrice: rejects the day-after and next-day paraphrases while unpublished", () => {
  for (const text of [
    "Prices for the day after today will sit around EUR 0.20.",
    "The next day looks like EUR 0.15 per kWh.",
  ]) {
    assert.equal(
      guardTomorrowPrice(text, { tomorrowPublished: false }).ok,
      false,
      `expected rejection: ${text}`
    );
    assert.equal(guardTomorrowPrice(text, { tomorrowPublished: true }).ok, true);
  }
  // Paraphrases without a currency figure stay allowed (qualitative talk).
  assert.equal(
    guardTomorrowPrice("The day after today brings much less sun.", {
      tomorrowPublished: false,
    }).ok,
    true
  );
});

test("guardBeyondTomorrowPrice: rejects weekday and dated prices beyond tomorrow", () => {
  assert.equal(guardBeyondTomorrowPrice("Friday should be EUR 0.20 per kWh.").ok, false);
  assert.equal(guardBeyondTomorrowPrice("On 2026-10-23 expect EUR 0.20.").ok, false);
  assert.equal(guardBeyondTomorrowPrice("Next week looks like EUR 0.15.").ok, false);
  // Today and tomorrow price talk is not beyond tomorrow.
  assert.equal(
    guardBeyondTomorrowPrice("Today averages EUR 0.38 per kWh.").ok,
    true
  );
});

test("guardArithmetic: rejects expressions but not window ranges", () => {
  assert.equal(guardArithmetic("The saving is 0.38 - 0.26 per kWh.").ok, false);
  assert.equal(guardArithmetic("That works out to 1.07 * 0.12 euros.").ok, false);
  assert.equal(guardArithmetic("Run it between 14:00 and 17:00.").ok, true);
  assert.equal(guardArithmetic("The window is 14:00-17:00.").ok, true);
});

test("guardInternalVocabulary: rejects project-internal terms", () => {
  for (const text of [
    "The C17 gate passed.",
    "This phase uses a spread threshold.",
    "The cache signature changed.",
    "SOC is at 72 percent.",
  ]) {
    assert.equal(guardInternalVocabulary(text).ok, false, `expected rejection: ${text}`);
  }
  assert.equal(
    guardInternalVocabulary("Run the dishwasher in the cheap window.").ok,
    true
  );
});

test("guardNonFiniteText: rejects NaN and Infinity placeholders", () => {
  assert.equal(guardNonFiniteText("The average is NaN.").ok, false);
  assert.equal(guardNonFiniteText("Prices hit Infinity.").ok, false);
  assert.equal(guardNonFiniteText("A perfectly ordinary sentence.").ok, true);
});

test("guardNoFigures: rejects digits, currency and percent markers", () => {
  for (const text of [
    "Your own solar covered 62% of today's usage.",
    "You used 45 kWh today.",
    "Your battery earned €3.50 today.",
    "Tomorrow averages around EUR 0.29 per kWh.",
    "The low is EUR 0.25 at 12:00.",
  ]) {
    const verdict = guardNoFigures(text);
    assert.equal(verdict.ok, false, `expected rejection: ${text}`);
    assert.ok(verdict.problems.some((p) => /figure marker/.test(p)));
  }
});

test("guardNoFigures: accepts meaning-only sentences and never reads words as figures", () => {
  for (const text of [
    "The afternoon looks calm, so there is room to fit in a run.",
    "Tomorrow brings much less sun.",
    "A trip across Europe is lovely.",
    "The washing machine can wait until the evening.",
  ]) {
    assert.equal(guardNoFigures(text).ok, true, `expected acceptance: ${text}`);
  }
});

test("guardRegister: rejects exclamation marks with a readable reason", () => {
  const verdict = guardRegister("Prices spike soon!");
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((p) => /exclamation mark/.test(p)));
});

test("guardRegister: rejects each flattery word", () => {
  for (const word of [
    "congratulations",
    "well done",
    "great job",
    "awesome",
    "amazing",
    "superb",
    "fantastic",
    "brilliant",
    "wonderful",
  ]) {
    const verdict = guardRegister(`Really ${word} today, the house ran itself.`);
    assert.equal(verdict.ok, false, `expected rejection for: ${word}`);
    assert.ok(verdict.problems.some((p) => p.includes(word)));
  }
});

test("guardRegister: accepts warm factual sentences without flattery", () => {
  assert.equal(
    guardRegister("The day is running quietly and the evening looks calm.").ok,
    true
  );
});

test("all guards accept empty and null text", () => {
  for (const guard of [
    (t) => guardTomorrowPrice(t, {}),
    guardBeyondTomorrowPrice,
    guardArithmetic,
    guardInternalVocabulary,
    guardNonFiniteText,
    guardNoFigures,
    guardRegister,
    (t) => guardActionRestatement(t, {}),
    guardNoOpportunityPhrasing,
    (t) => guardWeekBestFraming(t, { week_best: true }),
  ]) {
    assert.equal(guard(null).ok, true);
    assert.equal(guard("").ok, true);
    assert.deepEqual(guard("   ").problems, []);
  }
});

test("guard problems are human-readable rejection reasons", () => {
  const verdict = guardTomorrowPrice(
    "Tomorrow will be cheap at EUR 0.19 per kWh.",
    { tomorrowPublished: false }
  );
  assert.equal(verdict.ok, false);
  assert.ok(Array.isArray(verdict.problems) && verdict.problems.length > 0);
  for (const problem of verdict.problems) {
    assert.equal(typeof problem, "string");
    assert.ok(problem.trim().length > 0);
  }
});

// ---------------------------------------------------------------------------
// Contract section 4: the action-restatement ban.
// ---------------------------------------------------------------------------

test("guardActionRestatement: inert when no candidate exists", () => {
  const text = "Run the dishwasher in the 14:00-17:00 window to save EUR 0.12.";
  assert.equal(guardActionRestatement(text, {}).ok, true);
  assert.equal(guardActionRestatement(text, { candidate: null }).ok, true);
});

test("guardActionRestatement: rejects the action's appliance name", () => {
  const verdict = guardActionRestatement(
    "The dishwasher is a good run for this window.",
    { candidate: CANDIDATE }
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems[0], /appliance name/);
});

test("guardActionRestatement: rejects the action's saving figure", () => {
  const verdict = guardActionRestatement(
    "It saves EUR 0.12 on a full load.",
    { candidate: CANDIDATE }
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems[0], /saving figure/);
});

test("guardActionRestatement: rejects the action's kWh load", () => {
  const verdict = guardActionRestatement(
    "A 1.07 kWh run fits the window well.",
    { candidate: CANDIDATE }
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems[0], /load of 1\.07 kWh/);
});

test("guardActionRestatement: rejects the action's window in range and word form", () => {
  assert.equal(
    guardActionRestatement("The window is 14:00-17:00.", { candidate: CANDIDATE }).ok,
    false
  );
  assert.equal(
    guardActionRestatement("Run it between 14:00 and 17:00.", { candidate: CANDIDATE }).ok,
    false
  );
});

test("guardActionRestatement: accepts a meaning-only note", () => {
  const verdict = guardActionRestatement(
    "The afternoon looks calm, so there is room to fit in a run.",
    { candidate: CANDIDATE }
  );
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.problems, []);
});

test("guardActionRestatement: unrelated figures do not trip the guard", () => {
  // The day average and tomorrow's solar are not the action's numbers.
  const verdict = guardActionRestatement(
    "The day averages EUR 0.38 per kWh with 14.4 kWh of sun so far.",
    { candidate: CANDIDATE }
  );
  assert.equal(verdict.ok, true);
});

// ---------------------------------------------------------------------------
// Contract section 4: the no-opportunity and deferral-phrasing ban.
// ---------------------------------------------------------------------------

test("guardNoOpportunityPhrasing: rejects the server-injected statement", () => {
  for (const text of [
    "No action worth taking today.",
    "no action worth taking today",
    "In short: no action worth taking today, so sit tight.",
  ]) {
    assert.equal(guardNoOpportunityPhrasing(text).ok, false, `expected rejection: ${text}`);
  }
});

test("guardNoOpportunityPhrasing: rejects deferral advice", () => {
  for (const text of [
    "Just wait until tomorrow for the cheaper prices.",
    "It is best to hold off until the weekend.",
    "You can keep waiting until later this week.",
  ]) {
    assert.equal(guardNoOpportunityPhrasing(text).ok, false, `expected rejection: ${text}`);
  }
});

test("guardNoOpportunityPhrasing: accepts quiet-day notes without deferral", () => {
  for (const text of [
    "No appliance run-up clears the bar today, so there is nothing to schedule.",
    "The savings on offer today are too small to be worth shifting a run for.",
    "Little sun is expected tomorrow, so the house will lean on the grid.",
  ]) {
    assert.equal(guardNoOpportunityPhrasing(text).ok, true, `expected acceptance: ${text}`);
  }
});

test("guardNoOpportunityPhrasing: the weekday ban rejects no-opportunity variants unless the negative advice is served", () => {
  // The owner decision of 22 October: in weekday sections only, the
  // variants are rejected with a named reason.
  for (const text of [
    "The forecast is rain, so there is nothing worth doing.",
    "With rain in the forecast, the day is not worth acting on.",
    "The rain means there is nothing to act on.",
  ]) {
    const verdict = guardNoOpportunityPhrasing(text, {
      weekdaySection: true,
      negativeAdviceServed: false,
    });
    assert.equal(verdict.ok, false, `expected rejection: ${text}`);
    assert.ok(
      verdict.problems.every((p) => p.includes("without the served negative advice")),
      `expected named weekday reasons: ${text}`
    );
  }
  // The negative advice lifts the ban.
  assert.equal(
    guardNoOpportunityPhrasing("With rain expected, there is nothing worth doing.", {
      weekdaySection: true,
      negativeAdviceServed: true,
    }).ok,
    true
  );
  // TODAY and TOMORROW are never touched by the weekday ban.
  for (const text of [
    "The remaining window is not worth acting on, so there is nothing worth doing.",
    "Tomorrow evening is not worth acting on.",
  ]) {
    assert.equal(
      guardNoOpportunityPhrasing(text).ok,
      true,
      `expected acceptance outside weekday sections: ${text}`
    );
  }
});

// ---------------------------------------------------------------------------
// The week-best framing rule.
// ---------------------------------------------------------------------------

test("guardWeekBestFraming accepts a best-framed narrative on a week-best day", () => {
  const facts = { week_best: true, solar_kwh: "10.87 kWh" };
  assert.equal(
    guardWeekBestFraming("Sunday looks the best for solar: 10.87 kWh expected.", facts).ok,
    true
  );
  assert.equal(
    guardWeekBestFraming("It is the best solar day of the week.", facts).ok,
    true
  );
});

test("guardWeekBestFraming rejects a poor or best-less framing with the named reason", () => {
  const facts = { week_best: true, solar_kwh: "10.87 kWh" };
  const reason =
    "the facts mark this day as the week's best solar day; frame it as the week's best";
  // The live failure: the week's best day called "a poor solar day".
  const poor = guardWeekBestFraming(
    "Sunday looks like a poor solar day at 10.87 kWh.",
    facts
  );
  assert.equal(poor.ok, false);
  assert.ok(poor.problems.includes(reason));
  // A "poorest" framing is the same contradiction.
  const poorest = guardWeekBestFraming(
    "Sunday is the week's poorest solar day.",
    facts
  );
  assert.equal(poorest.ok, false);
  assert.ok(poorest.problems.includes(reason));
  // Missing the word "best" also rejects.
  const noBest = guardWeekBestFraming(
    "Sunday brings 10.87 kWh of sun.",
    facts
  );
  assert.equal(noBest.ok, false);
  assert.ok(noBest.problems.includes(reason));
});

test("guardWeekBestFraming is inert without the week-best marker", () => {
  const text = "Friday looks like a poor solar day at 2.29 kWh.";
  assert.equal(guardWeekBestFraming(text, { week_best: false }).ok, true);
  assert.equal(guardWeekBestFraming(text, {}).ok, true);
  assert.equal(guardWeekBestFraming(text, { week_poorest: true }).ok, true);
});
