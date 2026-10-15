import { House, Info, PlugZap, Recycle } from "lucide-react"
import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { GridScore, GridScoreState } from "@/lib/api"
import { useSummary } from "@/lib/useSummary"

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

function formatPct(value: number | null): string {
  return value === null ? "\u2014" : `${Math.round(value)}%`
}

const PLACEHOLDER = "\u2014"

// The grid card's tooltip: the net figure's meaning plus the
// renewables strip's. The color state thresholds are our own
// interpretation; Zonneplan publishes none.
const GRID_TOOLTIP =
  "Grid electricity today: imported minus exported; negative means net export. The strip shows how much of the grid's power comes from sun and wind right now, estimated by Zonneplan; the line is the next hours. The color states are our own interpretation, not Zonneplan's."

const USAGE_TOOLTIP =
  "Household consumption: from grid + direct solar use - export - energy stored in the battery. Self-consumption: the share of today's solar production that was used on site."

// Corner info tooltip: shows on hover, keyboard focus and tap.
function InfoTooltip({ text }: { text: string }) {
  return (
    <button
      type="button"
      aria-label={text}
      className="group relative rounded-full text-muted-foreground outline-none"
    >
      <Info className="size-3.5" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border bg-popover p-2 text-left text-xs leading-relaxed text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus:opacity-100"
      >
        {text}
      </span>
    </button>
  )
}

// The three state glyphs of the grid renewables share, one per
// server-computed color state: leaf (fully renewable grid), pylon
// with a sun disc (mixed grid), factory with a chimney (fossil
// dominance). All three share the same stroke style and 24 px box so
// the state swap causes no layout shift, and all render equally
// muted (currentColor at muted opacity): the share is secondary
// context inside the grid card.
const GLYPH_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "size-6 shrink-0 text-muted-foreground",
  "aria-hidden": true,
} as const

function GridScoreGlyph({ state }: { state: GridScoreState }) {
  if (state === "green") {
    return (
      <svg {...GLYPH_PROPS}>
        <path d="M20 4c0 8.5-4.9 14-10.8 14A5.2 5.2 0 0 1 4 12.8C4 7.6 10.6 4 20 4z" />
        <path d="M4.5 19.5C8.5 14.5 12.5 10.5 16.5 7.5" />
      </svg>
    )
  }
  if (state === "yellow") {
    return (
      <svg {...GLYPH_PROPS}>
        <path d="M9.5 21 12 7.5l2.5 13.5" />
        <path d="M9.8 16.5h4.4" />
        <path d="M10.5 12.5h3" />
        <circle cx="18" cy="6" r="2.5" />
        <path d="M18 1.5v1.3" />
        <path d="M22.5 6h-1.3" />
      </svg>
    )
  }
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M3.5 21h17" />
      <path d="M5.5 21v-8.5h7.5V21" />
      <path d="M13 21v-6l4.5-2.5V21" />
      <path d="M7 12.5V7h2.5v5.5" />
    </svg>
  )
}

// The grid card's live strip: how green the utility's power is right
// now - the state glyph and the share as the strip's headline row,
// the server-rendered movement clause beneath - in the same stacked
// setup as the home usage card's self-consumption strip. Both strips
// anchor to the card's base (mt-auto), so the hairlines sit level
// across the two cards however many figure lines sit above them. The
// share's color state thresholds are our own interpretation;
// Zonneplan publishes none.
function SustainabilityStrip({ score }: { score: GridScore | null }) {
  const share =
    score?.current == null ? PLACEHOLDER : `${Math.round(score.current)}%`
  return (
    <div className="mt-auto border-t pt-2">
      <p className="flex items-center gap-2">
        {score?.state && <GridScoreGlyph state={score.state} />}
        <span
          className={`text-2xl font-semibold tabular-nums ${
            score?.current == null ? "text-muted-foreground" : ""
          }`}
        >
          {share}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        Current renewable grid power
        {score?.sub ? `, ${score.sub}` : ""}
      </p>
    </div>
  )
}

