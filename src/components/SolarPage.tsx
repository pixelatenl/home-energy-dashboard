import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import WeatherForecast from "@/components/WeatherForecast"
import { Card, CardContent } from "@/components/ui/card"

// The solar spoke: the 5-day solar forecast lives here; PV yield and
// power history charts arrive in the analytics pass.
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
      <div className="space-y-6">
        <WeatherForecast />
        <Card>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>PV yield and power data accumulate since 10 October 2026.</p>
            <p>Charts, period totals and cost views arrive in the analytics pass.</p>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  )
}

export default SolarPage
