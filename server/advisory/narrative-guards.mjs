// The advisory narrative guards (contract section 6, second guard set).
// Each guard is a pure function over one model-authored sentence stream
// (the `warning` or `contextNote` text) plus only the section-derived
// facts it needs. Every guard returns { ok, problems } where problems is
// a list of human-readable rejection reasons. No IO, no Date.now(), no
// environment reads: the guards are replayable and testable in isolation.

// A currency figure with an explicit marker (€ or EUR). A bare number is
// never read as a price claim - kWh loads and savings must not trip these
// guards, so every price detection requires the currency marker.
const CURRENCY = /(?:€|EUR)\s*[\d.,]+/i;

// The seven weekday names: any of them tied to a price figure is beyond
// tomorrow by construction (prices exist only for today and tomorrow).
const WEEKDAY_RE = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g;

// An explicit calendar date, e.g. "2026-10-23".
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
}

// Guard 1: the tomorrow-price prohibition while unpublished.
// While tomorrow's prices are null (unpublished), no sentence may combine a
// reference to tomorrow - the word itself or the "day after" / "next day"
// paraphrases - with a currency figure. Once published, the guard is inert -
// real tomorrow prices may be stated and are checked by checker.mjs
// against the curve instead.
const TOMORROW_REF_RE = /\btomorrow\b|\bday\s+after\b|\bnext\s+day\b/i;

