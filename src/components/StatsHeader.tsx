import { Info } from "lucide-react"
import type { ReactNode } from "react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { GridScoreHour, GridScoreState } from "@/lib/api"
import { useSummary } from "@/lib/useSummary"

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

function formatPct(value: number | null): string {
  return value === null ? "\u2014" : `${Math.round(value)}%`
}

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

// The three state glyphs of the Energy sustainability stat, one per
// server-computed color state: leaf (fully renewable grid), pylon
// with a sun disc (mixed grid), factory with a chimney (fossil
// dominance). All three share the same stroke style and 16 px box so
// the state swap causes no layout shift, and all render equally
// muted (currentColor at muted opacity): the stat is secondary
// context next to the household stats.
const GLYPH_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "size-4 shrink-0",
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

// Minimal sparkline of the grid score curve: one muted green-leaning
// line (distinct from the price widget's brighter bar palette), no
// axes, with a subtle tick marking now (the curve's first hour is
// the current one).
function GridScoreSparkline({ curve }: { curve: GridScoreHour[] }) {
  if (curve.length < 2) {
    return null
  }
  const width = 100
  const height = 28
  const top = 3
  const base = height - 3
  const x = (index: number) => (index / (curve.length - 1)) * (width - 3) + 1.5
  const y = (score: number) =>
    base - (Math.min(score, 100) / 100) * (base - top)
  const line = curve
    .map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(index).toFixed(2)} ${y(point.score).toFixed(2)}`
    )
    .join(" ")
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-1.5 h-7 w-full text-emerald-600/70 dark:text-emerald-400/60"
      role="img"
      aria-label="Grid renewables share over the next hours"
    >
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M1.5 ${(y(curve[0].score) - 4).toFixed(2)}v8`}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

// The tooltip text of the Energy sustainability stat. The color state
// thresholds are our own interpretation; Zonneplan publishes none.
const SUSTAINABILITY_TOOLTIP =
  "How much of the electricity on the Dutch grid comes from sun and wind right now, estimated by Zonneplan. The line shows the next hours. The color states are our own interpretation, not Zonneplan's."

interface MetricSpec {
  label: string
  tooltip: string
  hint?: string
  today: string
  week: string
  month: string
  // Sub-caption under the big value (the grid in/out split, or the
  // server-rendered sustainability movement fact).
  sub?: string
  // A live value without week/month history (Energy sustainability).
  live?: boolean
  // The value is unavailable (before sunrise, entity unreachable):
  // the big figure renders muted instead of implying a real number.
  muted?: boolean
  // The stat's state-dependent icon node (the sustainability glyph).
  icon?: ReactNode
  // The sparkline points (the sustainability curve).
  sparkline?: GridScoreHour[]
}

const PLACEHOLDER = "\u2014"

// The four headline metric cards in a 2x2 grid: Grid (net of import and
// export, with the in/out split as its sub-caption), Home usage,
// Self-consumption and the live Energy sustainability stat (the grid
// renewables share with its curve). Today's value is large, this week
// and this month smaller beneath (the sustainability stat has no
// history). Missing data shows a muted dash. The battery lives in the
// live energy flow widget and the battery panel.
function StatsHeader() {
  const { summary, status } = useSummary()

  // Grid net: import minus export; negative means net export.
  const netKwh = (range: {
    import_kwh: number
    export_kwh: number
  }) => range.import_kwh - range.export_kwh

  const gridScore = summary?.grid_score ?? null
  const gridScoreMetric: MetricSpec = {
    label: "Energy sustainability",
    tooltip: SUSTAINABILITY_TOOLTIP,
    today:
      gridScore?.current == null
        ? PLACEHOLDER
        : `${Math.round(gridScore.current)}%`,
    week: "",
    month: "",
    live: true,
    muted: gridScore?.current == null,
    icon: gridScore?.state ? <GridScoreGlyph state={gridScore.state} /> : undefined,
    sparkline: gridScore?.curve,
    sub: gridScore?.sub ?? undefined,
  }

  const metrics: MetricSpec[] = summary
    ? [
        {
          label: "Grid",
          tooltip:
            "Grid electricity today: imported minus exported; negative means net export",
          today: formatKwh(netKwh(summary.today)),
          sub: `${summary.today.import_kwh.toFixed(1)} in, ${summary.today.export_kwh.toFixed(1)} out`,
          week: formatKwh(netKwh(summary.week)),
          month: formatKwh(netKwh(summary.month)),
        },
        {
          label: "Home usage",
          tooltip:
            "Household consumption: from grid + direct solar use - export - energy stored in the battery",
          hint: summary.pv_available ? undefined : "excl. solar",
          today: formatKwh(summary.today.total_usage_kwh),
          week: formatKwh(summary.week.total_usage_kwh),
          month: formatKwh(summary.month.total_usage_kwh),
        },
        {
          label: "Self-consumption",
          tooltip: "Share of today's solar production that was used on site",
          today: formatPct(summary.today.self_consumption_pct),
          week: formatPct(summary.week.self_consumption_pct),
          month: formatPct(summary.month.self_consumption_pct),
          muted: summary.today.self_consumption_pct === null,
        },
        gridScoreMetric,
      ]
    : [
        {
          label: "Grid",
          tooltip:
            "Grid electricity today: imported minus exported; negative means net export",
          today: PLACEHOLDER,
          week: PLACEHOLDER,
          month: PLACEHOLDER,
          muted: true,
        },
        {
          label: "Home usage",
          tooltip:
            "Household consumption: from grid + direct solar use - export - energy stored in the battery",
          today: PLACEHOLDER,
          week: PLACEHOLDER,
          month: PLACEHOLDER,
        },
        {
          label: "Self-consumption",
          tooltip: "Share of today's solar production that was used on site",
          today: PLACEHOLDER,
          week: PLACEHOLDER,
          month: PLACEHOLDER,
          muted: true,
        },
        gridScoreMetric,
      ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {status === "loading"
        ? metrics.map((metric) => (
            <div
              key={metric.label}
              className="min-h-32 animate-pulse rounded-lg bg-muted"
              aria-hidden="true"
            />
          ))
        : metrics.map((metric) => (
            <Card key={metric.label} className="relative min-h-32">
              <div className="absolute right-3 top-3">
                <InfoTooltip text={metric.tooltip} />
              </div>
              <CardHeader>
                <CardDescription
                  className={
                    metric.icon ? "flex items-center gap-1.5" : undefined
                  }
                >
                  {metric.icon}
                  {metric.label}
                  {metric.hint && (
                    <span
                      className="italic"
                      title="No PV entity found; home usage is grid import only"
                    >
                      {" "}
                      ({metric.hint})
                    </span>
                  )}
                </CardDescription>
                <CardTitle
                  className={`text-3xl tabular-nums ${
                    metric.muted ? "text-muted-foreground" : ""
                  }`}
                >
                  {metric.today}
                </CardTitle>
                {metric.sub && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {metric.sub}
                  </p>
                )}
                {metric.sparkline && (
                  <GridScoreSparkline curve={metric.sparkline} />
                )}
                {!metric.live && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    This week {metric.week} &middot; This month{" "}
                    {metric.month}
                  </p>
                )}
              </CardHeader>
            </Card>
          ))}
    </div>
  )
}

export default StatsHeader
