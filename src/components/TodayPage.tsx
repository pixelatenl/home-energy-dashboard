import { useCallback, useEffect, useState } from "react"
import BatteryStatusWidget from "@/components/BatteryStatusWidget"
import LiveEnergyFlow from "@/components/LiveEnergyFlow"
import PageLayout from "@/components/PageLayout"
import PricesWidget from "@/components/PricesWidget"
import SolarForecastWidget from "@/components/SolarForecastWidget"
import StatsHeader from "@/components/StatsHeader"
import SummaryInsight from "@/components/SummaryInsight"
import TodayCharts from "@/components/TodayCharts"
import { RefreshCw } from "lucide-react"
import { fetchSummary, type SummaryInsight as SummaryInsightData } from "@/lib/api"
import { greetingFor } from "@/lib/time"
import { triggerAiRefresh } from "@/lib/useAiContext"
import { triggerDataRefresh, useRefetchOnWake } from "@/lib/useDataRefresh"

// The dashboard page: the widget grid, plus the insight loading (fetchSummary, the Mistral budget counter, the
// 5-minute refresh cycle and the wake/focus catch-up). The greeting
// header with the insight pill and refresh button lives in the shared
// PageLayout's header slots.
function TodayPage() {
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
  // The refresh button stays an explicit regenerate control; freshness
  // is the server's business (the Reasoning chip on the card). Only the
  // shared AI budget can disable it.
  const refreshDisabled = budgetExhausted
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
      subtitle="Monitor your household energy use"
      actions={
        <span className="flex items-center gap-2">
          {/* The insight provenance in the live grid badge's quiet outline
              chip idiom, so the header's right cluster reads as one
              family. */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-xs font-medium text-muted-foreground tabular-nums">
            {insightFrom ? (
              <>Insight from {insightFrom}</>
            ) : (
              <span className="font-normal">No insight yet</span>
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
            className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      }
    >
      {/* One coherent compact cluster at the top of the hub: the two
          stat cards (grid with its renewables strip, home usage with
          self-consumption) plus the compact solar forecast and battery
          status in one shared grid on the left - every top widget
          renders at the same height (sm and up; the tallest row sets
          the measure) - with the AI summary filling the right
          column. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid gap-4 sm:grid-cols-2 sm:auto-rows-fr">
          <StatsHeader />
          <SolarForecastWidget />
          <BatteryStatusWidget />
        </div>
        <SummaryInsight insight={insight} loading={insightLoading} />
      </div>

      {/* The flow hero and the prices widget side by side; the
          compact solar and battery today charts sit directly below
          the flow, next to each other, as their own widget pair. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-6">
          <LiveEnergyFlow />
          <TodayCharts />
        </div>
        <PricesWidget />
      </div>
    </PageLayout>
  )
}

export default TodayPage
