import { useMemo } from "react"
import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import RestOfHomeCard from "@/components/RestOfHomeCard"
import UsageSlotChart from "@/components/UsageSlotChart"
import UsageSummaryStats from "@/components/UsageSummaryStats"
import { Card, CardContent } from "@/components/ui/card"
import { periodLabel } from "@/lib/period"
import UsageTreemap from "@/components/UsageTreemap"
import { useMode } from "@/lib/mode"
import { periodHasData } from "@/lib/period"
import { usePeriod } from "@/lib/usePeriod"
import { useUsageBreakdown } from "@/lib/useUsageBreakdown"

// The Usage tab's final layout (docs/spec.md section 7): the left
// column stacks the period summary card above the category treemap,
// the right column holds the Rest of your home card, and the per-slot
// chart spans the full width beneath. Everything reads from one
// breakdown fetch anchored to the navigator's period; the Energy/Cost
// mode swaps the primary and secondary metric everywhere on the tab.
function UsagePage() {
  const { period, isCurrent } = usePeriod()
  const { mode } = useMode()
  const anchor = useMemo(
    () => ({ period: period.kind, date: period.date }),
    [period.kind, period.date]
  )
  const breakdown = useUsageBreakdown(anchor)

  return (
    <PageLayout
      title="Usage"
      subtitle="Where the household's energy goes"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator />
          <ModeToggle />
        </div>
      }
    >
      {/* The period summary: the section's title and period span the
          page as a full-width header, outside any card, with the
          three stats as a row of stat cards beneath - horizontal
          from the sm breakpoint up, vertical on phones. */}
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-semibold">Period summary</h2>
          <p className="text-sm text-muted-foreground">
            {periodLabel(period)}
          </p>
        </div>
        <div className="mt-2">
          <UsageSummaryStats
            data={breakdown.data}
            status={breakdown.status}
            mode={mode}
          />
        </div>
      </div>

      {/* One glass card carries the two breakdown sections side by
          side: the Usage breakdown left, Rest of your home right,
          with a soft divider between them from the lg breakpoint up
          and stacked sections on narrow widths. */}
      <Card>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <UsageTreemap
            data={breakdown.data}
            status={breakdown.status}
            mode={mode}
            period={period}
            hasData={periodHasData(period)}
          />
          <div className="lg:border-l lg:pl-6">
            <RestOfHomeCard
              data={breakdown.data}
              status={breakdown.status}
              mode={mode}
            />
          </div>
        </CardContent>
      </Card>

      {/* The per-slot chart spans the full width beneath: hourly bars
          for day periods, daily bars for weeks and months, monthly
          bars for years. */}
      <div className="mt-4">
        <UsageSlotChart
          data={breakdown.data}
          status={breakdown.status}
          mode={mode}
          period={period}
          isCurrent={isCurrent}
        />
      </div>
    </PageLayout>
  )
}

export default UsagePage
