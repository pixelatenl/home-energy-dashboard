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
import SummaryInsight from "@/components/SummaryInsight"
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
  const insightFrom =
    insight?.insight_as_of != null
      ? new Date(insight.insight_as_of).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null

  // The advisory card itself, kept as one value so the two layout
  // branches below render the identical card: stacked beneath the
  // monologue while the server serves it, otherwise exactly where
  // it sits today.
  const advisoryCard = (
    <SummaryInsight
      insight={insight}
      loading={insightLoading}
      from={insightFrom}
      refreshDisabled={refreshDisabled}
      onRefresh={() => {
        void loadInsight(true)
        triggerAiRefresh()
        triggerDataRefresh()
      }}
    />
  )

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
          prices widget; it carries its own provenance chip and
          refresh control in its header. The gap matches the stats
          cluster's own, so all card-to-card whitespace is one
          rhythm. While the server serves the monologue (Stage 4),
          the monologue card stacks directly above the advisory in
          the same column, reading the same payload; with the field
          absent the advisory is the grid's direct item again and
          the layout is identical to the pre-monologue dashboard. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {monologue !== null && monologue.length > 0 ? (
          <div className="flex flex-col gap-4">
            <MonologueCard
              sections={monologue}
              reasoning={insight?.state === "reasoning"}
              from={insightFrom}
            />
            {/* The advisory keeps its full-height stretch: the inner
                column fills whatever the grid row leaves below the
                monologue card, exactly as the advisory fills the row
                on its own. */}
            <div className="flex flex-1 flex-col">{advisoryCard}</div>
          </div>
        ) : (
          advisoryCard
        )}
        <PricesWidget />
      </div>
    </PageLayout>
  )
}

export default TodayPage
