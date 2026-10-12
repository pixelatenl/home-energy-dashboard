import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// The battery spoke: charge and discharge history, with cycles and
// value views arriving in the analytics pass.
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
      <Card>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Battery flows accumulate since 10 October 2026.</p>
          <p>Charts, charge cycles and value views arrive in the analytics pass.</p>
        </CardContent>
      </Card>
    </PageLayout>
  )
}

export default BatteryPage
