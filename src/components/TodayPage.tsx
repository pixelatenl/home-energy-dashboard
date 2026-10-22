import { useCallback, useEffect, useState } from "react"
import BatteryStatusWidget from "@/components/BatteryStatusWidget"
import DataFreshnessLabel from "@/components/DataFreshnessLabel"
import LiveUsageCard from "@/components/LiveUsageCard"
import MonologueCard from "@/components/MonologueCard"
import PageLayout from "@/components/PageLayout"
import PricesWidget from "@/components/PricesWidget"
import SavedEarnedCard from "@/components/SavedEarnedCard"
import SolarForecastWidget from "@/components/SolarForecastWidget"
import StatsHeader from "@/components/StatsHeader"
import { TodayBatteryCard, TodaySolarCard } from "@/components/TodayCharts"
import {
  fetchSummary,
  type SummaryInsight as SummaryInsightData,
  type SummaryMonologueSection,
} from "@/lib/api"
import { greetingFor } from "@/lib/time"
import { triggerAiRefresh } from "@/lib/useAiContext"
import { triggerDataRefresh, useRefetchOnWake } from "@/lib/useDataRefresh"

// The dashboard hub: the stats grid - four cards per row, every
// widget at the same height, the Saved and earned card leading and
// one slot held open for a future card - with the AI advisory beside
// the prices where the live hero used to be. The live energy flow
// itself moved to its own page at /live.
// The greeting header is bare; the insight provenance chip and the
// refresh control live in the AI advisory card's own header.
function TodayPage() {
  // Ticks once a minute so the greeting follows the local time of day.
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [insight, setInsight] = useState<SummaryInsightData | null>(null)
  // The advisory monologue sections ride the same /api/summary
  // response as the insight (Stage 4, served only while the server
  // switch is on), so they share this fetch and its refresh cycle
  // - no separate request of their own.
  const [monologue, setMonologue] = useState<SummaryMonologueSection[] | null>(
    null
  )
  const [remainingCalls, setRemainingCalls] = useState<number | null>(null)
  // True only until the first payload lands; the advisory area shows
  // its first-paint skeleton meanwhile, and refreshes keep the
  // previous content visible instead.
  const [insightLoading, setInsightLoading] = useState(true)

  // The insight rides the /api/summary response together with its
  // signature and the Mistral budget, so one refetch refreshes data and
  // insight in step.
  const loadInsight = useCallback(async (force = false) => {
    try {
      const value = await fetchSummary(force)
      setInsight(value.insight)
      setMonologue(value.monologue ?? null)
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
  // The insight's as-of time as a formatted HH:MM label, or null
  // before the first insight.
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
      actions={<DataFreshnessLabel />}
    >
      {/* The stats grid spans the full page width: four cards per
          row, every cell the same height, two rows - Live power (the
          breathing circle combining the live draw with the renewable
          grid share) leading, then Saved and earned, From the grid,
          Home usage, Solar forecast, Solar today, Battery status,
          Battery today. All eight slots fill. The layout steps with
          the viewport: phones stack one card per row, tablets from
          768px take two per row (four rows), and from 1024px the
          four by two grid returns. */}
      <div className="grid grid-cols-1 gap-4 md:auto-rows-fr md:grid-cols-2 lg:grid-cols-4">
        <LiveUsageCard />
        <SavedEarnedCard />
        <StatsHeader />
        <SolarForecastWidget />
        <TodaySolarCard />
        <BatteryStatusWidget />
        <TodayBatteryCard />
      </div>

      {/* The AI advisory where the live hero used to be, beside the
          prices widget; it carries its own provenance chip and the
          dashboard's only refresh control in its header (the owner
          decision of 22 October: the monologue-based advisory area
          is the dashboard's one advisory surface - the legacy card
          retired). The gap matches the stats cluster's own, so all
          card-to-card whitespace is one rhythm. With the monologue
          field absent the area renders nothing at all and the prices
          widget stands alone. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <MonologueCard
          sections={monologue}
          reasoning={insight?.state === "reasoning"}
          from={insightFrom}
          refreshDisabled={refreshDisabled}
          loading={insightLoading}
          onRefresh={() => {
            void loadInsight(true)
            triggerAiRefresh()
            triggerDataRefresh()
          }}
        />
        <PricesWidget />
      </div>
    </PageLayout>
  )
}

export default TodayPage
