import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// The solar spoke: PV yield and power history, with charts and cost
// views arriving in the analytics pass.
function SolarPage() {
  return (
    <PageLayout
      title="Solar"
      subtitle="What your panels produce"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator />
          <ModeToggle />
        </div>
      }
    >
      <Card>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>PV yield and power data accumulate since 10 October 2026.</p>
          <p>Charts, period totals and cost views arrive in the analytics pass.</p>
        </CardContent>
      </Card>
    </PageLayout>
  )
}

export default SolarPage
