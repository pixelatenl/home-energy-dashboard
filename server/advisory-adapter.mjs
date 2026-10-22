// The advisory core adapter: the seam between the summary insight path
// and the advisory core in server/advisory/. The style brief, the facts
// preparation and the transport merge live here; the core files stay pure
// (no environment access, no clock reads). The core is the only advisory
// pipeline; every insight endpoint serves through this module. Contract
// sections 3 to 5 are the wording source for the brief and the merge
// rules.

import {
  buildAdvisoryModelContext,
  buildSections,
  composeAdvisoryCard,
} from "./advisory/advisory-core.mjs";
import {
  buildMonologueSections,
  generateMonologue,
} from "./advisory/advisory-monologue.mjs";
import { buildAdvisoryFacts } from "./facts.mjs";
import { localIsoWithOffset } from "./time.mjs";

// The monologue switch: EMS_ADVISORY_MONOLOGUE, default off, read once
// at startup. While off the summary payload carries no monologue field
// and is identical to today's.
const MONOLOGUE_SWITCH =
  (process.env.EMS_ADVISORY_MONOLOGUE ?? "").trim().toLowerCase();
export const ADVISORY_MONOLOGUE_ENABLED =
  MONOLOGUE_SWITCH === "1" || MONOLOGUE_SWITCH === "true";

// The style brief for the modelStub, from contract sections 3 and 4: the
// sections model is the input, the output carries exactly the two
// model-authored slots, and every register rule the guards enforce is
// stated once here in household words.
export const ADVISORY_CARD_STYLE_BRIEF = `You are the advisory voice of a home energy dashboard in the Netherlands. You receive a sections context: now_local, today_date and a list of sections, each carrying facts and one guidance note stating how you may use it. Reply with JSON only, no preamble, no markdown fences, in English, with exactly two keys: "warning" (string or null) and "contextNote" (string or null).

warning is written only for something that needs attention and implies what to check. contextNote is written only on quiet days, when no candidate action exists: one coherent sentence explaining why there is nothing to schedule, or a genuine insight the card's rows do not carry, grounded in any section's facts. contextNote is null when an action exists, and it never restates the action's numbers, appliance names or windows.

Voice: warm household register, addressing the household in the second person, plain home words, factual. No figures of any kind - no digits, no currency or percent markers; the card renders every number from its own rows. No exclamation marks, no flattery, no motivational filler. Never restate what the card's rows already say, and never issue an instruction: the card is the only imperative voice. Never write the sentence "No action worth taking today", and never phrase deferral advice, such as waiting for a better day.`;

// One request's advisory card inputs: the consolidated facts from the
// facts layer, and the request's local moment injected as pure data -
// the core throws without nowIso, so the adapter always provides it.
// The loaders pass through to the facts layer for the tests.
export async function prepareAdvisoryRequest(snapshot, loaders = {}) {
  return {
    facts: await buildAdvisoryFacts(snapshot, loaders),
    nowIso: localIsoWithOffset(new Date()),
    styleBrief: ADVISORY_CARD_STYLE_BRIEF,
  };
}

// The exact sections context the model receives (contract section 3):
// now_local, today_date and the sections with their facts and guidance
// notes. Read-only, no model call - the debug endpoint's traceability
// view.
export function advisorySectionsContext(request) {
  const sections = buildSections(request.facts, request.nowIso);
  return buildAdvisoryModelContext({
    now_local: request.nowIso,
    today_date: request.nowIso.slice(0, 10),
    sections,
  });
}

