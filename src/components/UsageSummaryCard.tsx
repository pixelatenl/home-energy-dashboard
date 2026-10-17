import { Gauge } from "lucide-react"
import PanelHeader from "@/components/PanelHeader"
import { Card, CardContent } from "@/components/ui/card"
import type { UsageBreakdown } from "@/lib/api"
import type { Mode } from "@/lib/mode"
import { periodLabel, type Period } from "@/lib/period"
import { netFigures } from "@/lib/usageNet"

function formatKwh(value: number): string {
  return `${value.toFixed(1)} kWh`
}

function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `€${value.toFixed(2)}`
}

// Signed like the deltas: "+64.9 kWh" / "\u2212€0.85".
function signedKwh(value: number): string {
  return `${value >= 0 ? "+" : "\u2212"}${Math.abs(value).toFixed(1)} kWh`
}

function signedEur(value: number): string {
  return `${value >= 0 ? "+" : "\u2212"}€${Math.abs(value).toFixed(2)}`
}

// Net figures carry their own sign: positive reads plain, only a
// negative (net-exporter) period shows the minus - "7.3 kWh" vs
// "\u22120.5 kWh", "\u2212€0.35" when feed-in exceeds import cost.
function netKwhLabel(value: number): string {
  return `${value < 0 ? "\u2212" : ""}${Math.abs(value).toFixed(1)} kWh`
}

function netEurLabel(value: number | null): string {
  if (value === null) {
    return "\u2014"
  }
  return `${value < 0 ? "\u2212" : ""}€${Math.abs(value).toFixed(2)}`
}

interface UsageSummaryCardProps {
  data: UsageBreakdown | null
  status: "loading" | "ok" | "error"
  mode: Mode
  period: Period
}

// The period summary card above the treemap in the left column
// (docs/spec.md section 7.1): the with-and-without comparison as a
// three-stat glass row in the price widget's stat composition -
// eyebrow, big value, secondary lines. Stat 1 is household usage
// (the same usage costed as if all of it were imported at the dynamic
// hourly price), stat 2 the net grid, stat 3 saved and earned with
// the self-supplied kWh. The two caveats ride in one footnote at the
// panel's bottom. All figures, sign handling and the null-cost rule
// are exactly those of section 7.1.
function UsageSummaryCard({
  data,
  status,
  mode,
  period,
}: UsageSummaryCardProps) {
  const energyFirst = mode === "energy"
  const net = data === null ? null : netFigures(data)
  const costUnavailable =
    data !== null && mode === "cost" && data.total.cost_eur === null
  const noPrices = data !== null && data.import_cost_eur === null

  return (
    <Card>
      <PanelHeader
        icon={Gauge}
        title="Period summary"
        description={periodLabel(period)}
      />
      <CardContent>
        {data === null || net === null ? (
          <p className="min-h-12 text-sm text-muted-foreground">
            {status === "error"
              ? "Could not load the usage breakdown."
              : "No usage data for this period."}
          </p>
        ) : (
          <>
            {/* The three stats, one composition each: eyebrow, big
                primary, secondary line, one muted detail line. */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  Household usage
                </p>
                <p className="text-3xl font-semibold tabular-nums">
                  {energyFirst
                    ? formatKwh(data.total.kwh)
                    : costUnavailable
                      ? "\u2014"
                      : formatEur(data.total.cost_eur)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {energyFirst
                    ? formatEur(data.total.cost_eur)
                    : formatKwh(data.total.kwh)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  vs previous{" "}
                  {signedKwh(data.total.kwh - data.total.previous_kwh)}
                  {data.total.cost_eur !== null &&
                    data.total.previous_cost_eur !== null &&
                    ` \u00b7 ${signedEur(
                      data.total.cost_eur - data.total.previous_cost_eur
                    )}`}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net grid</p>
                <p className="text-3xl font-semibold tabular-nums">
                  {energyFirst
                    ? netKwhLabel(net.netKwh)
                    : netEurLabel(net.netCostEur)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {energyFirst
                    ? netEurLabel(net.netCostEur)
                    : netKwhLabel(net.netKwh)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  import {formatKwh(data.grid_import_kwh)} &middot; export{" "}
                  {formatKwh(data.grid_export_kwh)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Saved and earned
                </p>
                {/* Saved is money by definition; the light green
                    accent makes the headline number pop. */}
                <p className="text-3xl font-semibold tabular-nums text-green-300">
                  {netEurLabel(net.savedEur)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  from {formatKwh(net.selfSuppliedKwh)} self-supplied
                  plus feed-in
                </p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  avg{" "}
                  {data.avg_price_eur === null
                    ? "\u2014"
                    : `€${data.avg_price_eur.toFixed(2)}`}
                  /kWh
                </p>
              </div>
            </div>

            {/* The two caveats as one footnote line at the panel's
                bottom. */}
            <p className="mt-3 border-t pt-2 text-xs leading-snug text-muted-foreground">
              Household usage includes self-supplied energy, costed as
              if all of it were imported at the dynamic hourly price.
              Net grid is the provider billing view at dynamic hourly
              prices; fixed network fees are excluded, so it may
              deviate slightly from the provider&rsquo;s invoice.
            </p>

            {noPrices && (
              <p className="mt-2 text-xs italic text-muted-foreground">
                No price data for this period; the cost, net and saved
                figures are unavailable, not zero.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default UsageSummaryCard
