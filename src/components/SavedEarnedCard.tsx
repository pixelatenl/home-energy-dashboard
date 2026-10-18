import { useMemo } from "react"
import { Recycle } from "lucide-react"
import InfoTooltip from "@/components/InfoTooltip"
import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { todayInAmsterdam } from "@/lib/time"
import { useUsageBreakdown } from "@/lib/useUsageBreakdown"
import { netFigures } from "@/lib/usageNet"

function formatKwh(value: number): string {
  return `${value.toFixed(1)} kWh`
}

// The card's tooltip: the same figure the Usage panel's period
// summary shows, for today.
const SAVED_TOOLTIP =
  "Saved and earned today: what self-supplied solar and battery power plus the feed-in credit are worth versus importing everything. The cost of today's household usage if all of it were imported at dynamic hourly prices, minus the net grid cost actually paid. The average is today's volume-weighted grid price."

// Net figures carry their own sign: positive reads plain, only a
// negative (net-exporter) day shows the minus.
function netEurLabel(value: number | null): string {
  if (value === null) {
    return "\u2014"
  }
  return `${value < 0 ? "\u2212" : ""}\u20ac${Math.abs(value).toFixed(2)}`
}

// The stats hub's "Saved and earned" card: the Usage panel's saved
// figure (docs/spec.md section 7.1) for today - the all-imported
// cost of today's household usage minus the net grid cost - in the
// home page stat cards' composition. The same usage breakdown
// endpoint and the same netFigures derivation the Usage panel uses,
// anchored to the current day, so the number always agrees with the
// Usage tab. Saved is money by definition; the light green accent
// makes the headline number pop. Without data the placeholder reads,
// never a fabricated zero.
function SavedEarnedCard() {
  // The anchor follows the clock: a kiosk crossing midnight
  // re-renders into the new day's anchor on its next data refresh.
  const dateKey = todayInAmsterdam()
  const anchor = useMemo(
    () => ({ period: "day" as const, date: dateKey }),
    [dateKey]
  )
  const { data } = useUsageBreakdown(anchor)
  const net = data === null ? null : netFigures(data)

  return (
    <Card className="relative min-h-32">
      <div className="absolute right-3 top-3">
        <InfoTooltip text={SAVED_TOOLTIP} />
      </div>
      <CardHeader className="flex flex-1 flex-col items-stretch">
        <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
          <Recycle className="size-5 shrink-0" aria-hidden="true" />
          Saved and earned
        </CardTitle>
        {/* Saved is money by definition; the light green accent makes
            the headline number pop. */}
        <CardTitle className="text-[2.5rem] tabular-nums text-green-300">
          {net === null ? "\u2014" : netEurLabel(net.savedEur)}
        </CardTitle>
        <p className="text-xs text-muted-foreground tabular-nums">
          {net === null
            ? "today so far"
            : `from ${formatKwh(net.selfSuppliedKwh)} self-supplied plus feed-in`}
        </p>
        <p className="pb-2 text-xs text-muted-foreground tabular-nums">
          avg{" "}
          {data === null || data.avg_price_eur === null
            ? "\u2014"
            : `\u20ac${data.avg_price_eur.toFixed(2)}`}
          /kWh
        </p>
      </CardHeader>
    </Card>
  )
}

export default SavedEarnedCard
