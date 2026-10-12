import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import { Card, CardContent } from "@/components/ui/card"

// The appliances spoke: per-appliance smart plug history, with the
// per-period breakdown on the Usage page.
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
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Smart plug data accumulates since 11 October 2026.</p>
          <p>Per-appliance charts and cost views arrive in the analytics pass.</p>
        </CardContent>
      </Card>
    </PageLayout>
  )
}

export default AppliancesPage
