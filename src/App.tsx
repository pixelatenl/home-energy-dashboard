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
import { fetchDailyInsight, type DailyInsight } from "@/lib/api"
import { greetingFor } from "@/lib/time"
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
  const [insight, setInsight] = useState<DailyInsight | null>(null)
  const [insightLoading, setInsightLoading] = useState(true)

  const loadInsight = useCallback(async (force = false) => {
    try {
      const value = await fetchDailyInsight(force)
      setInsight(value)
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
            {insight?.as_of && (
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  Based on data from{" "}
                  {new Date(insight.as_of).toLocaleString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  type="button"
                  aria-label="Refresh AI summary"
                  title="Regenerate the AI summary now"
                  onClick={() => void loadInsight(true)}
                  className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            )}
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
