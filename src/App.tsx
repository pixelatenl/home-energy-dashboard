import { useCallback, useEffect, useState } from "react"
import BatteryPanel from "@/components/BatteryPanel"
import DebugPage from "@/components/DebugPage"
import LiveEnergyFlow from "@/components/LiveEnergyFlow"
import PricesWidget from "@/components/PricesWidget"
import StatsHeader from "@/components/StatsHeader"
import SummaryInsight from "@/components/SummaryInsight"
import WeatherForecast from "@/components/WeatherForecast"
import { RefreshCw } from "lucide-react"
import { fetchDailyInsight, type DailyInsight } from "@/lib/api"
import { greetingFor } from "@/lib/time"
import { Button } from "@/components/ui/button"

function App() {
  const [debug, setDebug] = useState(() => window.location.hash === "#debug")
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
    const onHashChange = () => setDebug(window.location.hash === "#debug")
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (debug) {
    return <DebugPage />
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
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
                window.location.hash = "#debug"
              }}
            >
              API debug
            </Button>
          </div>
        </div>
      </header>

      <main className="space-y-6 px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <StatsHeader />
          <SummaryInsight insight={insight} loading={insightLoading} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <BatteryPanel />
          <LiveEnergyFlow />
          <WeatherForecast />
          <PricesWidget />
        </div>
      </main>
    </div>
  )
}

export default App
