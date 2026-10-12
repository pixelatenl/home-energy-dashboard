import { useCallback, useEffect, useState } from "react"
import ApplianceUsageToday from "@/components/ApplianceUsageToday"
import BatteryPanel from "@/components/BatteryPanel"
import LiveEnergyFlow from "@/components/LiveEnergyFlow"
import PricesWidget from "@/components/PricesWidget"
import StatsHeader from "@/components/StatsHeader"
import SummaryInsight from "@/components/SummaryInsight"
import WeatherForecast from "@/components/WeatherForecast"
import { RefreshCw } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { fetchSummary, type SummaryInsight as SummaryInsightData } from "@/lib/api"
import { greetingFor } from "@/lib/time"
import { triggerAiRefresh } from "@/lib/useAiContext"
import { triggerDataRefresh, useRefetchOnWake } from "@/lib/useDataRefresh"
import { Button } from "@/components/ui/button"

// The dashboard page: greeting header with the insight pill, the refresh
// and API debug controls, and the widget grid. Owns the insight loading
// (fetchSummary, the Mistral budget counter, the 5-minute refresh cycle
// and the wake/focus catch-up).
function TodayPage() {
  const navigate = useNavigate()
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
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">{greetingFor(nowTick)}</h1>
            <p className="text-sm text-muted-foreground">
              {insight?.one_liner ?? "Monitor your household energy use"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium tabular-nums">
                {insightFrom ? (
                  <>Insight from {insightFrom}</>
                ) : (
                  <span className="font-normal text-muted-foreground">
                    No insight yet
                  </span>
                )}
                {insight?.stale && hasInsightText && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-500/20 dark:text-amber-300">
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
                className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
              </button>
            </span>
            <Button
              variant="outline"
              onClick={() => {
                navigate("/debug")
              }}
            >
              API debug
            </Button>
          </div>
        </div>
      </header>

      <main className="space-y-6 px-6 pt-4 pb-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <StatsHeader />
          <SummaryInsight insight={insight} loading={insightLoading} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <LiveEnergyFlow />
          <PricesWidget />
          <WeatherForecast />
          <BatteryPanel />
        </div>

        <ApplianceUsageToday />
      </main>
    </div>
  )
}

export default TodayPage
