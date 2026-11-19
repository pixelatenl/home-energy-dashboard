import { useCallback, useEffect, useState, memo } from "react"
import BatteryStatusWidget from "@/components/BatteryStatusWidget"
import DataFreshnessLabel from "@/components/DataFreshnessLabel"
import GasTodayCard from "@/components/GasTodayCard"
import LiveUsageCard from "@/components/LiveUsageCard"
import MonologueCard from "@/components/MonologueCard"
import PageLayout from "@/components/PageLayout"
import PricesWidget from "@/components/PricesWidget"
import SavedEarnedCard from "@/components/SavedEarnedCard"
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

// The Now page's sections, memoized on their own data: the page's own
// ticks (the greeting's minute tick, the 5-minute insight refetch)
// re-render only the header and the advisor area, never the whole
// widget tree - each widget re-renders when its own data slice
// changes, which its own hooks already drive.
const MemoLiveUsageCard = memo(LiveUsageCard)
const MemoSavedEarnedCard = memo(SavedEarnedCard)
const MemoStatsHeader = memo(StatsHeader)
const MemoGasTodayCard = memo(GasTodayCard)
const MemoTodaySolarCard = memo(TodaySolarCard)
const MemoBatteryStatusWidget = memo(BatteryStatusWidget)
const MemoTodayBatteryCard = memo(TodayBatteryCard)
const MemoPricesWidget = memo(PricesWidget)

// The advisor card's props are the page's insight state, so it gets a
// content comparison: an identical monologue payload (same sections,
// same insight metadata) does not re-render the advisory area even
// though the fetch returns fresh object identities.
function sameSections(
  a: SummaryMonologueSection[] | null | undefined,
  b: SummaryMonologueSection[] | null | undefined,
): boolean {
  const listA = Array.isArray(a) ? a : []
  const listB = Array.isArray(b) ? b : []
  if (listA.length !== listB.length) return false
  return listA.every((section, index) => {
    const other = listB[index]
    return (
      section?.label === other?.label &&
      section?.narrative === other?.narrative &&
      (section?.fallback_sentences ?? []).join("\u0000") ===
        (other?.fallback_sentences ?? []).join("\u0000")
    )
  })
}

const MemoMonologueCard = memo(
  MonologueCard,
  (prev, next) =>
    prev.reasoning === next.reasoning &&
    prev.from === next.from &&
    prev.refreshDisabled === next.refreshDisabled &&
    prev.loading === next.loading &&
    prev.onRefresh === next.onRefresh &&
    sameSections(prev.sections, next.sections),
)

// The dashboard hub: the stats grid - four cards per row, every
// widget at the same height, the Saved and earned card leading and
// one slot held open for a future card - with the Your Advisor panel beside
// the prices where the live hero used to be. The live energy flow
// itself moved to its own page at /live.
// The greeting header is bare; the insight provenance chip and the
// refresh control live in the Your Advisor card's own header.
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

  // Stable identity for the memoized advisor card: the refresh
  // handler changes only when the insight loader does.
  const handleRefresh = useCallback(() => {
    void loadInsight(true)
    triggerAiRefresh()
    triggerDataRefresh()
  }, [loadInsight])

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
          Electricity usage, Gas/heating, Solar today, Battery status,
          Battery today. All eight slots fill. The layout steps with
          the viewport: phones stack one card per row, tablets from
          768px take two per row (four rows), and from 1024px the
          four by two grid returns. */}
      <div className="grid grid-cols-1 gap-4 md:auto-rows-fr md:grid-cols-2 lg:grid-cols-4">
        <MemoLiveUsageCard />
        <MemoSavedEarnedCard />
        <MemoStatsHeader />
        <MemoGasTodayCard />
        <MemoTodaySolarCard />
        <MemoBatteryStatusWidget />
        <MemoTodayBatteryCard />
      </div>

      {/* The Your Advisor panel where the live hero used to be, beside the
          prices widget; it carries its own provenance chip and the
          dashboard's only refresh control in its header (the owner
          decision of 22 October: the monologue-based advisory area
          is the dashboard's one advisory surface - the legacy card
          retired). The gap matches the stats cluster's own, so all
          card-to-card whitespace is one rhythm. With the monologue
          field absent the area renders nothing at all and the prices
          widget stands alone. The row sits below the fold on the
          kiosk, so it renders lazily (content-visibility) and never
          costs paint while scrolled past. */}
      <div className="below-fold-section grid gap-4 lg:grid-cols-2">
        <MemoPricesWidget />
        <MemoMonologueCard
          sections={monologue}
          reasoning={insight?.state === "reasoning"}
          from={insightFrom}
          refreshDisabled={refreshDisabled}
          loading={insightLoading}
          onRefresh={handleRefresh}
        />

      </div>
    </PageLayout>
  )
}

export default TodayPage
