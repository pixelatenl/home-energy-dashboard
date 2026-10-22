// Fail-first repros for the monologue conversion (STEP 1B of the continued
// instructions), in their post-implementation form: the gate is now the
// per-section narrative validation of the monologue pipeline
// (figure-verbatim membership + framing rule + the narrative guards that
// stay). The pre-implementation run (/tmp/before2.txt, gate =
// validateModelOutput over the warning slot) proved the two gaps: R5b and
// the figure-free half of N5 were accepted (no framing rule existed),
// while P1 and P2 failed only through the blanket figure ban that this
// conversion replaces for narrative text.
//
// Probe classes:
// - POSITIVE (P1, P2): narratives carrying VERBATIM served figures in
//   their own section are ACCEPTED - the monologue world the ban used to
//   make impossible.
// - NEGATIVE (N1 to N5): fabricated figures, cross-section leaks, missing
//   currency markers, wrong windows and opportunity framing on a negative
//   candidate REJECT with readable reasons naming the offending figure
//   or the framing.
// - R5b: the figure-free framing form against negative-candidate facts -
//   the genuine gap - now REJECTS with a readable reason.
//
// Purity: no clock reads, no network, no environment reads.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSections } from "./advisory-core.mjs";
import {
  buildMonologueSections,
  validateSectionNarrative,
} from "./advisory-monologue.mjs";

// Tuesday afternoon, plan mode.
const NOW = "2026-10-20T15:30:00+02:00";

// The real M-fixture values: low €0.23 at 13:00, peak €0.46 at 19:00, cheap
// window 11:00-14:00, day average €0.31, tomorrow solar 2.2 kWh versus
// today 8.18 kWh, FRI 2.29 kWh with rain, SUN score 26 and 10.87 kWh,
// battery candidate saving -€0.0036.
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

// Negative-candidate facts: the battery play saves -€0.0036, below any
// bar worth acting on, so it must never be framed as an opportunity.
function negativeCandidateFacts() {
  return baseFacts({
    candidates: [
      {
        label: "battery",
        kwh: 1.2,
        savingEur: -0.0036,
        window: "11:00-14:00",
        worthwhile: false,
      },
    ],
  });
}

// The post-implementation gate: one section's narrative validated against
// that section's own fact set only, so a figure belonging to another
// section cannot pass.
function gate(narrative, key, facts = baseFacts()) {
  const sections = buildSections(facts, NOW);
  const monologueSections = buildMonologueSections(sections, facts, NOW);
  const section = monologueSections.find((s) => s.key === key);
  if (section === undefined) {
    throw new Error(`no monologue section "${key}" was built`);
  }
  const tomorrowPublished = facts.tomorrow?.pricesPublished === true;
  return validateSectionNarrative(narrative, section, { tomorrowPublished });
}

function assertAccepted(repro, verdict) {
  assert.equal(
    verdict.ok,
    true,
    `${repro}: expected ACCEPTED; it rejected: ${verdict.reasons.join(" | ")}`
  );
}

function assertRejected(repro, verdict, pattern) {
  assert.equal(
    verdict.ok,
    false,
    `${repro}: expected REJECTED; it was accepted`
  );
  assert.ok(
    verdict.reasons.length > 0 && verdict.reasons.every((r) => typeof r === "string" && r.trim() !== ""),
    `${repro}: rejection reasons must be non-empty readable strings`
  );
  if (pattern !== undefined) {
    assert.ok(
      verdict.reasons.some((r) => pattern.test(r)),
      `${repro}: expected a reason matching ${pattern}, got: ${verdict.reasons.join(" | ")}`
    );
  }
}

// ---------------------------------------------------------------------------
// R5b: the genuine gap, now closed. The figure-free framing form against
// the negative-candidate facts rejects with a reason naming the framing.
// ---------------------------------------------------------------------------

test("R5b repro: a negative saving framed as 'the largest opportunity today' (figure-free) is rejected with a readable reason", () => {
  const narrative = "The battery is your largest opportunity today.";
  assertRejected(
    "R5b",
    gate(narrative, "today", negativeCandidateFacts()),
    /opportunity/
  );
});

// ---------------------------------------------------------------------------
// POSITIVE: verbatim figures in their own section are accepted.
// ---------------------------------------------------------------------------

test("P1 repro: a TODAY narrative carrying verbatim served figures (€0.23, 11:00-14:00, €0.31) is accepted", () => {
  const narrative =
    "Today's lowest price is €0.23 at 13:00 and the peak is €0.46 at 19:00. " +
    "The cheapest window is 11:00-14:00, averaging €0.23 against a day average of €0.31.";
  assertAccepted("P1", gate(narrative, "today"));
});

test("P2 repro: a TOMORROW narrative carrying its own verbatim figures (2.2 kWh, 8.18 kWh) is accepted", () => {
  const narrative =
    "Tomorrow brings much less sun than today: 2.2 kWh against 8.18 kWh.";
  assertAccepted("P2", gate(narrative, "tomorrow"));
});

// ---------------------------------------------------------------------------
// NEGATIVE: each rejects with a readable reason naming the offending
// figure or the framing.
// ---------------------------------------------------------------------------

test("N1 repro: a fabricated '€0.51' that exists in no fact set is rejected, the reason names the figure", () => {
  const narrative =
    "Shifting your laundry to the afternoon could save €0.51.";
  assertRejected("N1", gate(narrative, "today"), /€0\.51/);
});

test("N2 repro: '2.2 kWh' inside the TODAY narrative - the cross-section leak - is rejected, the reason names the figure", () => {
  const narrative =
    "Your panels will add 2.2 kWh today, a thin day for solar.";
  assertRejected("N2", gate(narrative, "today"), /2\.2 kWh/);
});

test("N3 repro: a bare '0.23' without the currency marker, where the fact set serves '€0.23', is rejected, the reason names the figure", () => {
  const narrative =
    "Power dips to 0.23 per kWh in the early afternoon.";
  assertRejected("N3", gate(narrative, "today"), /"0\.23"/);
});

test("N4 repro: '14:00-17:00' while the served window is '11:00-14:00' is rejected, the reason names the range", () => {
  const narrative =
    "The cheap stretch to run the machine is 14:00-17:00.";
  assertRejected("N4", gate(narrative, "today"), /14:00-17:00/);
});

test("N5 repro: 'the largest opportunity today' framing on the negative saving is rejected in both forms, the reasons name the framing", () => {
  const facts = negativeCandidateFacts();
  assertRejected(
    "N5 (figure-free)",
    gate("The battery is your largest opportunity today.", "today", facts),
    /opportunity/
  );
  assertRejected(
    "N5 (figure-bearing)",
    gate("The battery is your largest opportunity today, worth -€0.0036.", "today", facts),
    /opportunity/
  );
});

// ---------------------------------------------------------------------------
// The same framing claim on an action day - where the section facts carry
// a matched, positive, above-threshold candidate - stays accepted.
// ---------------------------------------------------------------------------

test("framing control: the opportunity framing is accepted when the section has a worthwhile candidate", () => {
  const facts = baseFacts({
    candidates: [
      { label: "dishwasher", kwh: 1.07, savingEur: 0.12, window: "11:00-14:00", worthwhile: true },
    ],
  });
  const narrative =
    "Running the dishwasher in 11:00-14:00 saves €0.12, your biggest opportunity today.";
  assertAccepted("framing control", gate(narrative, "today", facts));
});
