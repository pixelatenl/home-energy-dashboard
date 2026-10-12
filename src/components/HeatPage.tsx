import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder for the heat spoke of the hub-and-spoke restructure.
// The header carries the shared period navigator, as the usage page
// header carries its range selector.
function HeatPage() {
  return (
    <PageLayout
      title="Heat"
      subtitle="Heating energy at a glance"
      actions={<PeriodNavigator />}
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
