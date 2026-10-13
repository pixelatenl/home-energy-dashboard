import { useCallback, useEffect, useState } from "react"
import ApplianceUsageToday from "@/components/ApplianceUsageToday"
import BatteryStatusWidget from "@/components/BatteryStatusWidget"
import LiveEnergyFlow from "@/components/LiveEnergyFlow"
import PageLayout from "@/components/PageLayout"
import PricesWidget from "@/components/PricesWidget"
import SolarForecastWidget from "@/components/SolarForecastWidget"
import StatsHeader from "@/components/StatsHeader"
import SummaryInsight from "@/components/SummaryInsight"
import {
  Activity,
  BatteryCharging,
  Droplets,
  Flame,
  Plug,
  RefreshCw,
  Sun,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { fetchSummary, type SummaryInsight as SummaryInsightData } from "@/lib/api"
import { useModeSearch } from "@/lib/mode"
import { greetingFor } from "@/lib/time"
import { triggerAiRefresh } from "@/lib/useAiContext"
import { triggerDataRefresh, useRefetchOnWake } from "@/lib/useDataRefresh"

// Spoke links below the widget grid: one compact card per analytical
// page. Heat and hot water share the /heat page.
const HUB_LINKS = [
  {
    to: "/usage",
    icon: Activity,
    title: "Usage",
    description: "Grid and home energy per period",
  },
  {
    to: "/solar",
    icon: Sun,
    title: "Solar",
    description: "Yield and avoided cost",
  },
  {
    to: "/battery",
    icon: BatteryCharging,
    title: "Battery",
    description: "Charge cycles and value",
  },
  {
    to: "/appliances",
    icon: Plug,
    title: "Appliances",
    description: "Per-appliance energy",
  },
  {
    to: "/heat",
    icon: Flame,
    title: "Heat",
    description: "Zones, gas and heating cost",
  },
  {
    to: "/heat",
    icon: Droplets,
    title: "Hot water",
    description: "Hot water on the heat page",
  },
]

// The dashboard page: the widget grid and the spoke link cards, plus
// the insight loading (fetchSummary, the Mistral budget counter, the
// 5-minute refresh cycle and the wake/focus catch-up). The greeting
// header with the insight pill and refresh button lives in the shared
// PageLayout's header slots.
function TodayPage() {
  // Hub links carry the mode param, like the NavBar tabs.
  const modeSearch = useModeSearch()
  // Ticks once a minute so the greeting follows the local time of day.
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [insight, setInsight] = useState<SummaryInsightData | null>(null)
  const [remainingCalls, setRemainingCalls] = useState<number | null>(null)
  const [insightLoading, setInsightLoading] = useState(true)

  // The insight rides the /api/summary response together with its
  // signature and the Mistral budget, so one refetch refreshes data and
  // insight in step.
  const loadInsight = useCallback(async (force = false) => {
    try {
      const value = await fetchSummary(force)
      setInsight(value.insight)
      setRemainingCalls(value.remaining_calls)
    } catch {
      setInsight(null)
    }
    setInsightLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void loadInsight()
  }, [loadInsight])

  // Join the 5-minute panel refresh cycle so signature-driven insight
  // updates surface without a manual reload.
  useEffect(() => {
    const id = setInterval(() => void loadInsight(), 5 * 60_000)
    return () => clearInterval(id)
  }, [loadInsight])

  // Catch up immediately when the kiosk tab wakes up (focus) or the
  // network connection returns (online).
  const reloadInsight = useCallback(() => void loadInsight(), [loadInsight])
  useRefetchOnWake(reloadInsight)

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const budgetExhausted = remainingCalls !== null && remainingCalls <= 0
  const hasInsightText = insight?.summary != null
  // The refresh button only makes sense when the insight lags the data
  // (stale) and the shared AI budget still has room.
  const refreshDisabled =
    budgetExhausted || (hasInsightText && insight?.stale === false)
  const insightFrom =
    insight?.insight_as_of != null
      ? new Date(insight.insight_as_of).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null

  return (
    <PageLayout
      title={greetingFor(nowTick)}
      subtitle={insight?.one_liner ?? "Monitor your household energy use"}
      actions={
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-700 to-sky-600 px-3 py-1 text-sm font-medium tabular-nums text-white shadow-card dark:from-blue-900 dark:to-sky-800">
            {insightFrom ? (
              <>Insight from {insightFrom}</>
            ) : (
              <span className="font-normal text-white/80">
                No insight yet
              </span>
            )}
            {insight?.stale && hasInsightText && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                stale
              </span>
            )}
          </span>
          <button
            type="button"
            aria-label="Refresh dashboard"
            title={
              budgetExhausted
                ? "Daily AI budget exhausted; the insight refreshes tomorrow"
                : "Regenerate all AI insights and refresh widget data now"
            }
            disabled={refreshDisabled}
            onClick={() => {
              void loadInsight(true)
              triggerAiRefresh()
              triggerDataRefresh()
            }}
            className="rounded-full bg-gradient-to-r from-blue-700 to-sky-600 p-1.5 text-white transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:from-blue-900 dark:to-sky-800"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      }
    >
      {/* One coherent compact cluster at the top of the hub: the stats
          grid with the compact solar forecast and battery status side
          by side beneath it on the left, the AI summary filling the
          right column. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <StatsHeader />
          <div className="grid gap-4 sm:grid-cols-2">
            <SolarForecastWidget />
            <BatteryStatusWidget />
          </div>
        </div>
        <SummaryInsight insight={insight} loading={insightLoading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <LiveEnergyFlow />
        <PricesWidget />
      </div>

      <ApplianceUsageToday />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {HUB_LINKS.map(({ to, icon: Icon, title, description }) => (
          <Link key={title} to={`${to}${modeSearch}`}>
            <Card className="transition hover:border-foreground/30 hover:shadow-card-lift">
              <CardContent className="flex items-center gap-3">
                <Icon
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </PageLayout>
  )
}

export default TodayPage
