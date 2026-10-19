import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Skeleton } from "@/components/ui/skeleton";
import type { SummaryInsight as SummaryInsightData } from "@/lib/api";
import {
  buildAdvisoryContent,
  type AdvisoryDayCard,
  type AdvisoryItem,
} from "@/lib/advisoryRows";

// The advisory day cards render in the stat cards' own surface: the
// app-wide glass pane (the .glass-card blur, saturation and edge
// seams), the 0.06 token fill, the card elevation and the token
// rounding - the same recipe as every Card in the app, defined
// once, never per instance. The chips keep the pill register on
// top of them.
const CARD_SURFACE =
  "glass-card glass-inset rounded-inset bg-card text-muted-foreground shadow-card";
// The structured advisory rows: a column block whose day chip sits on
// its own line above the main text, like the compact widgets'
// label-above-content pattern, so every row's text starts on one
// vertical line.
const GLASS_BLOCK = `flex flex-col gap-1.5 p-3 ${CARD_SURFACE}`;
const GLASS_CHIP =
  "rounded-full bg-white/15 text-chip-foreground backdrop-blur-sm";

// The provenance chip and refresh control in the panel's header
// right cluster: the "Insight from HH:MM" stamp (or the honest
// absence) and the force-refresh button, in the panel's own glass
// register so they read as the card's furniture.
const PROVENANCE_CHIP =
  "flex shrink-0 items-center rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-xs font-medium text-chip-foreground tabular-nums backdrop-blur-sm";

// The header's right cluster shared by every render branch: the
// Reasoning chip while the server regenerates, then the provenance
// chip and the refresh control.
function HeaderCluster({
  from,
  reasoning,
  refreshDisabled,
  refreshTitle,
  onRefresh,
}: {
  from: string | null;
  reasoning: boolean;
  refreshDisabled: boolean;
  refreshTitle: string;
  onRefresh: () => void;
}) {
  return (
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
  );
}

// The notes zone's fine print: the horizon and context notes below the
// rows - smaller text, the card's quietest register, slightly more line
// spacing. Plain text, never glass, never chips.
const NOTE_TEXT = "text-[11px] leading-loose text-subtle-foreground";

// One piece of advice inside a day card: the lead sentence with its
// right-side value chip, its supporting lines and optional trailing
// furniture. One style for every item - the hierarchy lives in the
// data, not in per-item markup.
// One piece of advice inside a day card: the lead sentence with its
// right-side value chip, its supporting lines and optional trailing
// furniture. The item's own register carries the hierarchy: imperative
// advice (an action, a command) sets its title in the medium weight;
// guidance-class items (plain facts, planning notes) render their
// titles at the normal weight, a step softer, so the card's commands
// stand out from its context.
function AdvisoryItemView({ item }: { item: AdvisoryItem }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p
          className={`min-w-0 flex-1 text-sm leading-snug ${
            item.muted ? "font-normal" : "font-medium"
          }`}
        >
          {item.sentence}
        </p>
        {item.valueChip !== null && (
          <span
            className={`shrink-0 px-2.5 py-1 text-xs tabular-nums ${GLASS_CHIP}`}
          >
            {item.valueChip}
          </span>
        )}
      </div>
      {item.supporting.map((line, index) => (
        // The supporting lines sit one step below their title - the
        // same quiet register as the rest of the card's regular
        // text, so the small text reads as explanation, not as a
        // second command.
        <p
          key={index}
          className={
            line.tabular
              ? "text-xs leading-relaxed tabular-nums text-muted-foreground"
              : "text-xs leading-relaxed text-muted-foreground"
          }
        >
          {line.text}
        </p>
      ))}
      {item.footer?.kind === "confidence" && (
        <p className="text-[10px] font-medium uppercase tracking-wide text-subtle-foreground">
          {item.footer.label} confidence
        </p>
      )}
      {item.footer?.kind === "note" && (
        <p className="text-xs leading-relaxed">{item.footer.text}</p>
      )}
    </div>
  );
}

