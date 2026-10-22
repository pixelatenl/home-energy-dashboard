// The served-text audit (contract section 9): a pure helper applied to every
// composed sentence in a served payload. It verifies that every sentence
// opens with a capital letter, a legitimate figure or a currency symbol
// (a signed amount "-€0.04" opens with a legitimate figure), that titles
// never end in a period while descriptions always do, that every money amount
// uses the euro symbol flush against the amount and never the code "EUR",
// and that no internal vocabulary (candidate, threshold, payload, budget,
// signature, cache) appears in any composed sentence.
//
// Classification: the sentence-bearing fields are the served strings a
// renderer shows as prose - warning, context_note, supporting_facts,
// priceSentence, batterySentence, achievements, guidance.line, the advisory
// line and horizon note, the outlook lines and the poor-day advice. The primary
// action's `what` is a title, as is the no-opportunity statement (the card's
// lead headline, pinned constant without a period). Label fields - windows,
// timestamps, weekday and condition names, candidate basis notes - are not
// sentences and are not audited for punctuation. No IO, no Date.now(), no
// environment reads: the audit is a pure function of the payload.

import { NO_OPPORTUNITY_STATEMENT } from "./advisory-core.mjs";

// Project-internal words that must never reach the household in served text,
// plus a small flattery ban: the deterministic achievement lines carry the
// positives, so no served sentence may congratulate the household.
const BANNED_VOCABULARY = [
  "candidate",
  "threshold",
  "payload",
  "budget",
  "signature",
  "cache",
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

// Missing-data placeholders that must never appear as literal tokens in a
// composed sentence (F1 defense in depth): a sentence carrying one means a
// fact went missing and its template rendered anyway.
const MISSING_DATA_TOKENS = ["NaN", "null", "undefined", "Infinity"];

// Collects every composed sentence in the payload with its payload path and
// its kind: "title" (never ends in a period) or "sentence" (opens with a
// capital, figure or currency symbol; always ends in a period). Empty and
// null fields are skipped - a missing fact omits its sentence.
function collectComposedSentences(card) {  const items = [];
  const add = (path, text, kind = "sentence") => {
    if (typeof text === "string" && text.trim() !== "") {
      items.push({ path, text: text.trim(), kind });
    }
  };
  add("warning", card.warning);
  add("context_note", card.context_note);
  add("priceSentence", card.priceSentence);
  add("batterySentence", card.batterySentence);
  for (const [i, line] of (card.achievements ?? []).entries()) {
    add(`achievements[${i}]`, line);
  }
  for (const [i, fact] of (card.supporting_facts ?? []).entries()) {
    add(
      `supporting_facts[${i}]`,
      fact,
      fact === NO_OPPORTUNITY_STATEMENT ? "title" : "sentence"
    );
  }
  if (card.primary_action) {
    add("primary_action.what", card.primary_action.what, "title");
  }
  if (card.guidance) {
    add("guidance.line", card.guidance.line);
  }
  if (card.advisory) {
    add("advisory.line", card.advisory.line);
    add("advisory.horizon_note", card.advisory.horizon_note);
  }
  if (card.outlook) {
    if (card.outlook.best_solar_day) {
      add("outlook.best_solar_day.line", card.outlook.best_solar_day.line);
    }
    if (card.outlook.poor_day) {
      add("outlook.poor_day.line", card.outlook.poor_day.line);
      add("outlook.poor_day.advice", card.outlook.poor_day.advice);
    }
  }
  return items;
}

// Audits one collected sentence: titles never end in a period; sentences
// open with a capital, a figure or a currency symbol and always end in a
// period; every money amount uses the euro symbol flush against the
// amount and never the code "EUR"; no internal vocabulary, no flattery,
// no missing-data tokens. Shared by the card audit and the monologue
// prose audit.
function auditSentenceItem({ path, text, kind }) {
  const failures = [];
  if (kind === "title") {
    if (text.endsWith(".")) {
      failures.push({
        path,
        rule: "title must never end in a period",
        text,
      });
    }
  } else {
    if (!/^[A-Z0-9€]|^-€/.test(text)) {
      failures.push({
        path,
        rule: "sentence must open with a capital letter, a figure or a currency symbol",
        text,
      });
    }
    if (!/\.$/.test(text)) {
      failures.push({ path, rule: "description must always end in a period", text });
    }
  }
  if (/\bEUR\b/i.test(text)) {
    failures.push({
      path,
      rule: "money must use the euro symbol, never the code EUR",
      text,
    });
  }
  // The euro sign sits flush against the amount it precedes: never a space
  // after it, never trailing the amount ("€ 0.26", "0.26 €", "0.26€").
  if (/€(?!\d)/.test(text) || /\d\s*€/.test(text)) {
    failures.push({
      path,
      rule: "euro symbol must sit flush against the amount",
      text,
    });
  }
  for (const word of BANNED_VOCABULARY) {
    if (new RegExp(`\\b${word}s?\\b`, "i").test(text)) {
      failures.push({
        path,
        rule: `internal vocabulary "${word}" must not appear in served text`,
        text,
      });
    }
  }
  for (const token of MISSING_DATA_TOKENS) {
    if (new RegExp(`\\b${token}\\b`, "i").test(text)) {
      failures.push({
        path,
        rule: `missing-data token "${token}" must never appear in a served sentence`,
        text,
      });
    }
  }
  return failures;
}

// Audits one served payload. Returns { ok, failures } where each failure
// carries the payload path, the violated rule and the offending text, so
// a rejection is actionable. Checker rejection reasons are never audited: the
// audit sees only the composed payload.
export function auditServedText(card) {
  const failures = [];
  for (const item of collectComposedSentences(card ?? {})) {
    failures.push(...auditSentenceItem(item));
  }
  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// The monologue prose audit (STEP 3): the same sentence rules applied to
// the monologue payload's served prose. Each section serves its narrative
// when one was accepted and its deterministic fallback sentences
// otherwise - the served text is what the household reads, so that is
// what gets audited. Figure membership is not audited here: it is
// enforced per section by the figure-verbatim validation (STEP 2).
// ---------------------------------------------------------------------------

export function auditMonologueText(monologue) {
  const failures = [];
  const sections = Array.isArray(monologue) ? monologue : [];
  for (const [i, section] of sections.entries()) {
    const label = typeof section?.label === "string" ? section.label : `section ${i}`;
    const narrative =
      typeof section?.narrative === "string" && section.narrative.trim() !== ""
        ? section.narrative
        : null;
    const served =
      narrative !== null
        ? narrative
        : (Array.isArray(section?.fallback_sentences)
            ? section.fallback_sentences
            : []
          ).join(" ");
    const sentences = String(served ?? "")
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence.trim() !== "");
    for (const sentence of sentences) {
      const text = sentence.trim();
      if (text === "") continue;
      // The pinned no-opportunity statement is the card's lead headline:
      // a title, never period-terminated.
      const kind = text === NO_OPPORTUNITY_STATEMENT ? "title" : "sentence";
      failures.push(
        ...auditSentenceItem({ path: `monologue[${i}] ${label}`, text, kind })
      );
    }
  }
  return { ok: failures.length === 0, failures };
}
