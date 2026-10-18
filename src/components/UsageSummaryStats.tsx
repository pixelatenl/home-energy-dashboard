import { House, PlugZap, Recycle } from "lucide-react"
import InfoTooltip from "@/components/InfoTooltip"
import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { UsageBreakdown } from "@/lib/api"
import type { Mode } from "@/lib/mode"
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

interface UsageSummaryStatsProps {
  data: UsageBreakdown | null
  status: "loading" | "ok" | "error"
  mode: Mode
}

// The period summary's three stats (docs/spec.md section 7.1) as
// one row of stat cards in the home page stat cards' composition -
// muted icon and title row, big value, secondary line, muted detail
// line: household usage (the usage costed as if all of it were
// imported at the dynamic hourly price), the net grid, and saved and
// earned with the self-supplied kWh. The section's own title and
// period render as the page-level header above, outside any card.
// The two caveats ride in the first card's corner info tooltip, the
// home page stat cards' idiom. All figures, sign handling and the
// null-cost rule are exactly those of section 7.1.
function UsageSummaryStats({ data, status, mode }: UsageSummaryStatsProps) {
  const energyFirst = mode === "energy"
  const net = data === null ? null : netFigures(data)
  const costUnavailable =
    data !== null && mode === "cost" && data.total.cost_eur === null
  const noPrices = data !== null && data.import_cost_eur === null

  // The two caveats, in the corner info tooltip the home page stat
  // cards use instead of a footnote line.
  const CAVEATS_TOOLTIP =
    "Household usage includes self-supplied energy, costed as if all of it were imported at the dynamic hourly price. Net grid is the provider billing view at dynamic hourly prices; fixed network fees are excluded, so it may deviate slightly from the provider\u2019s invoice."

  if (data === null || net === null) {
    return (
      <p className="min-h-12 text-sm text-muted-foreground">
        {status === "error"
          ? "Could not load the usage breakdown."
          : "No usage data for this period."}
      </p>
    )
  }

  return (
    <>
      {/* The three stats, one card each: horizontal from the sm
          breakpoint up, vertical on phones. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="relative min-h-32">
          {/* The corner info tooltip over the household usage card,
              the home page stat cards' idiom. */}
          <div className="absolute right-3 top-3 z-20">
            <InfoTooltip text={CAVEATS_TOOLTIP} />
          </div>
          <CardHeader className="flex flex-1 flex-col items-stretch">
            <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
              <House className="size-5 shrink-0" aria-hidden="true" />
              Household usage
            </CardTitle>
            <CardTitle className="text-[2.5rem] tabular-nums">
              {energyFirst
                ? formatKwh(data.total.kwh)
                : costUnavailable
                  ? "\u2014"
                  : formatEur(data.total.cost_eur)}
            </CardTitle>
            <p className="text-xs text-muted-foreground tabular-nums">
              {energyFirst
                ? formatEur(data.total.cost_eur)
                : formatKwh(data.total.kwh)}
            </p>
            <p className="pb-2 text-xs text-muted-foreground tabular-nums">
              vs previous{" "}
              {signedKwh(data.total.kwh - data.total.previous_kwh)}
              {data.total.cost_eur !== null &&
                data.total.previous_cost_eur !== null &&
                ` \u00b7 ${signedEur(
                  data.total.cost_eur - data.total.previous_cost_eur
                )}`}
            </p>
          </CardHeader>
        </Card>

        <Card className="relative min-h-32">
          <CardHeader className="flex flex-1 flex-col items-stretch">
            <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
              <PlugZap className="size-5 shrink-0" aria-hidden="true" />
              Net grid
            </CardTitle>
            <CardTitle className="text-[2.5rem] tabular-nums">
              {energyFirst ? netKwhLabel(net.netKwh) : netEurLabel(net.netCostEur)}
            </CardTitle>
            <p className="text-xs text-muted-foreground tabular-nums">
              {energyFirst ? netEurLabel(net.netCostEur) : netKwhLabel(net.netKwh)}
            </p>
            <p className="pb-2 text-xs text-muted-foreground tabular-nums">
              import {formatKwh(data.grid_import_kwh)} &middot; export{" "}
              {formatKwh(data.grid_export_kwh)}
            </p>
          </CardHeader>
        </Card>

        <Card className="relative min-h-32">
          <CardHeader className="flex flex-1 flex-col items-stretch">
            <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
              <Recycle className="size-5 shrink-0" aria-hidden="true" />
              Saved and earned
            </CardTitle>
            {/* Saved is money by definition; the light green accent
                makes the headline number pop. */}
            <CardTitle className="text-[2.5rem] tabular-nums text-green-300">
              {netEurLabel(net.savedEur)}
            </CardTitle>
            <p className="text-xs text-muted-foreground tabular-nums">
              from {formatKwh(net.selfSuppliedKwh)} self-supplied plus
              feed-in
            </p>
            <p className="pb-2 text-xs text-muted-foreground tabular-nums">
              avg{" "}
              {data.avg_price_eur === null
                ? "\u2014"
                : `\u20ac${data.avg_price_eur.toFixed(2)}`}
              /kWh
            </p>
          </CardHeader>
        </Card>
      </div>

      {noPrices && (
        <p className="mt-2 text-xs italic text-muted-foreground">
          No price data for this period; the cost, net and saved figures
          are unavailable, not zero.
        </p>
      )}
    </>
  )
}

export default UsageSummaryStats