// Merges the core's composed card with the transport fields the summary
// insight path owns (contract section 5: generated_at, insight_as_of,
// state, stale and error are never touched by the composer). The card is
// composed from the request's live facts on every serve, so its rows
// never go stale between generations - and the composer re-validates the
// cached narrative against the current sections, dropping any slot that
// no longer holds. Absent object keys from the core stay absent (they
// read as null); corrupt lowPrice, peakPrice and battery objects were
// dropped by the core's own sanitization, never re-added here.
export function serveAdvisoryCard(request, insight) {
  const sections = buildSections(request.facts, request.nowIso);
  const narrative = insight?.narrative ?? null;
  const card = composeAdvisoryCard(
    sections,
    narrative ?? { warning: null, contextNote: null },
    { ...request.facts, nowIso: request.nowIso }
  );
  const payload = { ...card };
  // The day-cheapest window's average (contract section 10, folded in
  // this pass): the core's template predates the field and serves null;
  // the facts layer owns the computed value, so the merge completes the
  // served guidance from it - the card's window phrasing and value chip
  // then match the guidance object's own fields.
  if (payload.guidance != null) {
    payload.guidance = {
      ...payload.guidance,
      day_cheapest_average_eur: request.facts.dayCheapestAverageEur ?? null,
    };
  }
  return {
    ...payload,
    generated_at: insight?.generatedAt ?? null,
    insight_as_of: insight?.asOf ?? null,
    state: insight?.state ?? "error",
    stale: insight?.stale ?? (insight?.state ?? "error") === "reasoning",
    error: insight?.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// The monologue refresh (Stage 4, step 1): per-section generation at
// insight refresh, with the section cache that keeps a stored narrative
// alive while its composition facts are unchanged.
// ---------------------------------------------------------------------------

// Stable hash over a section's composition facts, nowIso excluded: the
// request's moment is injected at serve time and must never trigger a
// regeneration. Sorted keys keep the hash stable across rebuilds.
function compositionFactsHash(facts) {
  const canonical = JSON.stringify(
    Object.entries(facts ?? {})
      .filter(([key]) => key !== "nowIso")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// The section key carried by a monologue section prompt: the prompt
// builder writes "Write the TODAY section of the advisory." and every
// section key is its label lowercased (today, tomorrow, the weekday
// keys). Exported for the insight path's model seam, which wraps raw
// model prose into the narratives shape keyed the same way.
export function monologueSectionKeyFromPrompt(prompt) {
  const match =
    /Write the ([A-Z]+) section of the advisory\./.exec(String(prompt ?? ""));
  const label = match === null ? null : match[1];
  return typeof label === "string" && label !== ""
    ? label.toLowerCase()
    : null;
}

// Regenerates the monologue at insight refresh. cachedSections is the
// previous insight record's monologue section store ({ [key]:
// { facts_hash, narrative } }); a section whose hash is unchanged
// reuses its stored narrative and costs no model call. modelSeam is
// the per-section model seam the tests use: one prompt in, { narratives }
// out. It is called only for sections without a reusable narrative.
// Returns the section store for the new record plus one log entry per
// generated section - label, reason (new-facts, retry or fallback),
// the count of figure-verification rejections from validation, and the
// readable rejection reasons of each rejected attempt.
export async function refreshAdvisoryMonologue(
  request,
  cachedSections,
  modelSeam
) {
  const built = buildSections(request.facts, request.nowIso);
  const monologueSections = buildMonologueSections(
    built,
    request.facts,
    request.nowIso
  );
  const hashes = new Map(
    monologueSections.map((section) => [
      section.key,
      compositionFactsHash(section.facts),
    ])
  );
  const cached = cachedSections ?? null;
  const reuse = new Map();
  for (const section of monologueSections) {
    const entry = cached?.[section.key];
    if (
      entry != null &&
      typeof entry === "object" &&
      entry.facts_hash === hashes.get(section.key)
    ) {
      reuse.set(section.key, entry.narrative ?? null);
    }
  }
  // The stub generateMonologue calls: cached sections replay their
  // stored narrative (re-validated against the live facts), everything
  // else goes to the model seam.
  const stub = async (prompt) => {
    const key = monologueSectionKeyFromPrompt(prompt);
    if (key !== null && reuse.has(key)) {
      const narrative = reuse.get(key);
      return narrative === null ? null : { narratives: { [key]: narrative } };
    }
    return modelSeam(prompt);
  };
  const { payload, sections: report } = await generateMonologue(
    built,
    request.facts,
    request.nowIso,
    stub
  );
  const store = {};
  const log = [];
  for (const [i, entry] of report.entries()) {
    store[entry.key] = {
      facts_hash: hashes.get(entry.key) ?? null,
      narrative: payload[i]?.narrative ?? null,
    };
    if (reuse.has(entry.key)) continue; // reused: no generation this refresh
    const reason = !entry.offered
      ? "fallback"
      : entry.ok
        ? entry.retried
          ? "retry"
          : "new-facts"
        : "fallback";
    const rejections = !entry.offered
      ? 0
      : entry.ok
        ? entry.retried
          ? 1
          : 0
        : 2;
    log.push({
      label: entry.label,
      reason,
      rejections,
      rejected_attempts: Array.isArray(entry.rejected_attempts)
        ? entry.rejected_attempts
        : [],
    });
  }
  return { sections: store, log };
}

// The monologue payload (contract section 4, the Stage 4 monologue
// specification): one entry per section with its label, narrative,
// fallback sentences and facts, served from the insight record's
// stored narratives - never a model call at serve time. The stored
// narrative is re-validated against the live section facts by the same
// pipeline that generated it, so a narrative that no longer holds
// serves the section's deterministic fallback sentences instead.
// nowIso is injected here by the adapter - the core stays pure, the
// request's moment travels as data. Absent keys read as null.
export async function serveAdvisoryMonologue(request, storedSections = null) {
  const built = buildSections(request.facts, request.nowIso);
  const stored = storedSections ?? null;
  const stub = async (prompt) => {
    const key = monologueSectionKeyFromPrompt(prompt);
    const narrative =
      key !== null && stored?.[key] != null && typeof stored[key] === "object"
        ? stored[key].narrative
        : null;
    if (typeof narrative !== "string" || narrative.trim() === "") return null;
    return { narratives: { [key]: narrative } };
  };
  const { payload } = await generateMonologue(
    built,
    request.facts,
    request.nowIso,
    stub
  );
  return (Array.isArray(payload) ? payload : []).map((section) => ({
    label: section?.label ?? null,
    narrative: section?.narrative ?? null,
    fallback_sentences: section?.fallback_sentences ?? null,
    facts: { ...(section?.facts ?? {}), nowIso: request.nowIso },
  }));
}

// The summary API's advisory fields: the served insight card always,
// the monologue only while the switch is on. The monologue comes from
// the insight record's stored sections; with the switch off the field
// is absent and the payload is identical to today's.
export async function serveSummaryAdvisory(request, insight) {
  const fields = { insight: serveAdvisoryCard(request, insight) };
  if (ADVISORY_MONOLOGUE_ENABLED) {
    fields.monologue = await serveAdvisoryMonologue(
      request,
      insight?.monologue?.sections ?? null
    );
  }
  return fields;
}
