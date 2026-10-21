// The AI Advisory card core (contract v2.0). One facts layer in, four
// deterministic surfaces out: the model context (sections), the model
// output validation, and the served SummaryInsight payload.
//
// Purity contract: no Date.now(), no fetch, no environment reads anywhere
// in this file or narrative-guards.mjs. `now` is an ISO-8601 local
// timestamp string with an explicit UTC offset (e.g.
// "2026-10-20T15:30:00+02:00"); all calendar math is pure arithmetic on it,
// so the core is replayable and testable in isolation.
//
// Function contracts for this pass (no integration):
// - buildSections(facts, now) -> sections array per contract section 3.
//   The mode decision comes from EVENING_PIVOT_HOUR; the C17 practicality
//   gate decides whether an evening window may be commanded; unpublished
//   prices are null-encoded with the reason in the guidance note. Missing
//   facts omit their clause or their whole section.
// - buildAdvisoryModelContext(sections) -> exactly { now_local, today_date,
//   sections }. Its single argument is the built model context bundle
//   ({ now_local, today_date, sections }); this function projects it to
//   precisely what reaches the model and nothing else.
// - validateModelOutput(output, sections) -> verdicts with reasons for the
//   two model-authored slots (warning, contextNote), calling only the
//   checker.mjs guards and the narrative-guards.mjs guards.
// - composeAdvisoryCard(sections, output, facts) -> the served payload in
//   exactly the SummaryInsight content-field shape of contract section 5.
//   The transport fields (generated_at, insight_as_of, state, stale, error)
//   are owned by the summary insight path and never touched here.
// - generateAdvisoryCard(facts, now, modelStub) -> orchestrates: one model
//   call, validation, at most one regeneration attempt, then serve without
//   any failing sentence.

import { checkAdvisory } from "../checker.mjs";
import {
  ACHIEVEMENT_MIN_BATTERY_EARN_EUR,
  ACHIEVEMENT_MIN_SOLAR_SHARE_PCT,
  GUIDANCE_MIN_SPREAD_EUR,
  PRACTICAL_MIN_ADVANTAGE_EUR,
} from "../advisory-constants.mjs";
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
} from "./narrative-guards.mjs";

// Contract section 7 lists these constants; the two spread/practicality
// values and the two achievement thresholds live in advisory-constants.mjs
// (the latter ENV-overridable there), so the rest are defined here once
// with their contract defaults. No ENV reads: the purity contract of
// this pass forbids environment access.
export const EVENING_PIVOT_HOUR = 18;
export const PRACTICAL_MIN_HOURS = 2;
export const DELAY_MIN_ADVANTAGE_EUR = 0.05;
export const GOOD_SOLAR_SCORE = 60;
export const LOW_SOLAR_SCORE = 20;
export const SAVING_CHIP_MIN_EUR = 1.0;

// The deterministic no-opportunity statement (contract section 4): the model
// never writes it, and it is never phrased as deferral advice.
export const NO_OPPORTUNITY_STATEMENT = "No action worth taking today";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const pad2 = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// Pure time handling: calendar fields from an explicit-offset ISO string.
// Date.UTC / getUTC* are deterministic functions of their arguments; no
// local-timezone environment is ever consulted.
// ---------------------------------------------------------------------------

function parseOffsetMinutes(off) {
  if (!off || off === "Z") return 0;
  const sign = off.startsWith("-") ? -1 : 1;
  const digits = off.replace(/^[+-]/, "").replace(":", "");
  const oh = Number(digits.slice(0, 2));
  const om = Number((digits.slice(2, 4) || "0").padEnd(2, "0"));
  return sign * (oh * 60 + om);
}

