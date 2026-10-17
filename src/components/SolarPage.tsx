import { useMemo } from "react"
import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import SolarProductionChart from "@/components/SolarProductionChart"
import WeatherForecast from "@/components/WeatherForecast"
import { useMode } from "@/lib/mode"
import { forecastPanelVisible } from "@/lib/solarChart"
import { usePeriod } from "@/lib/usePeriod"
import {
  useSolarProduction,
  useTodayPvForecast,
} from "@/lib/useSolarProduction"

// The solar spoke: the production chart is the page's first content
// block, fed by the period-anchored /api/solar/production series; the
// Energy/Cost mode switches its primary axis between kWh and the
// avoided cost without a refetch. The weather forecast panel renders
// strictly for the current day, week or month only - previous periods
// and every year period show the production chart alone, and no
// weather or AI-context request fires while it is hidden. On the
// current day the chart also carries the hourly forecast as a dashed
// overlay (energy mode); its fetch is gated to the current day too.
function SolarPage() {
  const { period, isCurrent } = usePeriod()
  const { mode } = useMode()
  const anchor = useMemo(
    () => ({ period: period.kind, date: period.date }),
    [period.kind, period.date]
  )
  const production = useSolarProduction(anchor)
  const showForecast = forecastPanelVisible(period, isCurrent)
  const todayForecast = useTodayPvForecast(
    period.kind === "day" && isCurrent
  )

  return (
    <PageLayout
      title="Solar"
      subtitle="What your panels produce"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator />
          <ModeToggle />
        </div>
      }
    >
      <div className="space-y-6">
        <SolarProductionChart
          data={production.data}
          status={production.status}
          mode={mode}
          period={period}
          isCurrent={isCurrent}
          forecast={mode === "energy" ? todayForecast : null}
        />
        {showForecast && <WeatherForecast />}
      </div>
    </PageLayout>
  )
}

export default SolarPage
