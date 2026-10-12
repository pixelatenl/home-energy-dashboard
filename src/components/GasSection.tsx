import { Card, CardContent } from "@/components/ui/card"
import type { GasUsageData } from "@/lib/api"
import { useMode } from "@/lib/mode"

// Bucket length of one series interval: hours and days are fixed, a
// month ends at the next month start.
function bucketEndMs(
  ts: string,
  granularity: "hour" | "day" | "month"
): number {
  if (granularity === "month") {
    const start = new Date(ts)
    return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
  }
  return Date.parse(ts) + (granularity === "hour" ? 3_600_000 : 86_400_000)
}

// Interval label for the tooltip, at the endpoint's granularity.
function intervalLabel(ts: string, granularity: "hour" | "day" | "month"): string {
  const date = new Date(ts)
  if (granularity === "hour") {
    return date.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  }
  if (granularity === "day") {
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
  }
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
}

// The gas section for the active period: a time-anchored bar series at
// the endpoint's granularity (hourly for day, daily for week and
// month, monthly for year) plus totals. The Energy/Cost mode picks the
// primary axis - m3 or EUR - and the other dimension stays visible as
// a secondary value; the mode only restyles, it never refetches.
// Tooltips always carry all three numbers: m3, EUR per m3 and cost.
// An interval without a price shows "price unknown" and no cost,
// never 0.
function GasSection({
  data,
  status,
}: {
  data: GasUsageData | null
  status: "loading" | "ok" | "error"
}) {
  const { mode } = useMode()

  if (status === "loading" && data === null) {
    return (
      <div
        className="min-h-48 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }
  if (status === "error") {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          Could not load gas data. Try again in a moment.
        </CardContent>
      </Card>
    )
  }
  if (data === null) {
    return null
  }

  const fromMs = Date.parse(data.window.start)
  const toMs = Date.parse(data.window.end)
  const pct = (ms: number) =>
    Math.min(100, Math.max(0, ((ms - fromMs) / (toMs - fromMs)) * 100))
  const primary = (interval: { m3: number; cost_eur: number | null }) =>
    mode === "cost" ? interval.cost_eur : interval.m3
  const max = Math.max(
    0.001,
    ...data.series.map((interval) => primary(interval) ?? 0)
  )
  const primaryTotal =
    mode === "cost"
      ? `€${data.totals.cost_eur.toFixed(2)}`
      : `${data.totals.m3.toFixed(2)} m3`
  const secondaryTotal =
    mode === "cost"
      ? `${data.totals.m3.toFixed(2)} m3`
      : `€${data.totals.cost_eur.toFixed(2)}`

  return (
    <Card>
      <CardContent>
        <p className="text-sm font-medium">Gas</p>
        <div className="relative mt-3 h-32">
          {data.series.map((interval) => {
            const startMs = Date.parse(interval.ts)
            const left = pct(startMs)
            const width = Math.max(
              pct(bucketEndMs(interval.ts, data.granularity)) - left,
              0.4
            )
            const value = primary(interval)
            const known = value !== null
            const tooltip =
              interval.price_eur_per_m3 === null
                ? `${intervalLabel(interval.ts, data.granularity)}: ${interval.m3.toFixed(2)} m3 · price unknown`
                : `${intervalLabel(interval.ts, data.granularity)}: ${interval.m3.toFixed(2)} m3 · ${interval.price_eur_per_m3.toFixed(4)} EUR/m3 · €${(interval.cost_eur ?? 0).toFixed(2)}`
            return (
              <div
                key={interval.ts}
                title={tooltip}
                className={`absolute bottom-0 rounded-t-sm ${
                  known ? "bg-foreground/70" : "bg-foreground/40"
                }`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  height: known ? `${(value / max) * 100}%` : "1.5%",
                }}
              />
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-xl font-semibold tabular-nums">{primaryTotal}</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {secondaryTotal}
          </p>
        </div>
        {data.totals.hasUnknownPrice && (
          <p className="mt-2 text-xs text-muted-foreground">
            Some gas in this period has no known price; the cost covers
            only the priced part.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{data.meta.note}</p>
      </CardContent>
    </Card>
  )
}

export default GasSection
