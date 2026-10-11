import { useCallback, useEffect, useState } from "react"
import BatteryCard from "@/components/BatteryCard"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { fetchSummary, type SummaryData } from "@/lib/api"

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `\u20ac${value.toFixed(2)}`
}

interface MetricSpec {
  label: string
  hint?: string
  today: string
  week: string
  month: string
}

// The four headline metric cards: today's value large, this week and this
// month smaller beneath. Missing data shows a dash.
function StatsHeader() {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")

  const load = useCallback(async () => {
    try {
      const data = await fetchSummary()
      setSummary(data)
      setStatus("ok")
    } catch {
      setStatus("error")
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  // Keep the stats current while the page stays open; the server caches
  // the summary for 5 minutes, so this matches its refresh cadence.
  useEffect(() => {
    const id = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(id)
  }, [load])

  const metrics: MetricSpec[] = summary
    ? [
        {
          label: "Net usage",
          today: formatKwh(summary.today.import_kwh),
          week: formatKwh(summary.week.import_kwh),
          month: formatKwh(summary.month.import_kwh),
        },
        {
          label: "Total usage",
          hint: summary.pv_available ? undefined : "excl. solar",
          today: formatKwh(summary.today.total_usage_kwh),
          week: formatKwh(summary.week.total_usage_kwh),
          month: formatKwh(summary.month.total_usage_kwh),
        },
        {
          label: "Back delivery",
          today: formatKwh(summary.today.export_kwh),
          week: formatKwh(summary.week.export_kwh),
          month: formatKwh(summary.month.export_kwh),
        },
        {
          label: "Energy cost",
          today: formatEur(summary.today.cost_eur),
          week: formatEur(summary.week.cost_eur),
          month: formatEur(summary.month.cost_eur),
        },
      ]
    : [
        { label: "Net usage", today: "\u2014", week: "\u2014", month: "\u2014" },
        { label: "Total usage", today: "\u2014", week: "\u2014", month: "\u2014" },
        {
          label: "Back delivery",
          today: "\u2014",
          week: "\u2014",
          month: "\u2014",
        },
        { label: "Energy cost", today: "\u2014", week: "\u2014", month: "\u2014" },
      ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {status === "loading" ? (
        <>
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="min-h-32 animate-pulse rounded-lg bg-muted"
              aria-hidden="true"
            />
          ))}
          <div
            key="battery"
            className="min-h-32 animate-pulse rounded-lg bg-muted"
            aria-hidden="true"
          />
        </>
      ) : (
        <>
          {metrics.map((metric) => (
            <Card key={metric.label} className="min-h-32">
              <CardHeader>
                <CardDescription>
                  {metric.label}
                  {metric.hint && (
                    <span
                      className="italic"
                      title="No PV entity found; total usage is grid import only"
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
          {summary && <BatteryCard summary={summary} />}
        </>
      )}
    </div>
  )
}

export default StatsHeader
