// The advisory core adapter (Stage 3a): the seam between the existing
// summary insight path and the copied advisory core in server/advisory/.
// The switch, the style brief, the facts preparation and the transport
// merge live here; the core files stay pure (no environment access, no
// clock reads) and the legacy path stays byte-for-byte in place for the
// switch-off state. Contract sections 3 to 5 are the wording source for
// the brief and the merge rules.

import {
  buildAdvisoryModelContext,
  buildSections,
  composeAdvisoryCard,
} from "./advisory/advisory-core.mjs";
import { buildAdvisoryFacts } from "./facts.mjs";
import { localIsoWithOffset } from "./time.mjs";

// The Stage 3a switch, default off: with EMS_ADVISORY_CORE unset the
// summary insight path behaves exactly as today. This module and the
// index layer are the only places the advisory core's environment is
// read.
export function advisoryCoreEnabled() {
  const raw = (process.env.EMS_ADVISORY_CORE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

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
// view while the switch is on.
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
// never go stale between generations - the same liveness the legacy
// path's live extras provide - and the composer re-validates the cached
// narrative against the current sections, dropping any slot that no
// longer holds. Absent object keys from the core stay absent (they read
// as null); corrupt lowPrice, peakPrice and battery objects were
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
  // then match the guidance the legacy path serves.
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
