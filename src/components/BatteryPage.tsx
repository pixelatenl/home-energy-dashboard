import BatteryPanel from "@/components/BatteryPanel"
import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// The battery spoke: the full battery panel (state of charge and
// today's flow), with cycles and value views arriving in the analytics
// pass. The hub keeps the compact BatteryStatusWidget.
function BatteryPage() {
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
      <div className="space-y-6">
        <BatteryPanel />
        <Card>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Battery flows accumulate since 10 October 2026.</p>
            <p>Charts, charge cycles and value views arrive in the analytics pass.</p>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  )
}

export default BatteryPage
