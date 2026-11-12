// The context-box narrative guards (contract section 11), one guard set
// per spoke-page section box. Pure functions over one section narrative
// plus only that section's served facts: each returns { ok, problems }
// with human-readable, named rejection reasons, so a retry's feedback
// line corrects instead of re-rolling blind. No IO, no clock, no env.

import { extractFigureTokens, validateNarrativeFigures } from "./advisory/figure-verbatim.mjs";
import {
  guardArithmetic,
  guardInternalVocabulary,
  guardNonFiniteText,
  guardRegister,
} from "./advisory/narrative-guards.mjs";

function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
}

// The membership form of a figure token: exact raw for amounts, kWh,
// m3 and bare numbers; normalized for times, ranges and percentages.
function memberKey(token) {
  if (token.kind === "range" || token.kind === "time" || token.kind === "percent") {
    return token.normalized;
  }
  return token.raw;
}

// ---------------------------------------------------------------------------
// guardUnservedWeather (contract section 11, weather vocabulary): weather
// words are allowed only in a section whose facts carry a served condition
// fact. Any other section rejects them with the word named.
// ---------------------------------------------------------------------------

const WEATHER_WORD_RE =
  /\b(?:rain\w*|drizzle\w*|shower\w*|snow\w*|sleet|thunder\w*|storm\w*|fog\w*|cloud\w*|overcast|sunny|sunshine|wind\w*|breezy|hail|weather|sun)\b/i;

export function guardUnservedWeather(text, facts) {
  const problems = [];
  const condition =
    typeof facts?.condition === "string" && facts.condition !== ""
      ? facts.condition
      : null;
  if (condition !== null) return { ok: true, problems };
  for (const sentence of splitSentences(text)) {
    const match = WEATHER_WORD_RE.exec(sentence);
    if (match !== null) {
      problems.push(
        `uses the weather word "${match[0]}" but no condition fact is served to this section; weather vocabulary only where a condition fact is served`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// guardPresentTenseProduction (contract section 11, semantics): energy
// figures are day or period totals, never live power, so a present-tense
// production claim ("is producing") is rejected by name.
// ---------------------------------------------------------------------------

const PRESENT_TENSE_PRODUCTION_RE =
  /\b(?:is|are|was|were|be|being)\s+(?:currently\s+|right\s+now\s+|at\s+the\s+moment\s+)?(?:producing|generating|delivering|making)\b|\bnow\s+producing\b|\bproducing\s+(?:right\s+now|currently)\b/i;

export function guardPresentTenseProduction(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    const match = PRESENT_TENSE_PRODUCTION_RE.exec(sentence);
    if (match !== null) {
      problems.push(
        `states production in the present tense ("${match[0]}"); energy figures are day or period totals, never live power`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// guardWeekBestFraming (contract section 11, framing): a best-day claim
// needs the section's marker fact (week_best). Without it, any sentence
// pairing "best" with a day or week is rejected with the sentence named.
// ---------------------------------------------------------------------------

export function guardWeekBestFraming(text, facts) {
  const problems = [];
  if (facts?.week_best === true) return { ok: true, problems };
  for (const sentence of splitSentences(text)) {
    if (/\bbest\b/i.test(sentence) && /\b(?:day|week)\b/i.test(sentence)) {
      problems.push(
        `frames a best-day claim ("${sentence.trim()}") but no best-day marker fact is served to this section`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// guardProvenance (contract section 11, provenance): estimated figures
// must appear with a hedging word (estimate, estimated, about, ...);
// measured figures must never be hedged as estimates. The section's fact
// set carries the two figure lists (estimated_figures, measured_figures)
// alongside the figures themselves, so the check is a membership test.
// ---------------------------------------------------------------------------

const HEDGE_RE = /\b(?:estimat\w+|about|roughly|around|approximately)\b/i;

export function guardProvenance(text, facts) {
  const problems = [];
  const estimated = new Set(
    Array.isArray(facts?.estimated_figures) ? facts.estimated_figures : []
  );
  const measured = new Set(
    Array.isArray(facts?.measured_figures) ? facts.measured_figures : []
  );
  if (estimated.size === 0 && measured.size === 0) return { ok: true, problems };
  for (const sentence of splitSentences(text)) {
    const tokens = extractFigureTokens(sentence);
    const estimatedHit = tokens.find((t) => estimated.has(memberKey(t)));
    if (estimatedHit !== undefined && !HEDGE_RE.test(sentence)) {
      problems.push(
        `states the estimated figure "${estimatedHit.raw}" without hedging it (estimate, estimated, about)`
      );
    }
    // A hedge word next to a measured figure is only a violation when the
    // sentence carries no estimated figure that explains the hedge.
    const measuredHit = tokens.find((t) => measured.has(memberKey(t)));
    if (
      measuredHit !== undefined &&
      estimatedHit === undefined &&
      HEDGE_RE.test(sentence)
    ) {
      problems.push(
        `hedges the measured figure "${measuredHit.raw}" as an estimate; measured figures are never hedged`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// guardImperativeRegister (contract section 11, register): imperative-mood
// sentences are banned in context boxes, always, with the opening named.
// Advice passes only as declarative-comparative sentences, and only when
// the section's facts carry a server-computed verdict or opportunity
// field; modal advice without one is rejected by name.
// ---------------------------------------------------------------------------

const IMPERATIVE_START_RE =
  /^(?:please\s+)?(?:run|turn|start|stop|shift|use|charge|discharge|plug|unplug|wait|avoid|keep|set|open|close|do|make|let|try|remember|consider|schedule|load|prefer|switch|select)\b/i;
const MODAL_ADVICE_RE =
  /\byou\s+(?:should|can|could|will\s+want\s+to)\b|\blet's\b|\bmake\s+sure\b/i;

export function guardImperativeRegister(text, facts) {
  const problems = [];
  const verdictServed =
    (typeof facts?.verdict === "string" && facts.verdict !== "") ||
    facts?.opportunity !== null && facts?.opportunity !== undefined;
  for (const sentence of splitSentences(text)) {
    const trimmed = sentence.trim();
    const imperative = IMPERATIVE_START_RE.exec(trimmed);
    if (imperative !== null) {
      problems.push(
        `imperative-mood sentence ("${trimmed.slice(0, 40)}") is banned in context boxes; advice is declarative and comparative only`
      );
      continue;
    }
    const modal = MODAL_ADVICE_RE.exec(sentence);
    if (modal !== null && !verdictServed) {
      problems.push(
        `gives advice ("${modal[0]}") but no verdict or opportunity fact is served to this section; advice passes only as declarative-comparative sentences when a verdict or opportunity fact is served`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// The full pure check for one context-box section narrative: figure-verbatim
// membership in this section's own fact set, the five context-box guards,
// and the shared narrative guards (arithmetic, internal vocabulary,
// non-finite, register).
// ---------------------------------------------------------------------------

export function validateContextBoxSection(narrative, section) {
  const text =
    typeof narrative === "string" && narrative.trim() !== "" ? narrative : null;
  if (text === null) return { ok: true, reasons: [] };
  const facts = section.facts ?? {};
  const reasons = [...validateNarrativeFigures(text, facts).problems];
  for (const guard of [
    guardUnservedWeather(text, facts),
    guardPresentTenseProduction(text),
    guardWeekBestFraming(text, facts),
    guardProvenance(text, facts),
    guardImperativeRegister(text, facts),
    guardArithmetic(text),
    guardInternalVocabulary(text),
    guardNonFiniteText(text),
    guardRegister(text),
  ]) {
    reasons.push(...guard.problems);
  }
  return { ok: reasons.length === 0, reasons };
}
