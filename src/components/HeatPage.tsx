import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// The heat and hot water spoke: zone climate and gas history, with
// charts and cost views arriving in the analytics pass.
function HeatPage() {
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
      <Card>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Heat and hot water data accumulates since the evening of
            12 October 2026: zone temperatures, setpoints, house average,
            gas consumption, daily gas price and outdoor temperature.
          </p>
          <p>
            The cost basis is gas; heat pump estimates appear as visible
            assumptions. Charts and cost views arrive in the analytics pass.
          </p>
        </CardContent>
      </Card>
    </PageLayout>
  )
}

export default HeatPage
