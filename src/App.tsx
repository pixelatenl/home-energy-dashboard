import { useCallback, useEffect, useState } from "react"
import ApplianceUsageToday from "@/components/ApplianceUsageToday"
import ArchitecturePage from "@/components/ArchitecturePage"
import BatteryPanel from "@/components/BatteryPanel"
import DebugPage from "@/components/DebugPage"
import LiveEnergyFlow from "@/components/LiveEnergyFlow"
import MainTabs from "@/components/MainTabs"
import PricesWidget from "@/components/PricesWidget"
import StatsHeader from "@/components/StatsHeader"
import SummaryInsight from "@/components/SummaryInsight"
import UsagePage from "@/components/UsagePage"
import WeatherForecast from "@/components/WeatherForecast"
import { RefreshCw } from "lucide-react"
import { fetchSummary, type SummaryInsight as SummaryInsightData } from "@/lib/api"
import { greetingFor } from "@/lib/time"
import { triggerAiRefresh } from "@/lib/useAiContext"
import { triggerDataRefresh, useRefetchOnWake } from "@/lib/useDataRefresh"
import { Button } from "@/components/ui/button"

type View = "dashboard" | "debug" | "usage" | "architecture"

// Hash-based view switch, mirroring the existing #debug page: no router,
// just the URL hash.
function viewFromHash(): View {
  if (window.location.hash === "#debug") {
    return "debug"
  }
  if (window.location.hash === "#usage") {
    return "usage"
  }
  if (window.location.hash === "#architecture") {
    return "architecture"
  }
  return "dashboard"
}

function App() {
  const [view, setView] = useState<View>(() => viewFromHash())
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
    const onHashChange = () => setView(viewFromHash())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (view === "debug") {
    return <DebugPage />
  }

  if (view === "usage") {
    return <UsagePage />
  }

  if (view === "architecture") {
    return <ArchitecturePage />
  }

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
                window.location.hash = "debug"
              }}
            >
              API debug
            </Button>
          </div>
        </div>
      </header>

      <div className="px-6 pt-4">
        <MainTabs active="home" />
      </div>

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

export default App
