import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"
import ZoneTimeline from "@/components/ZoneTimeline"
import { periodHasData } from "@/lib/period"
import { useHeatZones } from "@/lib/useHeatZones"
import { usePeriod } from "@/lib/usePeriod"

// First local day with heat data, matching the server's dataStart.
const HEAT_DATA_START = "2026-10-12"

// The heat and hot water spoke. The hero is the zone timeline: nine
// zone rows plus the outdoor reference row on one shared time axis,
// with shaded, inferred heating intervals (captioned in the section).
function HeatPage() {
  const { period, isCurrent } = usePeriod()
  const hasData = periodHasData(period, HEAT_DATA_START)
  const { data, status } = useHeatZones(period.kind, period.date)

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
      ) : status === "loading" && data === null ? (
        <div
          className="min-h-64 animate-pulse rounded-lg bg-muted"
          aria-hidden="true"
        />
      ) : status === "error" ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Could not load zone data. Try again in a moment.
          </CardContent>
        </Card>
      ) : data !== null ? (
        <ZoneTimeline data={data} kind={period.kind} showNow={isCurrent} />
      ) : null}
    </PageLayout>
  )
}

export default HeatPage
