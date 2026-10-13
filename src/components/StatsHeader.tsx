import { Info } from "lucide-react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
        className="pointer-events-none absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border bg-popover p-2 text-left text-xs leading-relaxed text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus:opacity-100"
      >
        {text}
      </span>
    </button>
  )
}

interface MetricSpec {
  label: string
  tooltip: string
  hint?: string
  today: string
  week: string
  month: string
  // Sub-caption under the big value (the grid in/out split).
  sub?: string
  // A live value without week/month history (the sustainability score).
  live?: boolean
  // The value is unavailable (before sunrise, entity unreachable):
  // the big figure renders muted instead of implying a real number.
  muted?: boolean
}

const PLACEHOLDER = "\u2014"

// The four headline metric cards in a 2x2 grid: Grid (net of import and
// export, with the in/out split as its sub-caption), Home usage,
// Self-consumption and the live sustainability Score. Today's value is
// large, this week and this month smaller beneath (the Score has no
// history). Missing data shows a muted dash. The battery lives in the
// live energy flow widget and the battery panel.
function StatsHeader() {
  const { summary, status } = useSummary()

  // Grid net: import minus export; negative means net export.
  const netKwh = (range: {
    import_kwh: number
    export_kwh: number
  }) => range.import_kwh - range.export_kwh

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
        {
          label: "Score",
          tooltip:
            "Zonneplan sustainability score of the current grid electricity: how green and cheap it is combined",
          today:
            summary.sustainability_score === null
              ? PLACEHOLDER
              : String(summary.sustainability_score),
          week: "",
          month: "",
          live: true,
          muted: summary.sustainability_score === null,
        },
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
        {
          label: "Score",
          tooltip:
            "Zonneplan sustainability score of the current grid electricity: how green and cheap it is combined",
          today: PLACEHOLDER,
          week: "",
          month: "",
          live: true,
          muted: true,
        },
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
                <CardDescription>
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
