import GasSection from "@/components/GasSection"
import HeatingModelCard from "@/components/HeatingModelCard"
import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"
import ZoneTimeline from "@/components/ZoneTimeline"
import { periodHasData } from "@/lib/period"
import { useHeatGas } from "@/lib/useHeatGas"
import { useHeatModel } from "@/lib/useHeatModel"
import { useHeatZones } from "@/lib/useHeatZones"
import { usePeriod } from "@/lib/usePeriod"

// First local day with heat data, matching the server's dataStart.
const HEAT_DATA_START = "2026-10-12"

// The heat and hot water spoke. The hero is the zone timeline; the gas
// section below carries the mode-aware usage and cost. Heating
// intervals are inferred from the setpoint gap (captioned in the
// hero); the gas footnote covers the post-midnight gap.
function HeatPage() {
  const { period, isCurrent } = usePeriod()
  const hasData = periodHasData(period, HEAT_DATA_START)
  const zones = useHeatZones(period.kind, period.date)
  const gas = useHeatGas(period.kind, period.date)
  const model = useHeatModel(period.kind, period.date)

  return (
    <PageLayout
      title="Heat"
      subtitle="Zones, gas and heating cost"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator />
          <ModeToggle />
        </div>
      }
    >
      {!hasData ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Heat data starts on 12 October 2026.
          </CardContent>
        </Card>
      ) : (
        <>
          {zones.status === "loading" && zones.data === null ? (
            <div
              className="min-h-64 animate-pulse rounded-lg bg-muted"
              aria-hidden="true"
            />
          ) : zones.status === "error" ? (
            <Card>
              <CardContent className="text-sm text-muted-foreground">
                Could not load zone data. Try again in a moment.
              </CardContent>
            </Card>
          ) : zones.data !== null ? (
            <ZoneTimeline
              data={zones.data}
              kind={period.kind}
              showNow={isCurrent}
            />
          ) : null}
          <GasSection data={gas.data} status={gas.status} />
          <HeatingModelCard data={model.data} status={model.status} />
        </>
      )}
    </PageLayout>
  )
}

export default HeatPage