// The two headline metric cards: From the grid (net of import and
// export, with the in/out split as its sub-caption and the live
// grid renewables share as its strip) and Home usage (household
// consumption with today's self-consumption share as its
// sub-caption). Today's value is large, this week and this month
// smaller beneath. Missing data shows a muted dash. The battery and
// solar live in their own compact widgets beside these. Rendered as
// a bare fragment: TodayPage lays the cards into one shared
// top-widget grid, so every widget shares one height.
function StatsHeader() {
  const { summary, status } = useSummary()

  // Grid net: import minus export; negative means net export.
  const netKwh = (range: {
    import_kwh: number
    export_kwh: number
  }) => range.import_kwh - range.export_kwh

  const gridScore = summary?.grid_score ?? null
  const usageToday = summary?.today.total_usage_kwh ?? null
  const selfConsumption = summary?.today.self_consumption_pct ?? null

  if (status === "loading") {
    return (
      <>
        {[0, 1].map((index) => (
          <div
            key={index}
            className="min-h-32 animate-pulse rounded-lg bg-muted"
            aria-hidden="true"
          />
        ))}
      </>
    )
  }

  return (
    <>
      {/* From the grid: the household's grid figures plus the utility
          greenness, which belongs here - the grid power being measured
          is the same power the renewables share describes. */}
      <Card className="relative min-h-32">
        <div className="absolute right-3 top-3">
          <InfoTooltip text={GRID_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch">
          <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
            <PlugZap className="size-5 shrink-0" aria-hidden="true" />
            From the grid
          </CardTitle>
          <CardTitle
            className={`text-[2.5rem] tabular-nums ${
              summary === null ? "text-muted-foreground" : ""
            }`}
          >
            {summary === null
              ? PLACEHOLDER
              : formatKwh(netKwh(summary.today))}
          </CardTitle>
          {summary !== null && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {summary.today.import_kwh.toFixed(1)} kWh in,{" "}
              {summary.today.export_kwh.toFixed(1)} kWh out
            </p>
          )}
          <p className="pb-2 text-xs text-muted-foreground tabular-nums">
            This week {summary === null ? PLACEHOLDER : formatKwh(netKwh(summary.week))}{" "}
            &middot; This month{" "}
            {summary === null ? PLACEHOLDER : formatKwh(netKwh(summary.month))}
          </p>
          <SustainabilityStrip score={gridScore} />
        </CardHeader>
      </Card>

      {/* Home usage: the household's consumption with its solar
          self-consumption share - both describe what the home did with
          its energy today. */}
      <Card className="relative min-h-32">
        <div className="absolute right-3 top-3">
          <InfoTooltip text={USAGE_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch">
          <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
            <House className="size-5 shrink-0" aria-hidden="true" />
            Home usage
            {summary !== null && !summary.pv_available && (
              <span
                className="italic"
                title="No PV entity found; home usage is grid import only"
              >
                {" "}(excl. solar)
              </span>
            )}
          </CardTitle>
          <CardTitle
            className={`text-[2.5rem] tabular-nums ${
              usageToday === null ? "text-muted-foreground" : ""
            }`}
          >
            {formatKwh(usageToday)}
          </CardTitle>
          <p className="pb-2 text-xs text-muted-foreground tabular-nums">
            This week{" "}
            {formatKwh(summary?.week.total_usage_kwh ?? null)} &middot; This
            month {formatKwh(summary?.month.total_usage_kwh ?? null)}
          </p>
          {/* The self-consumption strip: the share of today's solar
              production the home used on site - its own space beneath a
              hairline, the recycle glyph and the percentage as the
              strip's headline row, the description beneath, so it reads
              as the card's second figure, not fine print. */}
          <div className="mt-auto border-t pt-2">
            <p className="flex items-center gap-2">
              <Recycle
                className="size-6 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span
                className={`text-2xl font-semibold tabular-nums ${
                  selfConsumption === null ? "text-muted-foreground" : ""
                }`}
              >
                {formatPct(selfConsumption)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              of today&rsquo;s solar used for home
            </p>
          </div>
        </CardHeader>
      </Card>
    </>
  )
}

export default StatsHeader
