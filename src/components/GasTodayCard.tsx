import { useCallback, useEffect, useState } from "react"
import { Flame } from "lucide-react"
import InfoTooltip from "@/components/InfoTooltip"
import SkeletonReveal from "@/components/SkeletonReveal"
import StatCardLink from "@/components/StatCardLink"
import StatCardSkeleton from "@/components/StatCardSkeleton"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchHeatGas, type GasUsageData } from "@/lib/api"
import { gasCardView } from "@/lib/gasCard"
import { HUB_LINKS } from "@/lib/hubLinks"
import { STAT_HEADLINE } from "@/lib/statCard"
import { todayInAmsterdam } from "@/lib/time"
import { useDataRefreshListener, useRefetchOnWake } from "@/lib/useDataRefresh"

// The card's tooltip: the figures' source plus the two data caveats
// the endpoint's meta note and pricing rule carry.
const GAS_TOOLTIP =
  "Gas used for heating and hot water, from the gas counter via /api/heat/gas: the headline is today's volume in cubic meters, the cost line today's cost in euros, and the week and month lines the period totals so far. Data caveats: the gas day totals miss roughly the first half hour after midnight, and the cost uses the last known gas price when today's price has not been published yet."

// The hub's Gas/heating card, in the slot the solar forecast widget
// vacated: a plain metric card in the StatsHeader composition, with
// the fixed title, headline and two sub-lines, the shared skeleton
// reveal, the card-link to the Heat tab and the corner info tooltip.
// The data is the existing /api/heat/gas endpoint, fetched three
// times in parallel (period=day, week and month, all anchored on
// today's local date key); each request fails soft independently, so
// a failed period reads as a dash and never disturbs the others. The
// headline is today's m3, the first sub-line today's cost (a dash on
// an unknown price, never 0), the second the week and month totals,
// in the StatsHeader cards' sub-line wording.
function GasTodayCard() {
  // The anchor follows the clock: a kiosk crossing midnight
  // re-renders into the new day's anchor on its next data refresh.
  const dateKey = todayInAmsterdam()
  const [day, setDay] = useState<GasUsageData | null>(null)
  const [week, setWeek] = useState<GasUsageData | null>(null)
  const [month, setMonth] = useState<GasUsageData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")

  // One load fetches all three periods in parallel; each settles on
  // its own, and a failed period keeps the previous content standing
  // instead of wiping it. State is only updated after the await, so
  // this is safe to call from effects.
  const load = useCallback(async () => {
    const settle = async (period: "day" | "week" | "month") => {
      try {
        return await fetchHeatGas(period, dateKey)
      } catch {
        return undefined
      }
    }
    const [dayResult, weekResult, monthResult] = await Promise.all([
      settle("day"),
      settle("week"),
      settle("month"),
    ])
    if (dayResult !== undefined) setDay(dayResult)
    if (weekResult !== undefined) setWeek(weekResult)
    if (monthResult !== undefined) setMonth(monthResult)
    setStatus("ok")
  }, [dateKey])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  // The 5-minute panel refresh cycle, the header refresh button and
  // the wake-up catch-up, the same idiom as the other hub data hooks.
  useEffect(() => {
    const id = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(id)
  }, [load])
  useDataRefreshListener(() => void load())
  useRefetchOnWake(() => void load())

  // The skeleton owns the card only until the first load settles;
  // after that the view holds the figures (or dashes) and refreshes
  // update in place.
  const view = gasCardView({ day, week, month, status })

  return (
    <SkeletonReveal loading={view.loading} skeleton={<StatCardSkeleton />}>
      <Card className="relative min-h-24 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens today in the Heat tab. */}
        <StatCardLink
          to={HUB_LINKS.gasHeating}
          label="Gas/heating: open today in the Heat tab"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={GAS_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch justify-between">
          {/* The title and the big figure anchor the top; the two
            fixed sub-lines spread to the bottom, so the card fills
            its grid cell without a bottom gap. */}
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-1.5 text-title-foreground">
              <Flame className="size-5 shrink-0" aria-hidden="true" />
              Gas/heating
            </CardTitle>
            {/* The headline stays in the neutral foreground in every
              state: placeholder and normal alike. */}
            <CardTitle className={STAT_HEADLINE}>{view.headlineM3}</CardTitle>
          </div>
          <div className="flex flex-col gap-1">
            {/* Today's cost, always present: the euro figure, or a
              muted dash when the price is unknown. */}
            <p className="text-xs text-muted-foreground tabular-nums">
              Cost today {view.costLabel}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              This week {view.weekM3} &middot; This month {view.monthM3}
            </p>
          </div>
        </CardHeader>
      </Card>
    </SkeletonReveal>
  )
}

export default GasTodayCard