export function guardTomorrowPrice(text, { tomorrowPublished = false } = {}) {
  const problems = [];
  if (tomorrowPublished) return { ok: true, problems };
  for (const sentence of splitSentences(text)) {
    if (TOMORROW_REF_RE.test(sentence) && CURRENCY.test(sentence)) {
      problems.push(
        "states a price for tomorrow while tomorrow's prices are not published"
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// Guard 2: the beyond-tomorrow price prohibition.
// No price may be stated for any day beyond tomorrow: a currency figure in
// the same sentence as a weekday name, an explicit calendar date, or "next
// week" is a fabrication - those days carry solar facts only.
export function guardBeyondTomorrowPrice(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    if (!CURRENCY.test(sentence)) continue;
    for (const match of sentence.matchAll(WEEKDAY_RE)) {
      problems.push(
        `states a price for ${match[0]}, which is beyond tomorrow`
      );
    }
    if (ISO_DATE_RE.test(sentence)) {
      problems.push("states a price for a dated day beyond tomorrow");
    }
    if (/\bnext\s+week\b/i.test(sentence)) {
      problems.push("states a price for next week, which is beyond tomorrow");
    }
  }
  return { ok: problems.length === 0, problems };
}

// Time ranges ("14:00-17:00", "between 12:00 and 15:00") are legitimate
// window labels, not arithmetic - mask them before the operator scan.
function maskTimeRanges(sentence) {
  return sentence
    .replace(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/gi, "range")
    .replace(
      /\b(?:between|from)\s+\d{1,2}:\d{2}\s+(?:and|to|-)\s+\d{1,2}:\d{2}/gi,
      "range"
    );
}

// Guard 3: the arithmetic-expression ban.
// The model writes meaning, not computation: a figure combined with an
// operator and another figure ("0.38 - 0.26", "1.07 * 0.12") or a word-form
// operator between two figures ("0.38 minus 0.26") is rejected. Savings are
// server-computed and rendered by the card; they never appear as math.
export function guardArithmetic(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    const masked = maskTimeRanges(sentence);
    if (/\d[\d.,]*\s*[+\-*/×]\s*\d/.test(masked)) {
      problems.push("contains an arithmetic expression between figures");
    } else if (
      /[\d.,]+\s*(?:EUR|€)?\s*\b(?:minus|plus)\b\s*(?:EUR|€)?\s*[\d.,]+/i.test(
        masked
      )
    ) {
      problems.push("contains an arithmetic expression between figures");
    }
  }
  return { ok: problems.length === 0, problems };
}

// Guard 4: the internal-vocabulary ban (contract section 9: no operator
// abstractions, no internal vocabulary in user-facing text). The banned
// tokens are project-internal names - candidate codes, phase labels, gate
// and threshold mechanics, pipeline internals. Each hit is reported with
// the token found so a rejection is actionable.
const INTERNAL_TOKENS = [
  [/\bC\d+[a-z]?\d*\b/gi, "candidate code"],
  [/\bphase\b\w*/gi, "phase label"],
  [/\bpivot\w*\b/gi, "pivot term"],
  [/\bpracticality\w*\b/gi, "practicality-gate term"],
  [/\bspread\w*\b/gi, "spread term"],
  [/\bthreshold\w*\b/gi, "threshold term"],
  [/\bsignature\w*\b/gi, "signature term"],
  [/\bcache\w*\b/gi, "cache term"],
  [/\bregenerat\w+\b/gi, "regeneration term"],
  [/\bsoc\b/gi, "SOC abbreviation"],
  [/\bkiosk\w*\b/gi, "kiosk term"],
  [/\bprompt\w*\b/gi, "prompt term"],
  [/\bfacts?\s+layer\b/gi, "facts-layer term"],
  [/\bconsumers?\b/gi, "consumer term"],
];

export function guardInternalVocabulary(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    for (const [pattern, label] of INTERNAL_TOKENS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(sentence);
      if (match !== null) {
        problems.push(`uses internal vocabulary: "${match[0]}" (${label})`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

// Guard 5: the NaN/Infinity ban. A non-finite placeholder leaking into a
// sentence means a server-computed number went missing; it is never served
// as prose.
export function guardNonFiniteText(text) {
  const problems = [];
  if (/\bNaN\b/i.test(String(text ?? ""))) {
    problems.push("contains NaN");
  }
  if (/\bInfinity\b/i.test(String(text ?? ""))) {
    problems.push("contains Infinity");
  }
  return { ok: problems.length === 0, problems };
}

// Guard 6: the figure ban. The model never writes figures - the card renders
// every number from the facts (contract section 4). A model-authored
// sentence containing any digit, a currency marker (€ or the code EUR) or a
// percent marker is rejected; conservative rejection is the safe direction,
// because no guard can verify a figure the checker does not know how to
// read (kWh loads, percentages, euro amounts without an hour).
const FIGURE_MARKER_RE = /\d|€|%|\bEUR\b/i;

export function guardNoFigures(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    const match = FIGURE_MARKER_RE.exec(sentence);
    if (match !== null) {
      problems.push(
        `contains the figure marker "${match[0]}" - the card renders every number; model sentences carry meaning only`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// Guard 7: the register rules (contract section 4 voice register, the
// mechanically safe subset). Model sentences are warm but factual: no
// exclamation marks, and no flattery - the deterministic achievement lines
// carry the positives. Whole words, case insensitive.
const FLATTERY_WORDS = [
  "congratulations",
  "well done",
  "great job",
  "awesome",
  "amazing",
  "superb",
  "fantastic",
  "brilliant",
  "wonderful",
];

export function guardRegister(text) {
  const problems = [];
  const t = String(text ?? "");
  if (/!/.test(t)) {
    problems.push(
      "contains an exclamation mark; model sentences are warm but factual"
    );
  }
  for (const word of FLATTERY_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(t)) {
      problems.push(
        `contains flattery ("${word}"); the deterministic achievement lines carry the positives`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Contract section 4 output rules for the contextNote slot. The contextNote
// carries meaning, not figures: it is null when an action exists (enforced in
// validateModelOutput), and its text never restates the action's numbers,
// appliance names or windows, never writes the server-injected no-opportunity
// statement, and is never phrased as deferral advice.
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Display precision for figure matching: half a cent / half a kWh unit at the
// served two-decimal display, with the same float guard the boundary problems
// demand. A bare number is never read as an action figure - currency and kWh
// markers are required, so unrelated numbers cannot trip this guard.
const FIGURE_TOLERANCE = 0.005;
const FLOAT_GUARD = 1e-9;

function parseFigure(raw) {
  return Number(String(raw).replace(",", ""));
}

// Guard 8: the action-restatement ban (contract section 4). A contextNote
// that names the selected candidate's appliance, states its saving figure or
// kWh load, or quotes its window label restates the action - the card renders
// those from server-computed fields. Inert when no worthwhile candidate
// exists: there is then no action to restate.
export function guardActionRestatement(text, { candidate } = {}) {
  const problems = [];
  if (!candidate) return { ok: true, problems };
  const t = String(text ?? "");

  // The appliance name of the selected candidate.
  if (typeof candidate.label === "string" && candidate.label.trim() !== "") {
    const labelRe = new RegExp(
      `\\b${escapeRegExp(candidate.label.trim())}\\b`,
      "i"
    );
    if (labelRe.test(t)) {
      problems.push(`restates the action's appliance name "${candidate.label}"`);
    }
  }

  // The action's saving figure, with a currency marker. The candidate is the
  // today section's fact, so its keys are the section shape (saving_eur).
  if (typeof candidate.saving_eur === "number" && Number.isFinite(candidate.saving_eur)) {
    for (const m of t.matchAll(/(?:€|EUR)\s*([\d.,]+)/gi)) {
      const value = parseFigure(m[1]);
      if (Math.abs(value - candidate.saving_eur) <= FIGURE_TOLERANCE + FLOAT_GUARD) {
        problems.push(`restates the action's saving figure EUR ${m[1]}`);
        break;
      }
    }
  }

  // The action's load, with a kWh marker.
  if (typeof candidate.kwh === "number" && Number.isFinite(candidate.kwh)) {
    for (const m of t.matchAll(/([\d.,]+)\s*kW[hH]/gi)) {
      const value = parseFigure(m[1]);
      if (Math.abs(value - candidate.kwh) <= FIGURE_TOLERANCE + FLOAT_GUARD) {
        problems.push(`restates the action's load of ${candidate.kwh} kWh`);
        break;
      }
    }
  }

  // The action's window label, in range form ("14:00-17:00") or words.
  if (typeof candidate.window === "string" && candidate.window.includes("-")) {
    const [start, end] = candidate.window.split("-");
    const dashForm = t.replace(/–/g, "-").includes(candidate.window);
    const wordForm = new RegExp(
      `\\b(?:between|from)\\s*${escapeRegExp(start)}\\s*(?:and|to|-)\\s*${escapeRegExp(end)}\\b`,
      "i"
    ).test(t);
    if (dashForm || wordForm) {
      problems.push(`restates the action's window ${candidate.window}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

// Guard 9: the no-opportunity and deferral-phrasing ban (contract section 4).
// The statement "No action worth taking today" is a deterministic constant the
// server injects; the model never writes it. It is also never phrased as
// deferral advice - the two standing patterns are "wait until ..." and
// "hold off until/for ...".
const NO_OPPORTUNITY_RE = /\bno\s+action\s+worth\s+taking\b/i;
const DEFERRAL_PATTERNS = [
  [/\b(?:waits?|waiting)\s+until\b/i, "wait until"],
  [/\bhold\s+off\s+(?:until|for)\b/i, "hold off until"],
];

export function guardNoOpportunityPhrasing(text) {
  const problems = [];
  const t = String(text ?? "");
  if (NO_OPPORTUNITY_RE.test(t)) {
    problems.push("writes the server-injected no-opportunity statement");
  }
  for (const [pattern, label] of DEFERRAL_PATTERNS) {
    if (pattern.test(t)) {
      problems.push(`phrases advice as deferral ("${label}")`);
    }
  }
  return { ok: problems.length === 0, problems };
}
