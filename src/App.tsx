import { useEffect, useState } from "react"
import BatteryPanel from "@/components/BatteryPanel"
import DebugPage from "@/components/DebugPage"
import PricesWidget from "@/components/PricesWidget"
import StatsHeader from "@/components/StatsHeader"
import SummaryInsight from "@/components/SummaryInsight"
import WeatherForecast from "@/components/WeatherForecast"
import { fetchDailyInsight } from "@/lib/api"
import { greetingFor } from "@/lib/time"
import { Button } from "@/components/ui/button"

function App() {
  const [debug, setDebug] = useState(() => window.location.hash === "#debug")
  // Ticks once a minute so the greeting follows the local time of day.
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [oneLiner, setOneLiner] = useState<string | null>(null)
  const [aiUpdatedAt, setAiUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    const onHashChange = () => setDebug(window.location.hash === "#debug")
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void fetchDailyInsight()
      .then((insight) => {
        setOneLiner(insight.one_liner)
        setAiUpdatedAt(
          insight.generated_at
            ? new Date(insight.generated_at).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : null
        )
      })
      .catch(() => {
        setOneLiner(null)
        setAiUpdatedAt(null)
      })
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
              {oneLiner ?? "Monitor your household energy use"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {aiUpdatedAt && (
              <span className="text-xs text-muted-foreground tabular-nums">
                AI updated {aiUpdatedAt}
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
          <SummaryInsight />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <WeatherForecast />
          <PricesWidget />
        </div>

        <BatteryPanel />
      </main>
    </div>
  )
}

export default App
