// The weather context box guards. The weather widget box is a context
// box: it explains why the forecast looks the way it does, so it never
// advises (no appliance or timing advice - that is the hub advisory's
// job, and it owns the price facts) and never talks about prices (no
// price data is served to this box). Each guard is a pure function over
// the model-authored text plus only the served context it needs, and
// returns { ok, problems } with human-readable rejection reasons. No
// IO, no Date.now(), no environment reads.

import { guardNonFiniteText } from "./advisory/narrative-guards.mjs";

function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
}

// Guard 1: the appliance-advice ban. This box never advises, so any
// mention of an appliance (appliances, washing machine, dishwasher,
// dryer) rejects, and so does any run/start/plan imperative about
// energy use in the same sentence.
const APPLIANCE_RE =
  /\b(?:appliances?|washing\s+machines?|dishwashers?|dryers?|tumble\s+dryers?|laundry)\b/i;
const ENERGY_USE_RE =
  /\b(?:energy|electricity|power|usage|consumption|appliance|machine|load|laundry|washer|dishwasher|dryer)\b/i;
const RUN_PLAN_IMPERATIVE_RE =
  /\b(?:run|start|plan|schedule|time|shift|turn\s+on|switch\s+on|put\s+on|programme|program)\b/i;

export function guardNoApplianceAdvice(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    const appliance = APPLIANCE_RE.exec(sentence);
    if (appliance !== null) {
      problems.push(
        `mentions "${appliance[0]}" - this box never advises on appliances or energy use`
      );
      continue;
    }
    const imperative = RUN_PLAN_IMPERATIVE_RE.exec(sentence);
    if (imperative !== null && ENERGY_USE_RE.test(sentence)) {
      problems.push(
        `gives a run/start/plan imperative about energy use ("${imperative[0]}") - this box never advises`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// Guard 2: the price-vocabulary ban. No price facts are served to this
// box, so any price word (price, cheap, expensive, cost, euro, the
// currency sign or the EUR code) rejects with the matched word named.
const PRICE_WORD_RE =
  /\b(?:prices?|pricing|cheap(?:er|est)?|expensive|costs?|costly|euros?)\b|€|\bEUR\b/gi;

export function guardNoPriceVocabulary(text) {
  const problems = [];
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(PRICE_WORD_RE)) {
    const word = match[0];
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(
      `uses price vocabulary ("${word}") while no price facts are served to this box`
    );
  }
  return { ok: problems.length === 0, problems };
}

// Guard 3: the band-consistency guard. The served per-day band labels
// (solarScoreBand in advisory-constants.mjs) carry the meaning of a
// score, so a positive evaluative claim is grounded only when at least
// one served day has band "good". When no served day is "good", any
// positive evaluative word (good, great, excellent, strong, and
// intensifiers like "very good") rejects with the matched phrase named.
// The band vocabulary itself ("little sun", "moderate", "good") is
// allowed exactly as served.
const POSITIVE_EVALUATIVE_RE =
  /\b(?:very|really|pretty|extremely)\s+(?:good|great|excellent|strong)\b|\b(?:good|great|excellent|strong|fantastic|amazing|superb|brilliant|wonderful|awesome)\b/gi;

export function guardBandConsistency(text, context) {
  const problems = [];
  const days = Array.isArray(context?.days) ? context.days : [];
  const anyGoodDay = days.some((day) => day?.solar_band === "good");
  if (anyGoodDay) return { ok: true, problems };
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(POSITIVE_EVALUATIVE_RE)) {
    const phrase = match[0];
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(
      `uses the positive evaluative phrase "${phrase}" while no served day has band "good"; use the served band labels only`
    );
  }
  return { ok: problems.length === 0, problems };
}

// The weather box validator: the non-finite guard plus the three
// weather guards above, over the served context the text was generated
// against. Returns { ok, problems } with every named reason.
export function validateWeatherInsight(text, context) {
  const guards = [
    guardNonFiniteText(text),
    guardNoApplianceAdvice(text),
    guardNoPriceVocabulary(text),
    guardBandConsistency(text, context),
  ];
  const problems = guards.flatMap((guard) => guard.problems);
  return { ok: problems.length === 0, problems };
}
