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

function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `\u20ac${value.toFixed(2)}`
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
}

const PLACEHOLDER = "\u2014"

// The four headline metric cards in a 2x2 grid: today's value large, this
// week and this month smaller beneath. Missing data shows a dash. The
// battery lives in the live energy flow widget and the battery panel.
function StatsHeader() {
  const { summary, status } = useSummary()

  const metrics: MetricSpec[] = summary
    ? [
        {
          label: "From grid",
          tooltip: "Electricity imported from the grid",
          today: formatKwh(summary.today.import_kwh),
          week: formatKwh(summary.week.import_kwh),
          month: formatKwh(summary.month.import_kwh),
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
          label: "To grid",
          tooltip: "Electricity exported back to the grid",
          today: formatKwh(summary.today.export_kwh),
          week: formatKwh(summary.week.export_kwh),
          month: formatKwh(summary.month.export_kwh),
        },
        {
          label: "Energy cost",
          tooltip:
            "Cost of imported electricity at hourly dynamic prices",
          today: formatEur(summary.today.cost_eur),
          week: formatEur(summary.week.cost_eur),
          month: formatEur(summary.month.cost_eur),
        },
      ]
    : [
        {
          label: "From grid",
          tooltip: "Electricity imported from the grid",
          today: PLACEHOLDER,
          week: PLACEHOLDER,
          month: PLACEHOLDER,
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
          label: "To grid",
          tooltip: "Electricity exported back to the grid",
          today: PLACEHOLDER,
          week: PLACEHOLDER,
          month: PLACEHOLDER,
        },
        {
          label: "Energy cost",
          tooltip: "Cost of imported electricity at hourly dynamic prices",
          today: PLACEHOLDER,
          week: PLACEHOLDER,
          month: PLACEHOLDER,
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
                <CardTitle className="text-3xl tabular-nums">
                  {metric.today}
                </CardTitle>
                <p className="text-xs text-muted-foreground tabular-nums">
                  This week {metric.week} &middot; This month {metric.month}
                </p>
              </CardHeader>
            </Card>
          ))}
    </div>
  )
}

export default StatsHeader
