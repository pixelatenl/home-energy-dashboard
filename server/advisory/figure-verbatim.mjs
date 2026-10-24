// The figure-verbatim validation for monologue narratives (STEP 2 of the
// brief). Pure module: no clock reads, no network, no environment reads.
//
// Where the old card rendered every number and banned figures from model
// prose outright (guardNoFigures), the monologue invites the model to weave
// the section's served figures into flowing prose - and this module makes
// that safe: every figure token the narrative carries must be a verbatim
// member of that section's own fact set, and an "opportunity" claim is
// allowed only when the section facts carry a matched, positive,
// above-threshold candidate. A figure belonging to another section can
// never pass, because membership is checked against this section's facts
// only.
//
// The extraction patterns generalize checker.mjs's price-pair approach
// (currency-marker-anchored figures, zero-padded hour labels) to all
// figure classes: currency amounts, clock times, time ranges, kWh values,
// percentages and scores (bare figures). checker.mjs stays frozen; the
// patterns are re-implemented here in its style.

// ---------------------------------------------------------------------------
// The framing rule (implemented first, per the continued instructions).
// An "opportunity" claim requires a matched, positive, above-threshold
// candidate in the section facts. The section facts mark that with
// action_available === true (set only for a worthwhile candidate); a
// negative or below-threshold saving is never framed as an opportunity.
// ---------------------------------------------------------------------------

const OPPORTUNITY_RE = /\bopportunit(?:y|ies)\b/i;

function opportunityClaim(text) {
  const m = OPPORTUNITY_RE.exec(String(text ?? ""));
  if (m === null) return null;
  // The full sentence carrying the claim, so the rejection names the
  // framing the household would have read.
  const sentence =
    String(text)
      .split(/(?<=[.!?])\s+/)
      .find((s) => OPPORTUNITY_RE.test(s)) ?? String(text);
  return { word: m[0], sentence: sentence.trim() };
}

export function validateFraming(text, facts) {
  const problems = [];
  const claim = opportunityClaim(text);
  if (claim !== null && facts?.action_available !== true) {
    problems.push(
      `frames an opportunity ("${claim.sentence}") but this section has no positive, above-threshold candidate`
    );
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Figure token extraction: one scan, six classes. Alternation order
// matters - a range consumes its two clock times, a currency amount
// consumes its digits, a kWh value consumes its figure - so no figure is
// double-captured as a bare number.
// ---------------------------------------------------------------------------

// The numeric core of a figure token: digits with embedded separators,
// never a trailing one - "€0.31." at a sentence end extracts "€0.31", not
// "€0.31.".
const FIGURE_NUM = "\\d+(?:[.,]\\d+)*";

const TOKEN_RE = new RegExp(
  [
    "(?<range>\\d{1,2}:\\d{2}\\s*[-–]\\s*\\d{1,2}:\\d{2})",
    `(?<currency>-?(?:€|EUR)\\s*${FIGURE_NUM})`,
    `(?<kwh>${FIGURE_NUM}\\s*kWh)`,
    `(?<percent>${FIGURE_NUM}\\s?%)`,
    "(?<time>\\d{1,2}:\\d{2})",
    `(?<number>${FIGURE_NUM})`,
  ].join("|"),
  "gi"
);

// "2:00" and "02:00" name the same hour; the served fact strings carry
// zero-padded local hour labels (checker.mjs normalizes the same way).
function normalizeHourLabel(hour) {
  const [hh, mm] = hour.split(":");
  return `${hh.padStart(2, "0")}:${mm}`;
}

function normalizeRange(raw) {
  const m = /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(raw);
  return `${normalizeHourLabel(m[1])}-${normalizeHourLabel(m[2])}`;
}

// Extracts every figure token from prose: { kind, raw, normalized }.
// kind is one of range, currency, kwh, percent, time, number; raw is the
// token exactly as written (what a rejection names), normalized is the
// comparison form (padded hours, dash-normalized ranges, a percentage's
// whitespace before the percent sign removed).
export function extractFigureTokens(prose) {
  const tokens = [];
  for (const match of String(prose ?? "").matchAll(TOKEN_RE)) {
    const groups = match.groups ?? {};
    const kind = Object.keys(groups).find((k) => groups[k] !== undefined);
    if (kind === undefined) continue;
    const raw = match[0];
    tokens.push({
      kind,
      raw,
      normalized:
        kind === "range"
          ? normalizeRange(raw)
          : kind === "time"
            ? normalizeHourLabel(raw)
            : kind === "percent"
              ? raw.replace(/\s+%/u, "%")
              : raw,
    });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Membership: the section's own served fact set, nothing wider.
// ---------------------------------------------------------------------------

const TIME_LEAF_RE = /^\d{1,2}:\d{2}$/;
const RANGE_LEAF_RE = /^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$/;

function collectStringLeaves(value, out) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStringLeaves(entry, out);
  } else if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) collectStringLeaves(entry, out);
  }
}

export function servedFigureSets(facts) {
  const leaves = [];
  collectStringLeaves(facts ?? {}, leaves);
  const exact = new Set(leaves);
  const times = new Set(
    leaves.filter((s) => TIME_LEAF_RE.test(s)).map(normalizeHourLabel)
  );
  const ranges = new Set(
    leaves.filter((s) => RANGE_LEAF_RE.test(s)).map(normalizeRange)
  );
  return { exact, times, ranges };
}

// ---------------------------------------------------------------------------
// The per-section figure-verbatim validation. amounts must match the
// served formatted string exactly, including the currency marker (€0.23,
// never "0.23" and never "EUR 0.23"); times and ranges must match exactly
// (zero-padding normalized); percentages match with the whitespace
// before the percent sign normalized, so "5 %" matches the served "5%";
// kWh values and scores must appear verbatim. Every other figure matches
// nothing and is rejected.
// ---------------------------------------------------------------------------

export function validateNarrativeFigures(narrative, facts) {
  const problems = [];
  const sets = servedFigureSets(facts);
  for (const token of extractFigureTokens(narrative)) {
    const member =
      token.kind === "range"
        ? sets.ranges.has(token.normalized)
        : token.kind === "time"
          ? sets.times.has(token.normalized)
          : token.kind === "percent"
            ? sets.exact.has(token.normalized)
            : sets.exact.has(token.raw);
    if (member) continue;
    const named = {
      range: `time range "${token.raw}" matches no served window in this section`,
      time: `time "${token.raw}" matches no served time in this section`,
      currency: `amount "${token.raw}" matches no served amount in this section (amounts carry the currency marker exactly as served; never compute a difference or total; state the amounts side by side exactly as served)`,
      kwh: `kWh figure "${token.raw}" matches no served kWh figure in this section`,
      percent: `percentage "${token.raw}" matches no served percentage in this section (write percentages exactly as served, for example "5%" without a space)`,
      number: `figure "${token.raw}" matches no served figure in this section`,
    }[token.kind];
    problems.push(named);
  }
  return { ok: problems.length === 0, problems };
}

// The full pure check for one section narrative: figure membership plus
// the framing rule. Readable problems, first failure included, so a
// rejection is actionable.
export function validateSectionFigures(narrative, facts) {
  const problems = [
    ...validateNarrativeFigures(narrative, facts).problems,
    ...validateFraming(narrative, facts).problems,
  ];
  return { ok: problems.length === 0, problems };
}
