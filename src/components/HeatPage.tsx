import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder for the heat spoke of the hub-and-spoke restructure.
// Renders the shared period navigator so its behaviour is verifiable
// before the heat charts arrive.
function HeatPage() {
  return (
    <PageLayout title="Heat" subtitle="Heating energy at a glance">
      <PeriodNavigator />
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          This page arrives in the next build pass.
        </CardContent>
      </Card>
    </PageLayout>
  )
}

export default HeatPage