// One day of the advisory timeline: every piece of advice for that
// day grouped inside a single glass block, the day chip on its own
// line above the day's items. The hierarchy is explicit: each item is
// one advice unit - its bold lead sentence with its smaller
// supporting lines tightly attached beneath it (the supporting text
// always belongs to the title above it, never to the item below) -
// and the units are separated by hairline dividers, so a day with
// several items reads as distinct pieces of advice rather than one
// blended block.
function AdvisoryDayCardView({ card }: { card: AdvisoryDayCard }) {
  return (
    <div className={GLASS_BLOCK}>
      <span
        className={`w-fit whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
      >
        {card.chip}
      </span>
      <div className="divide-y divide-white/15">
        {card.items.map((item, index) => (
          <div key={index} className="py-2 first:pt-0 last:pb-0">
            <AdvisoryItemView item={item} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Daily AI advisory at the top of the page: the structured decision
// payload (the only insight format) rendered as data-driven glass day
// cards - every piece of advice for one day grouped inside its single
// card, in calendar order - with the warning as the amber exception
// and the notes zone as the card's fine print.
// The data is owned by the page, which refreshes it on the 5-minute
// panel cycle; the "insight from" stamp and the force-refresh control
// live in the card's own header, so they stay with the AI content.
// While the server regenerates the insight, the Reasoning chip pulses
// next to the header and the previous content stays fully visible
// underneath.
function SummaryInsight({
  insight,
  loading,
  from,
  refreshDisabled,
  onRefresh,
}: {
  insight: SummaryInsightData | null;
  loading: boolean;
  // The insight's as-of time as a formatted HH:MM label, or null
  // before the first insight.
  from: string | null;
  refreshDisabled: boolean;
  onRefresh: () => void;
}) {
  const refreshTitle = refreshDisabled
    ? "Daily AI budget exhausted; the insight refreshes tomorrow"
    : "Regenerate all AI insights and refresh widget data now";
  // The first-paint placeholder: the same warm brown AI panel in
  // skeleton form - header plus two glass rows - so the kiosk shows
  // the panel's shape immediately. This covers the one moment the
  // panel can lag behind the widgets: the first /api/summary call
  // also waits for the server to generate the insight. Refreshes
  // keep the previous content visible instead, so this only ever
  // renders before the first insight arrives. The shell itself does
  // not pulse; only the shared Skeleton lines inside it do.
  const skeleton = (
    <div
      className="glass-card glass-inset h-full min-h-36 rounded-lg bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 text-card-foreground shadow-card"
      aria-busy="true"
    >
      {/* The header row during loading carries only the panel title:
          the provenance chip and refresh control appear with the
          content, once the loading has completed. */}
      <p className="flex items-center gap-2 font-heading text-lg font-medium text-muted-foreground">
        <Sparkles className="size-6" aria-hidden="true" />
        AI advisory
      </p>
      <div className="mt-2 space-y-2">
        {[0, 1].map((index) => (
          <div key={index} className={GLASS_BLOCK}>
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );

  // The structured decision payload is the only insight format; no
  // primary action means no advice rows, but the panel keeps its
  // header with the provenance chip and refresh control so the
  // regenerate path stays reachable.
  if (!insight?.primary_action) {
    return (
      <SkeletonReveal loading={loading} skeleton={skeleton}>
        <div className="glass-card glass-inset h-full min-h-36 rounded-lg bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 text-card-foreground shadow-card">
          <p className="flex items-center gap-2 font-heading text-lg font-medium text-muted-foreground">
            <Sparkles className="size-6" aria-hidden="true" />
            AI advisory
            <HeaderCluster
              from={from}
              reasoning={false}
              refreshDisabled={refreshDisabled}
              refreshTitle={refreshTitle}
              onRefresh={onRefresh}
            />
          </p>
          <p className="mt-2 text-sm text-white/60">No advice right now.</p>
        </div>
      </SkeletonReveal>
    );
  }

  const content = buildAdvisoryContent(insight);

  return (
    <SkeletonReveal loading={loading} skeleton={skeleton}>
      {/* The warm brown AI panel is the whole widget, in the stat
          cards' own shape - the glass pane (blur, saturation, edge
          seams), the token rounding, the card elevation, no border -
          with the gradient kept as the AI content's visual identity:
          the same dark-to-warm-brown ramp as the page body (dark at
          the top right, the body's lighter brown at the lower left)
          every AI box uses. It stretches to the full grid row so it
          matches the height of the stats column next to it. */}
      <div className="glass-card glass-inset h-full rounded-lg bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 text-card-foreground shadow-card">
        <p className="flex items-center gap-2 font-heading text-lg font-medium text-muted-foreground">
          <Sparkles className="size-6" aria-hidden="true" />
          AI advisory
          {/* The regeneration signal rides in the same right cluster:
            the chip pulses while the server rebuilds the insight for
            the new context signature, in the same glass register as
            the row chips, legible on the brown gradient in both
            themes. The previous content stays fully visible
            underneath. */}
          <HeaderCluster
            from={from}
            reasoning={insight.state === "reasoning"}
            refreshDisabled={refreshDisabled}
            refreshTitle={refreshTitle}
            onRefresh={onRefresh}
          />
        </p>
        <div className="mt-2 space-y-2">
          {content.cards.map((card, index) => (
            <AdvisoryDayCardView key={`${card.chip}-${index}`} card={card} />
          ))}
          {insight.warning && (
            // The amber exception: only something that needs attention.
            <p className="flex items-start gap-2 text-sm font-medium leading-relaxed text-amber-300 dark:text-amber-200">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">{insight.warning}</span>
            </p>
          )}
        </div>
        {(insight.priceSentence ||
          insight.batterySentence ||
          content.showOutlookNote) && (
          // The notes zone: the card's fine print below a hairline
          // separator between the day cards and the note - plain text,
          // no glass, no chips. The quiet-day context explaining lives
          // on the Today card instead, in the same register as the
          // other advice. The price and battery fact sentences are
          // consumed verbatim as the server composed them - the model
          // never writes them - and each stays absent when its data
          // is missing.
          <div className="mt-2 space-y-1.5 border-t border-white/15 pt-2">
            {insight.priceSentence ? (
              <p className={NOTE_TEXT}>{insight.priceSentence}</p>
            ) : null}
            {insight.batterySentence ? (
              <p className={NOTE_TEXT}>{insight.batterySentence}</p>
            ) : null}
            {content.showOutlookNote && (
              <p className={NOTE_TEXT}>
                Beyond tomorrow, grid prices are not yet published; there the
                solar forecast is the deciding signal.
              </p>
            )}
          </div>
        )}
      </div>
    </SkeletonReveal>
  );
}

export default SummaryInsight;
