import { useMemo } from "react"
import BatteryPanel from "@/components/BatteryPanel"
import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"
import { periodHasData } from "@/lib/period"
import { useBatteryFlow } from "@/lib/useBatteryFlow"
import { usePeriod } from "@/lib/usePeriod"

// First local day with battery flow data, matching the server's
// dataStart.
const BATTERY_DATA_START = "2026-10-11"

// The battery spoke: the period-anchored battery flow - the daily
// hourly chart on day periods, the daily or monthly aggregates on
// longer ones, with the mode-aware totals - plus the live
// current-state block (SOC gauge, status, time estimate) that only
// renders while the selected period contains now. The hub keeps the
// compact BatteryStatusWidget, which is current state by definition
// and never hides.
function BatteryPage() {
  const { period, isCurrent } = usePeriod()
  const anchor = useMemo(
    () => ({ period: period.kind, date: period.date }),
    [period.kind, period.date]
  )
  const flow = useBatteryFlow(anchor)

  return (
    <PageLayout
      title="Battery"
      subtitle="Stored energy and charge cycles"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator />
          <ModeToggle />
        </div>
      }
    >
      {!periodHasData(period, BATTERY_DATA_START) ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Battery data starts on 11 October 2026.
          </CardContent>
        </Card>
      ) : (
        <BatteryPanel
          period={period}
          isCurrent={isCurrent}
          flow={flow.data}
          status={flow.status}
        />
      )}
    </PageLayout>
  )
}

export default BatteryPage
