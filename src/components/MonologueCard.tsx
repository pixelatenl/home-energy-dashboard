import { RefreshCw, Sparkles } from "lucide-react";
import AdvisoryDayChip from "@/components/AdvisoryDayChip";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Skeleton } from "@/components/ui/skeleton";
import type { SummaryMonologueSection } from "@/lib/api";
import {
  GLASS_BLOCK,
  GLASS_CHIP,
  PROVENANCE_CHIP,
} from "@/lib/advisorySurface";

// The advisory area (contract section 4, Stage 4): the /api/summary
// payload's monologue sections as the dashboard's one and only
// advisory surface (the owner decision of 22 October: the legacy
// advisory card retired, the monologue area took its name and its
// regenerate control). The area header follows the retired card's
// own pattern - the panel title with its sparkle, the Reasoning
// chip while the server regenerates the insight, the
// "Insight from HH:MM" stamp and the force-refresh button - then
// one card per section in served order, each in the same glass
// block chrome with the served day label as the glass chip at the
// top-left and the narrative (or the deterministic fallback
// sentences) as one flowing paragraph beneath it. No row titles,
// no muted notes, no confidence: the composition is the server's,
// and the card only presents it. The facts object rides the payload
// for grounding and is never rendered.
// The area is strictly optional: with the monologue field absent,
// null or empty it renders nothing and the dashboard is identical
// to the advisory-free layout. Until the first payload arrives the
// area renders its first-paint skeleton in the loaded area's exact
// grid position, so the advisory column never moves.

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

// One advisory section: its own card, in the advisory area's glass
// block chrome - the served day label as the glass chip at the
// top-left (never recomputed or localized on the client), the body
// as a single flowing paragraph in the advisory body-text register
// beneath it. A malformed section object renders whatever it
// honestly has - chip alone, body alone - and a section with
// nothing to show renders no card at all; nothing throws.
function MonologueSectionView({
  section,
}: {
  section: SummaryMonologueSection;
}) {
  const label = isText(section?.label) ? section.label : null;
  const body = sectionBody(section);
  if (label === null && body === "") return null;
  return (
    <div className={GLASS_BLOCK}>
      {label !== null && <AdvisoryDayChip label={label} />}
      {body !== "" && <p className="text-sm leading-snug">{body}</p>}
    </div>
  );
}

// The advisory area: the warm brown AI surface (the same dark-to-
// warm-brown ramp every AI box uses, over the app-wide glass pane),
// stretching the full grid row like the retired card did, with the
// header's title and right cluster - the Reasoning chip while the
// insight regenerates, the insight timestamp and the force-refresh
// control - above the served sections in exactly the array order.
// The insight metadata (state and insight_as_of) and the shared AI
// budget are owned by the page, the same values the retired card
// rendered from.
function MonologueCard({
  sections,
  reasoning,
  from,
  refreshDisabled,
  onRefresh,
  loading,
}: {
  // The sections as served by /api/summary, in payload order; null,
  // undefined or an empty array renders nothing at all.
  sections: SummaryMonologueSection[] | null | undefined;
  // True while the server regenerates the insight: the Reasoning
  // chip pulses while the previous content stays fully visible.
  reasoning: boolean;
  // The insight's as-of time as a formatted HH:MM label, or null
  // before the first insight.
  from: string | null;
  // The force-refresh button stays the dashboard's one manual
  // regenerate control; only the shared AI budget can disable it.
  refreshDisabled: boolean;
  onRefresh: () => void;
  // True only until the first /api/summary payload lands: the
  // first-paint placeholder owns the area meanwhile, so the
  // advisory column holds its final position from the very first
  // paint. Refreshes keep the previous content visible instead.
  loading: boolean;
}) {
  // The defensive boundary: only real objects reach the render, so
  // a malformed payload shapes the area instead of crashing it.
  const safeSections = Array.isArray(sections)
    ? sections.filter(
        (section): section is SummaryMonologueSection =>
          section !== null && typeof section === "object"
      )
    : [];

  const refreshTitle = refreshDisabled
    ? "Daily AI budget exhausted; the insight refreshes tomorrow"
    : "Regenerate all AI insights and refresh widget data now";

  // The first-paint placeholder: the same warm brown AI panel in
  // skeleton form, in exactly the grid position and shape the loaded
  // area occupies - the panel title on the header row (the
  // provenance chip and refresh control appear with the content, as
  // the retired card's own skeleton did), then five glass-block
  // placeholders in the loaded per-section cards' own stacked rhythm
  // and surface. The shell itself does not pulse; only the shared
  // Skeleton lines inside it do.
  const skeleton = (
    <div
      className="glass-card glass-inset h-full min-h-36 rounded-lg bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 text-card-foreground shadow-card"
      aria-busy="true"
    >
      <p className="flex items-center gap-2 font-heading text-lg font-medium text-muted-foreground">
        <Sparkles className="size-6" aria-hidden="true" />
        AI advisory
      </p>
      <div className="mt-2 space-y-2">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className={GLASS_BLOCK}>
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );

  // The loaded area: nothing at all once the payload carries no
  // sections - the absent-field dashboard is advisory-free, as today.
  const loaded =
    safeSections.length === 0 ? null : (
      <div className="glass-card glass-inset h-full rounded-lg bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 text-card-foreground shadow-card">
      {/* The header follows the retired advisory card's own pattern:
          the panel title with its sparkle, the Reasoning chip pulsing
          while the server rebuilds the insight, the provenance stamp
          and the force-refresh control in the right cluster - the
          regenerate path stays reachable from the advisory area
          itself. */}
      <p className="flex items-center gap-2 font-heading text-lg font-medium text-muted-foreground">
        <Sparkles className="size-6" aria-hidden="true" />
        AI advisory
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
          <button
            type="button"
            aria-label="Refresh dashboard"
            title={refreshTitle}
            disabled={refreshDisabled}
            onClick={onRefresh}
            className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      </p>
      {/* The sections render in the retired card's own rhythm: the
          same stacked spacing, one glass block per section in served
          order - the day chip at the top-left, the narrative beneath
          - so the advisory area keeps the design language the
          dashboard already had. */}
      <div className="mt-2 space-y-2">
        {safeSections.map((section, index) => (
          <MonologueSectionView key={index} section={section} />
        ))}
      </div>
      </div>
    );

  // The stable swap: the skeleton and the loaded area occupy the same
  // grid cell and cross-fade inside it, so no element on the page
  // moves between the loading and loaded states. With the monologue
  // field absent the loaded area is nothing, and the fade lands on
  // the advisory-free dashboard, as today.
  return (
    <SkeletonReveal loading={loading} skeleton={skeleton}>
      {loaded}
    </SkeletonReveal>
  );
}

export default MonologueCard;
