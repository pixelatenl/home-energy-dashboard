import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder for the battery spoke of the hub-and-spoke restructure.
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
        <CardContent className="text-sm text-muted-foreground">
          This page arrives in the next build pass.
        </CardContent>
      </Card>
    </PageLayout>
  )
}

export default BatteryPage