export function parseLocalTime(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})$/.exec(
    String(iso).trim()
  );
  if (!m) {
    throw new Error(
      `advisory-core: now must be an ISO-8601 local timestamp with an explicit offset, got "${iso}"`
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const offsetMin = parseOffsetMinutes(m[6]);
  return {
    year,
    month,
    day,
    hour,
    minute,
    offsetMin,
    utcMs: Date.UTC(year, month - 1, day, hour, minute) - offsetMin * 60_000,
    dateStr: `${m[1]}-${m[2]}-${m[3]}`,
    timeStr: `${pad2(hour)}:${pad2(minute)}`,
  };
}

function formatNowLocal(t) {
  const sign = t.offsetMin < 0 ? "-" : "+";
  return `${t.dateStr}T${t.timeStr}:00${sign}${pad2(
    Math.floor(Math.abs(t.offsetMin) / 60)
  )}:${pad2(Math.abs(t.offsetMin) % 60)}`;
}

function weekdayOf(t) {
  return WEEKDAYS[new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()];
}

// The calendar day `days` after the given local moment (same offset).
function shiftDay(t, days) {
  const wallClockAsUtc = t.utcMs + days * 86_400_000 + t.offsetMin * 60_000;
  const d = new Date(wallClockAsUtc);
  return {
    dateStr: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
      d.getUTCDate()
    )}`,
    weekday: WEEKDAYS[d.getUTCDay()],
  };
}

function hourToMinutes(label) {
  const [h, m] = String(label).split(":");
  return Number(h) * 60 + Number(m);
}

// A window end of "00:00" means midnight at the end of the day.
function windowEndHours(endLabel) {
  if (String(endLabel) === "00:00") return 24;
  return hourToMinutes(endLabel) / 60;
}

// ---------------------------------------------------------------------------
// Deterministic formatting (contract section 9): euro sign flush against the
// amount, two decimals when nonzero at two decimals, more only when two
// would show €0.00.
// ---------------------------------------------------------------------------

export function formatEur(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const two = Math.round(abs * 100) / 100;
  if (two !== 0) return `${sign}€${two.toFixed(2)}`;
  for (const decimals of [3, 4]) {
    const rendered = abs.toFixed(decimals);
    if (Number(rendered) !== 0) return `${sign}€${rendered}`;
  }
  return `${sign}€0.00`;
}

// ---------------------------------------------------------------------------
// Candidate selection and confidence mapping (contract section 4).
// ---------------------------------------------------------------------------

function selectCandidate(candidates) {
  const worthwhile = (Array.isArray(candidates) ? candidates : []).filter(
    (c) => c?.worthwhile === true
  );
  if (worthwhile.length === 0) return null;
  return [...worthwhile].sort(
    (a, b) => (b.savingEur ?? 0) - (a.savingEur ?? 0)
  )[0];
}

// high with a worthwhile candidate, medium when all candidates are below the
// action threshold, low when data is thin (no candidates at all).
export function mapConfidence(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.some((c) => c?.worthwhile === true)) return "high";
  if (list.length > 0) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Section building (contract section 3).
// ---------------------------------------------------------------------------

const GUIDANCE = {
  todayPlan:
    "State what the household should do today and why, in household terms. Numbers are rendered by the card; your sentence carries meaning only.",
  todayRecap:
    "Summarize how the day has gone so far in plain facts; the remaining window is carried by the evening section. The achievement lines are server-written: you may acknowledge them qualitatively but must never restate their figures.",
  // C17: below the benefit worth acting on the window is a plain fact,
  // never an instruction.
  eveningNotPractical:
    "Summarize the day that has passed. The remaining window is below the benefit worth acting on: state it as a plain fact, never as an instruction.",
  eveningPractical:
    "The remaining window clears the benefit bar: you may advise what to run in it; numbers are rendered by the card.",
  tomorrowUnpublished:
    "Prices are null because they are not published; make no price claim about tomorrow. Speak about tomorrow's solar only.",
  tomorrowPublished:
    "Tomorrow's prices are published: compare them plainly with today and say what is cheaper.",
  comingDays:
    "Qualitative solar talk only; no prices exist for these days. Never state a price for any day beyond tomorrow.",
};

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// ---------------------------------------------------------------------------
// Facts sanitization (F1): a non-finite number is a missing fact, never a
// value. Facts are normalized once where they enter the core - in
// buildSections and composeAdvisoryCard - so sections, the model context and
// every composed sentence see null, and the existing null handling omits the
// sentence or clause. Never compose "null", "NaN" or "Infinity" into prose.
// ---------------------------------------------------------------------------

function sanitizeFinite(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeFinite);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = sanitizeFinite(entry);
    }
    return out;
  }
  return value;
}

// A container whose core number is missing carries no honest value at all:
// the price points, the battery and the windows drop entirely (contract
// section 5: a null fact omits its sentence or clause, never a guess), and a
// candidate without finite figures cannot state an action, so it is dropped.
function sanitizeFacts(facts) {
  const f = sanitizeFinite(facts ?? {});
  if (f.lowPrice != null && !isNum(f.lowPrice.price)) f.lowPrice = null;
  if (f.peakPrice != null && !isNum(f.peakPrice.price)) f.peakPrice = null;
  if (f.battery != null && !isNum(f.battery.socPct)) f.battery = null;
  if (f.cheapestWindow != null && !isNum(f.cheapestWindow.averageEur)) {
    f.cheapestWindow = null;
  }
  if (f.remainingWindow != null && !isNum(f.remainingWindow.averageEur)) {
    f.remainingWindow = null;
  }
  if (Array.isArray(f.candidates)) {
    f.candidates = f.candidates.filter(
      (c) => c != null && isNum(c.kwh) && isNum(c.savingEur)
    );
  }
  return f;
}

// The today-imperative practicality gate (contract section 3 mode rules):
// the window starts before the pivot, at least PRACTICAL_MIN_HOURS remain,
// and its average sits at least PRACTICAL_MIN_ADVANTAGE_EUR below the day
// average. Returns null when the clause's inputs are missing (the clause is
// then omitted).
function computePractical(facts, nowHours) {
  const w = facts?.cheapestWindow;
  if (!w || !isNum(facts.dayAverageEur) || !isNum(facts.practicalBenefitEur)) {
    return null;
  }
  const startHour = hourToMinutes(w.start) / 60;
  const hoursRemaining = Math.max(0, windowEndHours(w.end) - nowHours);
  return {
    practical:
      startHour < EVENING_PIVOT_HOUR &&
      hoursRemaining >= PRACTICAL_MIN_HOURS &&
      facts.practicalBenefitEur >= PRACTICAL_MIN_ADVANTAGE_EUR,
    windowStartHour: Math.floor(startHour),
    hoursRemaining,
  };
}

export function buildSections(facts, now) {
  const f = sanitizeFacts(facts);
  const t = parseLocalTime(now);
  const nowHours = t.hour + t.minute / 60;
  const recapMode = nowHours >= EVENING_PIVOT_HOUR;
  const sections = [];

  // --- today ---------------------------------------------------------------
  const todayFacts = {};
  if (f.cheapestWindow) {
    todayFacts.cheapest_window = {
      start: f.cheapestWindow.start,
      end: f.cheapestWindow.end,
      average_eur: f.cheapestWindow.averageEur,
    };
  }
  if (isNum(f.dayAverageEur)) todayFacts.day_average_eur = f.dayAverageEur;
  if (isNum(f.spreadPerKwhEur)) {
    todayFacts.spread_per_kwh_eur = f.spreadPerKwhEur;
  }
  if (isNum(f.practicalBenefitEur)) {
    todayFacts.practical_benefit_eur = f.practicalBenefitEur;
  }
  const practicalInfo = computePractical(f, nowHours);
  if (practicalInfo !== null) todayFacts.practical = practicalInfo.practical;
  if (f.peakPrice) {
    todayFacts.peak = { hour: f.peakPrice.timestamp, eur: f.peakPrice.price };
    // The peak-avoidance line renders while the day's peak hour is ahead of
    // now - strictly after, so a peak at the current hour is not ahead.
    todayFacts.peak_ahead =
      hourToMinutes(f.peakPrice.timestamp) > t.hour * 60 + t.minute;
  }
  if (f.lowPrice) {
    todayFacts.low = { hour: f.lowPrice.timestamp, eur: f.lowPrice.price };
  }
  if (f.dayCheapestWindow) {
    todayFacts.day_cheapest_window = f.dayCheapestWindow;
    todayFacts.day_cheapest_passed = f.dayCheapestPassed === true;
  }
  if (f.solarToday) {
    todayFacts.solar_today = {
      actual_kwh: f.solarToday.actualKwh,
      forecast_kwh: f.solarToday.forecastKwh,
    };
  }
  if (f.battery) {
    todayFacts.battery = {
      soc_pct: f.battery.socPct,
      state: f.battery.state,
      today_in_kwh: f.battery.todayInKwh,
      today_out_kwh: f.battery.todayOutKwh,
    };
  }
  if (isNum(f.co2IntensityGPerKwh)) {
    todayFacts.co2_intensity_g_per_kwh = f.co2IntensityGPerKwh;
  }
  const selected = selectCandidate(f.candidates);
  if (selected) {
    todayFacts.candidate = {
      label: selected.label,
      kwh: selected.kwh,
      saving_eur: selected.savingEur,
      window: selected.window,
      worthwhile: true,
    };
  }
  if (recapMode) {
    // Recap-only facts (contract section 3): null-encoded when absent;
    // plan-mode sections never carry them.
    todayFacts.solar_share_pct = isNum(f.solar_share_pct)
      ? f.solar_share_pct
      : null;
    todayFacts.battery_earned_eur = isNum(f.battery_earned_eur)
      ? f.battery_earned_eur
      : null;
  }
  if (Object.keys(todayFacts).length > 0) {
    sections.push({
      id: "today",
      mode: recapMode ? "recap" : "plan",
      facts: todayFacts,
      guidance: recapMode ? GUIDANCE.todayRecap : GUIDANCE.todayPlan,
    });
  }

  // --- today_evening (recap mode only; C17 practicality gate) --------------
  if (recapMode && f.remainingWindow) {
    const eveningPractical = isNum(f.remainingWindow.practicalBenefitEur)
      ? f.remainingWindow.practicalBenefitEur >= PRACTICAL_MIN_ADVANTAGE_EUR
      : false;
    const eveningFacts = {
      remaining_window: {
        start: f.remainingWindow.start,
        end: f.remainingWindow.end,
        average_eur: f.remainingWindow.averageEur,
        practical_benefit_eur: f.remainingWindow.practicalBenefitEur ?? null,
        practical: eveningPractical,
      },
    };
    if (isNum(f.remainingAverageEur)) {
      eveningFacts.remaining_average_eur = f.remainingAverageEur;
    }
    if (isNum(f.dayUsageKwh)) eveningFacts.day_usage_kwh = f.dayUsageKwh;
    if (isNum(f.dayCostEur)) eveningFacts.day_cost_eur = f.dayCostEur;
    sections.push({
      id: "today_evening",
      mode: "recap",
      facts: eveningFacts,
      guidance: eveningPractical
        ? GUIDANCE.eveningPractical
        : GUIDANCE.eveningNotPractical,
    });
  }

  // --- tomorrow (null encoding for unpublished prices) ----------------------
  if (f.tomorrow) {
    const published = f.tomorrow.pricesPublished === true;
    const tomorrowFacts = {
      prices_published: published,
      // Unpublished or unavailable prices are null with the reason in the
      // guidance note. The model is never offered a slot to fill.
      prices: published ? (f.tomorrow.prices ?? null) : null,
    };
    if (isNum(f.tomorrow.solarKwh)) tomorrowFacts.solar_kwh = f.tomorrow.solarKwh;
    if (isNum(f.tomorrow.solarScore)) {
      tomorrowFacts.solar_score = f.tomorrow.solarScore;
    }
    if (typeof f.tomorrow.lowSolar === "boolean") {
      tomorrowFacts.low_solar = f.tomorrow.lowSolar;
    }
    if (isNum(f.tomorrow.compareSolarKwh)) {
      tomorrowFacts.compare_solar_kwh = f.tomorrow.compareSolarKwh;
    }
    sections.push({
      id: "tomorrow",
      facts: tomorrowFacts,
      guidance: published ? GUIDANCE.tomorrowPublished : GUIDANCE.tomorrowUnpublished,
    });
  }

  // --- coming_days (solar only; no prices exist for these days) -------------
  if (Array.isArray(f.comingDays) && f.comingDays.length > 0) {
    const days = f.comingDays.map((d) => ({
      weekday: d.weekday,
      date: d.date,
      solar_kwh: d.solarKwh,
      solar_score: isNum(d.solarScore) ? d.solarScore : null,
      condition: d.condition,
    }));
    const bySolar = (a, b) => a.solar_kwh - b.solar_kwh;
    const best = [...days].sort(bySolar).at(-1);
    const poor = [...days].sort(bySolar)[0];
    sections.push({
      id: "coming_days",
      days,
      best_day: best.weekday,
      poor_day: poor.weekday,
      guidance: GUIDANCE.comingDays,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Model context assembly (contract section 2: one dedicated function per
// consumer). Projects the built bundle to exactly what reaches the model.
// ---------------------------------------------------------------------------

export function buildAdvisoryModelContext(sections) {
  // `sections` is the built model context bundle:
  // { now_local, today_date, sections }. Nothing else may reach the model.
  const list = Array.isArray(sections?.sections) ? sections.sections : [];
  return {
    now_local: sections?.now_local ?? null,
    today_date: sections?.today_date ?? null,
    sections: list.map((s) => {
      const entry = { id: s.id };
      if (typeof s.mode === "string") entry.mode = s.mode;
      entry.facts = { ...(s.facts ?? {}) };
      if (Array.isArray(s.days)) entry.days = [...s.days];
      entry.guidance = s.guidance;
      return entry;
    }),
  };
}

// ---------------------------------------------------------------------------
// Validation (contract section 6): one guard set, per narrative.
// ---------------------------------------------------------------------------

function textOf(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// The grounding facts the checker verifies against, extracted from the
// sections the model actually received (never from a wider view).
export function extractGroundingFacts(sections) {
  const today =
    (Array.isArray(sections) ? sections : []).find((s) => s.id === "today")
      ?.facts ?? {};
  return {
    lowPrice: today.low
      ? { timestamp: today.low.hour, price: today.low.eur }
      : null,
    peakPrice: today.peak
      ? { timestamp: today.peak.hour, price: today.peak.eur }
      : null,
    battery: today.battery
      ? { soc_pct: today.battery.soc_pct, state: today.battery.state }
      : null,
  };
}

export function validateModelOutput(output, sections) {
  const out = output ?? {};
  const grounding = extractGroundingFacts(sections);
  // checker.mjs guards: price-plus-hour pairs against the day curve, battery
  // SOC and state claims against the section battery values. A sentence with
  // no matching fact is a rejection.
  const checkerVerdict = checkAdvisory(
    { warning: textOf(out.warning), contextNote: textOf(out.contextNote) },
    grounding
  );

  const tomorrowSection = (Array.isArray(sections) ? sections : []).find(
    (s) => s.id === "tomorrow"
  );
  // No tomorrow section means the model received no tomorrow facts at all, so
  // any tomorrow price claim is a fabrication.
  const tomorrowPublished =
    tomorrowSection !== undefined &&
    tomorrowSection.facts?.prices_published === true;
  const comingDaysSection = (Array.isArray(sections) ? sections : []).find(
    (s) => s.id === "coming_days"
  );

  // The selected worthwhile candidate from the sections the model received:
  // its presence means an action exists (contract section 4).
  const todaySection = (Array.isArray(sections) ? sections : []).find(
    (s) => s.id === "today"
  );
  const actionCandidate = todaySection?.facts?.candidate ?? null;

  const fieldVerdicts = {};
  for (const field of ["warning", "contextNote"]) {
    const text = textOf(out[field]);
    if (text === null) {
      fieldVerdicts[field] = { ok: true, reasons: [] };
      continue;
    }
    const reasons = checkerVerdict.problems.filter((p) =>
      p.startsWith(`${field}:`)
    );
    for (const guard of [
      guardTomorrowPrice(text, { tomorrowPublished }),
      guardBeyondTomorrowPrice(text),
      guardArithmetic(text),
      guardInternalVocabulary(text),
      guardNonFiniteText(text),
      guardNoFigures(text),
      guardRegister(text),
    ]) {
      reasons.push(...guard.problems);
    }
    // The no-opportunity statement is server-owned and deferral advice is
    // banned wherever the model writes (contract section 4): the guard
    // applies to every model-authored slot.
    reasons.push(...guardNoOpportunityPhrasing(text).problems);
    if (field === "contextNote") {
      // Contract section 4 output rules for the contextNote slot: it is null
      // when an action exists, never restates the action's numbers, appliance
      // names or windows. The composer inherits the rule through its
      // re-validation of any output it is handed.
      if (actionCandidate !== null) {
        reasons.push("contextNote must be null when an action exists");
      }
      reasons.push(
        ...guardActionRestatement(text, { candidate: actionCandidate }).problems
      );
    }
    fieldVerdicts[field] = { ok: reasons.length === 0, reasons };
  }

  const reasons = [
    ...fieldVerdicts.warning.reasons,
    ...fieldVerdicts.contextNote.reasons,
  ];
  return { ok: reasons.length === 0, fields: fieldVerdicts, reasons };
}

// One model call plus validation. Exported so the scenario runner can show
// the verdicts it served with; generateAdvisoryCard uses it for both the
// first attempt and the single regeneration.
export async function attemptModel(context, modelStub) {
  let output = null;
  try {
    output = await modelStub(context);
  } catch {
    output = null; // a stub failure serves as an empty narrative, never a crash
  }
  const normalized = {
    warning: textOf(output?.warning),
    contextNote: textOf(output?.contextNote),
  };
  return { output: normalized, verdicts: validateModelOutput(normalized, context.sections) };
}

// Serve only the sentences that passed; a failing slot is dropped (null).
export function sanitizeOutput(output, verdicts) {
  const out = output ?? {};
  return {
    warning:
      verdicts.fields.warning.ok && textOf(out.warning) !== null
        ? out.warning
        : null,
    contextNote:
      verdicts.fields.contextNote.ok && textOf(out.contextNote) !== null
        ? out.contextNote
        : null,
  };
}

// ---------------------------------------------------------------------------
// Composition (contract section 5): the served SummaryInsight payload.
// Deterministic formatting only; the transport fields are never touched.
// ---------------------------------------------------------------------------

function round2(x) {
  return Math.round(x * 100) / 100;
}

export function composeAdvisoryCard(sections, output, facts) {
  // Facts enter the composer through the same F1 gate as the sections: a
  // non-finite number is a missing fact, null before use.
  const f = sanitizeFacts(facts);
  if (typeof f.nowIso !== "string" || f.nowIso.trim() === "") {
    throw new Error(
      "advisory-core: composeAdvisoryCard requires facts.nowIso, the request's local moment as pure data (generateAdvisoryCard injects it); it was missing"
    );
  }
  // Defense in depth: even when called directly with unvalidated model text,
  // a mismatched narrative is never served.
  const safe = sanitizeOutput(output, validateModelOutput(output, sections));

  const candidatesIn = Array.isArray(f.candidates) ? f.candidates : [];
  const selected = selectCandidate(candidatesIn);
  const noOpportunity =
    candidatesIn.length === 0 ||
    candidatesIn.every((c) => c?.worthwhile !== true);

  // --- primary_action (server-injected, never model-written) ---------------
  const primaryAction = selected
    ? {
        what: `Run the ${selected.label}`,
        when: selected.window,
        saving_eur: selected.savingEur,
        confidence: mapConfidence(candidatesIn),
      }
    : null;

  // --- supporting_facts ------------------------------------------------------
  const supportingFacts = [];
  if (noOpportunity) supportingFacts.push(NO_OPPORTUNITY_STATEMENT);
  if (f.lowPrice && f.peakPrice) {
    supportingFacts.push(
      `Prices range from ${formatEur(f.lowPrice.price)} at ${f.lowPrice.timestamp} to ${formatEur(f.peakPrice.price)} at ${f.peakPrice.timestamp} today.`
    );
  } else if (f.lowPrice) {
    supportingFacts.push(
      `The lowest price so far is ${formatEur(f.lowPrice.price)} at ${f.lowPrice.timestamp}.`
    );
  } else if (f.peakPrice) {
    supportingFacts.push(
      `The peak price so far is ${formatEur(f.peakPrice.price)} at ${f.peakPrice.timestamp}.`
    );
  }
  if (isNum(f.dayAverageEur)) {
    supportingFacts.push(`The day average is ${formatEur(f.dayAverageEur)} per kWh.`);
  }

  // --- candidates (largest real opportunity first) ---------------------------
  const candidateRows = [...candidatesIn]
    .sort((a, b) => (b.savingEur ?? 0) - (a.savingEur ?? 0))
    .map((c) => ({
      label: c.label,
      load_kwh: c.kwh,
      window: c.window,
      saving_eur: c.savingEur,
      below_threshold: c.worthwhile !== true,
      basis: "cheapest remaining window against the day average",
    }));

  // The request's local moment, carried as pure data in the facts layer
  // (generateAdvisoryCard injects it; direct callers pass it explicitly).
  // Never a clock read.
  const t = parseLocalTime(f.nowIso);

  // --- guidance (omitted on flat-price days) ---------------------------------
  let guidance = null;
  if (
    f.cheapestWindow &&
    isNum(f.spreadPerKwhEur) &&
    f.spreadPerKwhEur >= GUIDANCE_MIN_SPREAD_EUR &&
    f.peakPrice
  ) {
    const practicalInfo = computePractical(f, t.hour + t.minute / 60);
    const windowLabel = `${f.cheapestWindow.start}-${f.cheapestWindow.end}`;
    let line;
    if (f.dayCheapestPassed === true && f.dayCheapestWindow) {
      // The passed-hours plain fact, with the "best price left today"
      // reservation - never "today's lowest price".
      line = `The day's cheap hours (${f.dayCheapestWindow}) have passed; ${windowLabel} is the best price left today.`;
    } else if (isNum(f.dayAverageEur)) {
      line = `The cheapest remaining window is ${windowLabel}, averaging ${formatEur(
        f.cheapestWindow.averageEur
      )} against a day average of ${formatEur(f.dayAverageEur)}.`;
    } else {
      line = `The cheapest remaining window is ${windowLabel}.`;
    }

    // The delay comparison advises tomorrow's window once today stops
    // commanding: tomorrow must be at least DELAY_MIN_ADVANTAGE_EUR cheaper
    // than the best remaining today window.
    let delay = null;
    if (
      f.tomorrow?.pricesPublished === true &&
      isNum(f.tomorrow.averageEur) &&
      isNum(f.cheapestWindow.averageEur) &&
      f.tomorrow.averageEur <= f.cheapestWindow.averageEur - DELAY_MIN_ADVANTAGE_EUR
    ) {
      delay = {
        tomorrow_window: f.tomorrow.window ?? null,
        tomorrow_window_average_eur: f.tomorrow.averageEur,
        today_window_average_eur: f.cheapestWindow.averageEur,
      };
    }

    guidance = {
      window: windowLabel,
      cheapest_window_average_eur: f.cheapestWindow.averageEur,
      peak_hour: f.peakPrice.timestamp,
      peak_price_eur: f.peakPrice.price,
      spread_per_kwh_eur: f.spreadPerKwhEur,
      practical: practicalInfo ? practicalInfo.practical : false,
      window_start_hour: practicalInfo
        ? practicalInfo.windowStartHour
        : Math.floor(hourToMinutes(f.cheapestWindow.start) / 60),
      hours_remaining: practicalInfo ? practicalInfo.hoursRemaining : 0,
      day_average_eur: isNum(f.dayAverageEur) ? f.dayAverageEur : null,
      day_cheapest_window: f.dayCheapestWindow ?? null,
      day_cheapest_average_eur: null,
      peak_ahead:
        hourToMinutes(f.peakPrice.timestamp) > t.hour * 60 + t.minute,
      day_cheapest_passed: f.dayCheapestPassed === true,
      remaining_average_eur: isNum(f.remainingAverageEur)
        ? f.remainingAverageEur
        : null,
      delay,
      line,
    };
  }

  // --- outlook (week rows, planning voice) ------------------------------------
  let outlook = null;
  const tomorrowInfo = shiftDay(t, 1);
  const outlookDays = [];
  if (f.tomorrow) {
    outlookDays.push({
      date: tomorrowInfo.dateStr,
      weekday: tomorrowInfo.weekday,
      weekday_short: tomorrowInfo.weekday.slice(0, 3),
      solar_kwh: isNum(f.tomorrow.solarKwh) ? f.tomorrow.solarKwh : null,
      solar_score: isNum(f.tomorrow.solarScore) ? f.tomorrow.solarScore : null,
      condition: f.tomorrow.condition ?? "unknown",
      // Null for every day except tomorrow; unpublished prices are null,
      // never a number.
      average_price_eur:
        f.tomorrow.pricesPublished === true && isNum(f.tomorrow.averageEur)
          ? f.tomorrow.averageEur
          : null,
    });
  }
  for (const d of Array.isArray(f.comingDays) ? f.comingDays : []) {
    if (outlookDays.some((x) => x.date === d.date)) continue; // tomorrow wins
    outlookDays.push({
      date: d.date,
      weekday: d.weekday,
      weekday_short: String(d.weekday).slice(0, 3),
      solar_kwh: isNum(d.solarKwh) ? d.solarKwh : null,
      solar_score: isNum(d.solarScore) ? d.solarScore : null,
      condition: d.condition,
      average_price_eur: null,
    });
  }
  if (outlookDays.length > 0) {
    const withSolar = outlookDays.filter((d) => isNum(d.solar_kwh));
    let bestSolarDay = null;
    let poorDay = null;
    if (withSolar.length > 0) {
      const best = [...withSolar].sort(
        (a, b) => b.solar_kwh - a.solar_kwh
      )[0];
      const poor = [...withSolar].sort((a, b) => a.solar_kwh - b.solar_kwh)[0];
      const good = isNum(best.solar_score) && best.solar_score >= GOOD_SOLAR_SCORE;
      // F2: below GOOD_SOLAR_SCORE the phrasing is "the week's best solar"
      // with score and kWh verbatim, never the "genuinely good" claim.
      bestSolarDay = {
        date: best.date,
        weekday: best.weekday,
        weekday_short: best.weekday_short,
        solar_kwh: best.solar_kwh,
        solar_score: best.solar_score,
        good,
        line: good
          ? `${best.weekday} looks genuinely good for solar at ${best.solar_score} score and ${best.solar_kwh} kWh.`
          : `${best.weekday} is the week's best solar day at ${best.solar_score} score and ${best.solar_kwh} kWh.`,
      };
      // F1: the rain poor-day advice line, with kWh verbatim in the fact line.
      poorDay = {
        date: poor.date,
        weekday: poor.weekday,
        weekday_short: poor.weekday_short,
        solar_kwh: poor.solar_kwh,
        condition: poor.condition,
        line: `${poor.weekday} looks like the week's weakest solar day at ${poor.solar_kwh} kWh.`,
        advice:
          poor.condition === "rain"
            ? "With rain expected, it is not a good day to run your large appliances."
            : null,
      };
    }
    outlook = { days: outlookDays, best_solar_day: bestSolarDay, poor_day: poorDay };
  }

  // --- advisory (day-ahead: defer or advance) ---------------------------------
  let advisory = null;
  if (f.tomorrow) {
    const published = f.tomorrow.pricesPublished === true;
    const compareDay = "today";
    const compareAverage = isNum(f.dayAverageEur) ? f.dayAverageEur : null;
    const tomorrowSolarKwh = isNum(f.tomorrow.solarKwh)
      ? f.tomorrow.solarKwh
      : null;
    const lowSolar =
      f.tomorrow.lowSolar === true ||
      (isNum(f.tomorrow.solarScore) && f.tomorrow.solarScore < LOW_SOLAR_SCORE);

    if (published && isNum(f.tomorrow.averageEur)) {
      if (compareAverage !== null) {
        const diff = round2(f.tomorrow.averageEur - compareAverage);
        if (diff <= -DELAY_MIN_ADVANTAGE_EUR) {
          // F4: the prefer verdict and comparison strip come from
          // server-computed fields; the model never chooses the day.
          advisory = {
            type: "defer",
            triggered: true,
            tomorrow_average_eur: f.tomorrow.averageEur,
            tomorrow_solar_kwh: tomorrowSolarKwh,
            tomorrow_solar_score: isNum(f.tomorrow.solarScore)
              ? f.tomorrow.solarScore
              : null,
            tomorrow_low_solar: lowSolar,
            compare_day: compareDay,
            compare_average_eur: compareAverage,
            compare_solar_kwh: isNum(f.solarToday?.forecastKwh)
              ? f.solarToday.forecastKwh
              : null,
            price_difference_per_kwh: diff,
            horizon_note: `Tomorrow compared with ${compareDay}.`,
            line: `Tomorrow looks meaningfully cheaper at ${formatEur(
              f.tomorrow.averageEur
            )} per kWh against ${formatEur(compareAverage)} today${
              f.tomorrow.window ? `, so heavy usage can wait until ${f.tomorrow.window}` : ""
            }.`,
          };
        } else if (diff >= DELAY_MIN_ADVANTAGE_EUR) {
          // The prefer verdict fires for today: the advance recommendation
          // (run heavy usage now) is a recommendation, so it renders only
          // with a fired prefer trigger (contract section 5).
          advisory = {
            type: "advance",
            triggered: true,
            tomorrow_average_eur: f.tomorrow.averageEur,
            tomorrow_solar_kwh: tomorrowSolarKwh,
            tomorrow_solar_score: isNum(f.tomorrow.solarScore)
              ? f.tomorrow.solarScore
              : null,
            tomorrow_low_solar: lowSolar,
            compare_day: compareDay,
            compare_average_eur: compareAverage,
            compare_solar_kwh: isNum(f.solarToday?.forecastKwh)
              ? f.solarToday.forecastKwh
              : null,
            price_difference_per_kwh: diff,
            horizon_note: `Tomorrow compared with ${compareDay}.`,
            line: `Tomorrow looks pricier at ${formatEur(
              f.tomorrow.averageEur
            )} per kWh against ${formatEur(compareAverage)} today, so it is better to run heavy usage now.`,
          };
        }
        // |diff| below the delay advantage: no meaningful difference, null.
      }
    } else {
      // Unpublished: grid-reliance fact plus the hedged market note (F3 -
      // "usually" stays intact because wind can still soften the price).
      advisory = {
        type: "defer",
        triggered: false,
        tomorrow_average_eur: null,
        tomorrow_solar_kwh: tomorrowSolarKwh,
        tomorrow_solar_score: isNum(f.tomorrow.solarScore)
          ? f.tomorrow.solarScore
          : null,
        tomorrow_low_solar: lowSolar,
        compare_day: compareDay,
        compare_average_eur: compareAverage,
        compare_solar_kwh: isNum(f.solarToday?.forecastKwh)
          ? f.solarToday.forecastKwh
          : null,
        price_difference_per_kwh: null,
        horizon_note: `Tomorrow compared with ${compareDay}.`,
        line: lowSolar
          ? `Little sun is expected tomorrow${
              tomorrowSolarKwh !== null ? ` (${tomorrowSolarKwh} kWh)` : ""
            }, so the house will lean on the grid; prices are usually firmer in that case.`
          : `Tomorrow's prices are not published yet${
              tomorrowSolarKwh !== null ? `, and ${tomorrowSolarKwh} kWh of sun is forecast` : ""
            }.`,
      };
    }
  }

  // --- grounding facts (verbatim, each null when its data is missing) --------
  const lowPrice = f.lowPrice
    ? { timestamp: f.lowPrice.timestamp, price: f.lowPrice.price }
    : null;
  const peakPrice = f.peakPrice
    ? { timestamp: f.peakPrice.timestamp, price: f.peakPrice.price }
    : null;
  const battery = f.battery
    ? { soc_pct: f.battery.socPct, state: f.battery.state }
    : null;

  // --- deterministic sentences (the model never writes them) ------------------
  let priceSentence = null;
  if (lowPrice && peakPrice) {
    priceSentence = `Today's lowest price is ${formatEur(
      lowPrice.price
    )} at ${lowPrice.timestamp} and the peak is ${formatEur(
      peakPrice.price
    )} at ${peakPrice.timestamp}.`;
  } else if (lowPrice) {
    priceSentence = `The lowest price so far is ${formatEur(
      lowPrice.price
    )} at ${lowPrice.timestamp}.`;
  } else if (peakPrice) {
    priceSentence = `The peak price so far is ${formatEur(
      peakPrice.price
    )} at ${peakPrice.timestamp}.`;
  }
  const batterySentence = battery
    ? `The battery is at ${battery.soc_pct}% and ${battery.state}.`
    : null;

  // --- achievements (server-written, recap mode only; contract section 4) --
  // Deterministic templates, single writer: the model never sees a slot for
  // them. Below the threshold, or when the fact is null or missing, the line
  // is omitted entirely - never a vague substitute, never a fabricated
  // number. The today section carries these facts only in recap mode, so a
  // plan-mode day can never render them.
  const achievements = [];
  const todaySectionForAchievements = (Array.isArray(sections) ? sections : []).find(
    (s) => s.id === "today"
  );
  if (todaySectionForAchievements?.mode === "recap") {
    const recapFacts = todaySectionForAchievements.facts ?? {};
    if (
      isNum(recapFacts.solar_share_pct) &&
      recapFacts.solar_share_pct >= ACHIEVEMENT_MIN_SOLAR_SHARE_PCT
    ) {
      achievements.push(
        `Your own solar covered ${Math.round(recapFacts.solar_share_pct)}% of today's usage.`
      );
    }
    if (
      isNum(recapFacts.battery_earned_eur) &&
      recapFacts.battery_earned_eur >= ACHIEVEMENT_MIN_BATTERY_EARN_EUR
    ) {
      achievements.push(
        `Your battery earned ${formatEur(recapFacts.battery_earned_eur)} today.`
      );
    }
  }

  // The served payload: SummaryInsight content fields only. The transport
  // fields (generated_at, insight_as_of, state, stale, error) are owned by
  // the summary insight path and never touched here.
  const payload = {
    primary_action: primaryAction,
    warning: safe.warning,
    context_note: safe.contextNote,
    no_opportunity: noOpportunity,
    priceSentence,
    batterySentence,
    achievements,
  };
  if (supportingFacts.length > 0) payload.supporting_facts = supportingFacts;
  if (candidateRows.length > 0) payload.candidates = candidateRows;
  if (guidance !== null) payload.guidance = guidance;
  if (outlook !== null) payload.outlook = outlook;
  if (advisory !== null) payload.advisory = advisory;
  if (lowPrice !== null) payload.lowPrice = lowPrice;
  if (peakPrice !== null) payload.peakPrice = peakPrice;
  if (battery !== null) payload.battery = battery;
  return payload;
}

// ---------------------------------------------------------------------------
// Orchestration: one model call, validation, at most one regeneration, then
// serve without any failing sentence.
// ---------------------------------------------------------------------------

export async function generateAdvisoryCard(facts, now, modelStub) {
  const t = parseLocalTime(now);
  const sections = buildSections(facts, now);
  const context = buildAdvisoryModelContext({
    now_local: formatNowLocal(t),
    today_date: t.dateStr,
    sections,
  });

  let attempt = await attemptModel(context, modelStub);
  if (!attempt.verdicts.ok) {
    // One regeneration attempt on validation failure.
    attempt = await attemptModel(context, modelStub);
  }
  const safe = sanitizeOutput(attempt.output, attempt.verdicts);
  // The composer reads the request moment from the facts layer as pure data.
  return composeAdvisoryCard(sections, safe, { ...facts, nowIso: now });
}
