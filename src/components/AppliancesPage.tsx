import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder for the appliances spoke of the hub-and-spoke restructure.
function AppliancesPage() {
  return (
    <PageLayout
      title="Appliances"
      subtitle="What each appliance uses"
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

export default AppliancesPage
