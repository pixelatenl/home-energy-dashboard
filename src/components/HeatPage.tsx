import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder for the heat spoke of the hub-and-spoke restructure.
// The shared period navigator sits in the tab row, right of the main
// tabs, mirroring the usage page's range selector position.
function HeatPage() {
  return (
    <PageLayout
      title="Heat"
      subtitle="Heating energy at a glance"
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

export default HeatPage
