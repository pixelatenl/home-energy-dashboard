import { useMemo } from "react"
import { Recycle } from "lucide-react"
import InfoTooltip from "@/components/InfoTooltip"
import StatCardLink from "@/components/StatCardLink"
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
// makes the headline number pop. Like the other metric cards the
// composition is fixed - title and headline at the top, then
// exactly two sub-lines at the bottom: the derivation and the
// average price, each a muted dash until its figure exists, so the
// card's geometry never changes when data arrives. Without data the
// placeholder reads, never a fabricated zero.
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
    <Card className="relative min-h-32 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
      {/* The whole card opens this week in the Usage tab. */}
      <StatCardLink
        to="/usage?period=week"
        label="Saved and earned: open this week in the Usage tab"
      />
      <div className="absolute right-3 top-3 z-20">
        <InfoTooltip text={SAVED_TOOLTIP} />
      </div>
      <CardHeader className="flex flex-1 flex-col items-stretch justify-between">
        {/* The title and the big figure anchor the top; the two
            fixed sub-lines spread to the bottom, so the card fills
            its grid cell without a bottom gap. */}
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
            <Recycle className="size-5 shrink-0" aria-hidden="true" />
            Saved and earned
          </CardTitle>
          {/* Saved is money by definition; the light green accent
              makes the headline number pop - the single deliberate
              money-card exception to the neutral headline rule. */}
          <CardTitle className="text-[2.5rem] tabular-nums text-green-300">
            {net === null ? "\u2014" : netEurLabel(net.savedEur)}
          </CardTitle>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground tabular-nums">
            {net === null
              ? "\u2014"
              : `from ${formatKwh(net.selfSuppliedKwh)} self-supplied plus feed-in`}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {data === null || data.avg_price_eur === null
              ? "\u2014"
              : `avg \u20ac${data.avg_price_eur.toFixed(2)}/kWh`}
          </p>
        </div>
      </CardHeader>
    </Card>
  )
}

export default SavedEarnedCard
