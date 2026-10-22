import { Sparkles } from "lucide-react";
import AdvisoryDayChip from "@/components/AdvisoryDayChip";
import type { SummaryMonologueSection } from "@/lib/api";

// The advisory monologue card (contract section 4, Stage 4): the same
// /api/summary payload the advisory card reads, rendered as prose
// framed exactly like the advisory card's day cards - each section's
// served day label as the same glass chip the advisory card uses,
// the narrative (or the deterministic fallback sentences) as one
// flowing paragraph beneath it, and hairline dividers between the
// sections (the owner decision of 22 October: visual parity with the
// legacy card's section framing, superseding the earlier no-chips
// rule). No row titles, no muted notes, no confidence: the
// composition is the server's, and the card only presents it. The
// facts object rides the payload for grounding and is never rendered.
// The header keeps the advisory panel's own furniture: the
// Reasoning chip while the server regenerates the insight and the
// "Insight from HH:MM" stamp, both from the same insight metadata
// the advisory card uses - no separate fetch, poll or refresh of
// its own.
// The card is strictly optional: with the monologue field absent,
// null or empty it renders nothing and the dashboard is identical
// to the pre-monologue layout.

// The glass chip register the advisory panel's header chips share,
// kept identical here so the two panels read as one family.
const GLASS_CHIP =
  "rounded-full bg-white/15 text-chip-foreground backdrop-blur-sm";
// The provenance chip in the header's right cluster: the same
// "Insight from HH:MM" stamp (or the honest absence) the advisory
// card carries, in the panel's own glass register.
const PROVENANCE_CHIP =
  "flex shrink-0 items-center rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-xs font-medium text-chip-foreground tabular-nums backdrop-blur-sm";
// The sections' glass block: the same surface the advisory card's
// day cards render in - the app-wide glass pane, the token fill and
// rounding, the card elevation - so the monologue's sections sit on
// the identical chrome the legacy card's days sit on.
const CARD_SURFACE =
  "glass-card glass-inset rounded-inset bg-card text-muted-foreground shadow-card";
const GLASS_BLOCK = `flex flex-col gap-1.5 p-3 ${CARD_SURFACE}`;

// A served string: non-null text with something in it. Guards the
// boundary between the API payload and the render - a malformed
// section never reaches JSX with a value it cannot display.
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// One section's body text: the narrative when the model's prose
// validated, otherwise the deterministic fallback sentences joined
// into one flowing paragraph. Missing both renders as an empty body.
function sectionBody(section: SummaryMonologueSection): string {
  if (isText(section?.narrative)) return section.narrative;
  if (Array.isArray(section?.fallback_sentences)) {
    return section.fallback_sentences.filter(isText).join(" ");
  }
  return "";
}

// One monologue section: the served day label as the advisory
// card's own glass chip (never recomputed or localized on the
// client), the body as a single flowing paragraph in the advisory
// card's body-text register beneath it. A malformed section object
// renders whatever it honestly has - chip alone, body alone, or
// nothing - and never throws.
function MonologueSectionView({
  section,
}: {
  section: SummaryMonologueSection;
}) {
  const label = isText(section?.label) ? section.label : null;
  const body = sectionBody(section);
  return (
    <div className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0">
      {label !== null && <AdvisoryDayChip label={label} />}
      {body !== "" && (
        <p className="text-sm leading-snug">{body}</p>
      )}
    </div>
  );
}

// The monologue panel: the warm brown AI surface (the same dark-to-
// warm-brown ramp every AI box uses, over the app-wide glass pane)
// with the header's title and right cluster - the Reasoning chip
// while the insight regenerates and the insight timestamp - above
// the served sections in exactly the array order. The insight
// metadata (state and insight_as_of) is owned by the page, the
// same values the advisory card renders from.
function MonologueCard({
  sections,
  reasoning,
  from,
}: {
  // The sections as served by /api/summary, in payload order; null,
  // undefined or an empty array renders nothing at all.
  sections: SummaryMonologueSection[] | null | undefined;
  // True while the server regenerates the insight: the same state
  // the advisory card's Reasoning chip shows.
  reasoning: boolean;
  // The insight's as-of time as a formatted HH:MM label, or null
  // before the first insight.
  from: string | null;
}) {
  // The defensive boundary: only real objects reach the render, so
  // a malformed payload shapes the card instead of crashing it.
  const safeSections = Array.isArray(sections)
    ? sections.filter(
        (section): section is SummaryMonologueSection =>
          section !== null && typeof section === "object"
      )
    : [];
  if (safeSections.length === 0) return null;

  return (
    <div className="glass-card glass-inset rounded-lg bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 text-card-foreground shadow-card">
      {/* The header follows the advisory panel's own pattern: the
          panel title with its sparkle, the Reasoning chip pulsing
          while the server rebuilds the insight and the provenance
          stamp beside it - the refresh control stays with the
          advisory card below, which owns it. */}
      <p className="flex items-center gap-2 font-heading text-lg font-medium text-muted-foreground">
        <Sparkles className="size-6" aria-hidden="true" />
        AI monologue
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {reasoning && (
            <span
              className={`flex animate-pulse items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
            >
              <Sparkles className="size-3" aria-hidden="true" />
              Reasoning
            </span>
          )}
          <span className={PROVENANCE_CHIP}>
            {from ? `Insight from ${from}` : "No insight yet"}
          </span>
        </span>
      </p>
      {/* The sections render in the advisory card's own framing: one
          glass block in the stat cards' surface, every section
          separated by the same hairline divider the advisory card
          draws between its advice units, the day chip on its own
          line above its narrative - so the monologue reads as the
          same design language as the legacy card below it. */}
      <div className="mt-2">
        <div className={GLASS_BLOCK}>
          <div className="divide-y divide-white/15">
            {safeSections.map((section, index) => (
              <MonologueSectionView key={index} section={section} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MonologueCard;
