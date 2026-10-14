import { Sparkles, TriangleAlert } from "lucide-react"
import type { SummaryInsight as SummaryInsightData } from "@/lib/api"
import {
  buildAdvisoryContent,
  type AdvisoryCardRow,
} from "@/lib/advisoryRows"
import { humanEur, humanizeEurInText } from "@/lib/advisoryText"

// One shared glass definition for the whole advisory surface: 15
// percent translucent white, white text and a soft backdrop blur. The
// rows carry the subtle translucent white border; the chips render
// borderless on top of them. Defined once, never per instance.
const GLASS_SURFACE =
  "border border-white/20 bg-white/15 text-white backdrop-blur-sm"
// The structured advisory rows: a column block whose day chip sits on
// its own line above the main text, like the compact widgets'
// label-above-content pattern, so every row's text starts on one
// vertical line.
const GLASS_BLOCK = `flex flex-col gap-1.5 rounded-xl p-3 ${GLASS_SURFACE}`
const GLASS_CHIP = "rounded-full bg-white/15 text-white backdrop-blur-sm"

// The notes zone's fine print: the horizon and context notes below the
// rows - smaller text, the card's muted register, slightly more line
// spacing. Plain text, never glass, never chips.
const NOTE_TEXT = "text-[11px] leading-loose text-white/60"

// One generic glass-row renderer: every content row maps through the
// same eyebrow pattern (day chip left, value chip right), one lead
// sentence and its supporting lines. The hierarchy lives in the data,
// not in per-row markup.
function AdvisoryRowView({ row }: { row: AdvisoryCardRow }) {
  return (
    <div className={GLASS_BLOCK}>
      <div className="flex items-center justify-between gap-2">
        <span
          className={`whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
        >
          {row.chip}
        </span>
        {row.valueChip !== null && (
          <span
            className={`shrink-0 px-2.5 py-1 text-xs tabular-nums ${GLASS_CHIP}`}
          >
            {row.valueChip}
          </span>
        )}
      </div>
      <p className="text-sm font-medium leading-snug">{row.sentence}</p>
      {row.supporting.map((line, index) => (
        <p
          key={index}
          className={
            line.tabular
              ? "text-xs leading-relaxed tabular-nums"
              : "text-xs leading-relaxed"
          }
        >
          {line.text}
        </p>
      ))}
      {row.footer?.kind === "confidence" && (
        <p className="text-[10px] font-medium uppercase tracking-wide">
          {row.footer.label} confidence
        </p>
      )}
      {row.footer?.kind === "note" && (
        <p className="text-xs leading-relaxed">{row.footer.text}</p>
      )}
    </div>
  )
}

// Daily AI advisory at the top of the page: the structured decision
// payload (the only insight format) rendered as data-driven glass rows
// - the action, guidance, advisory and outlook rows - with the warning
// as the amber exception and the notes zone as the card's fine print.
// The data is owned by the page, which refreshes it on the 5-minute
// panel cycle; the "insight from" stamp and the force-refresh control
// live in the page header. While the server regenerates the insight,
// the Reasoning chip pulses next to the header and the previous
// content stays fully visible underneath.
function SummaryInsight({
  insight,
  loading,
}: {
  insight: SummaryInsightData | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div
        className="h-full min-h-36 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }

  // The structured decision payload is the only insight format; no
  // primary action means no card.
  if (!insight?.primary_action) {
    return null
  }

  const content = buildAdvisoryContent(insight)

  return (
    // The blue-gradient AI panel is the whole widget; the gradient is
    // the visual identity of AI content - the same from-blue-800 to
    // sky-600 pair (blue-950 to sky-800 at night) every AI box uses.
    // It stretches to the full grid row so it matches the height of
    // the stats column next to it.
    <div className="h-full rounded-lg bg-gradient-to-br from-blue-800 to-sky-600 p-4 text-white shadow-card dark:from-blue-950 dark:to-sky-800">
      <p className="flex items-center gap-2 font-heading text-base font-medium">
        <Sparkles className="size-5" aria-hidden="true" />
        AI advisory
        {insight.state === "reasoning" && (
          // The regeneration signal: the chip pulses while the server
          // rebuilds the insight for the new context signature, in the
          // same glass register as the row chips, legible on the blue
          // gradient in both themes. The previous content stays fully
          // visible underneath.
          <span
            className={`ml-auto flex animate-pulse items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
          >
            <Sparkles className="size-3" aria-hidden="true" />
            Reasoning
          </span>
        )}
      </p>
      <div className="mt-2 space-y-2">
        {content.rows.map((row, index) => (
          <AdvisoryRowView key={`${row.chip}-${index}`} row={row} />
        ))}
        {content.largestOpportunity && (
          <p className="text-xs text-white">
            largest opportunity today: {content.largestOpportunity.label},{" "}
            {humanEur(content.largestOpportunity.savingEur)}
          </p>
        )}
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
      {(content.showOutlookNote || content.contextNote !== null) && (
        // The notes zone: the card's fine print below a hairline
        // separator between the rows and the notes. The horizon note
        // and the context note (quiet days only) share one muted
        // register - plain text, no glass, no chips.
        <div className="mt-2 space-y-1.5 border-t border-white/15 pt-2">
          {content.showOutlookNote && (
            <p className={NOTE_TEXT}>
              Beyond tomorrow, grid prices are not yet published; there
              the solar forecast is the deciding signal.
            </p>
          )}
          {content.contextNote !== null && (
            <p className={NOTE_TEXT}>
              {humanizeEurInText(content.contextNote)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default SummaryInsight
