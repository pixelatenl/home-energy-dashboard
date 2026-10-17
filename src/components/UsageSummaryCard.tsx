import { Gauge } from "lucide-react"
import PanelHeader from "@/components/PanelHeader"
import { Card, CardContent } from "@/components/ui/card"
import type { UsageBreakdown } from "@/lib/api"
import type { Mode } from "@/lib/mode"
import { periodLabel, type Period } from "@/lib/period"

function formatKwh(value: number): string {
  return `${value.toFixed(1)} kWh`
}

function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `€${value.toFixed(2)}`
}

// The signed previous-period delta: "+64.9 kWh" / "\u2212€0.85".
function signedKwh(value: number): string {
  return `${value >= 0 ? "+" : "\u2212"}${Math.abs(value).toFixed(1)} kWh`
}

function signedEur(value: number): string {
  return `${value >= 0 ? "+" : "\u2212"}€${Math.abs(value).toFixed(2)}`
}

interface UsageSummaryCardProps {
  data: UsageBreakdown | null
  status: "loading" | "ok" | "error"
  mode: Mode
  period: Period
}

// The full-width period summary strip above the Usage tab's
// two-column area (docs/spec.md section 7.1; the predecessor of the
// U6 widget 1). The four figures inline: the mode's primary metric
// large with the secondary beside it, the window's average price,
// and the previous-period delta in both metrics. Cost figures over a
// window without price rows show the unavailable state, never zero.
function UsageSummaryCard({
  data,
  status,
  mode,
  period,
}: UsageSummaryCardProps) {
  const energyFirst = mode === "energy"
  const costUnavailable =
    data !== null && mode === "cost" && data.total.cost_eur === null

  return (
    <Card>
      <PanelHeader
        icon={Gauge}
        title="Period summary"
        description={periodLabel(period)}
      />
      <CardContent>
        {data === null ? (
          <p className="min-h-12 text-sm text-muted-foreground">
            {status === "error"
              ? "Could not load the usage breakdown."
              : "No usage data for this period."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex items-baseline gap-2.5">
                <p className="font-heading text-[2.5rem] font-medium leading-none tabular-nums">
                  {energyFirst
                    ? formatKwh(data.total.kwh)
                    : costUnavailable
                      ? "\u2014"
                      : formatEur(data.total.cost_eur)}
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {energyFirst
                    ? formatEur(data.total.cost_eur)
                    : formatKwh(data.total.kwh)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                avg{" "}
                {data.avg_price_eur === null
                  ? "\u2014"
                  : `€${data.avg_price_eur.toFixed(2)}`}
                /kWh
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                vs previous{" "}
                {signedKwh(data.total.kwh - data.total.previous_kwh)}
                {data.total.cost_eur !== null &&
                  data.total.previous_cost_eur !== null &&
                  ` \u00b7 ${signedEur(
                    data.total.cost_eur - data.total.previous_cost_eur
                  )}`}
              </p>
            </div>
            {costUnavailable && (
              <p className="mt-2 text-xs italic text-muted-foreground">
                No price data for this period; cost figures are
                unavailable, not zero.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default UsageSummaryCard
