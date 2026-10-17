import { useMemo } from "react"
import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import RestOfHomeCard from "@/components/RestOfHomeCard"
import UsageSlotChart from "@/components/UsageSlotChart"
import UsageSummaryCard from "@/components/UsageSummaryCard"
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
      {/* The two-column top section: the left column stacks the
          period summary above the Usage breakdown panel, the right
          column holds the Rest of your home card alone. On narrow
          screens the single-column order is summary, treemap, Rest
          of your home. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <UsageSummaryCard
            data={breakdown.data}
            status={breakdown.status}
            mode={mode}
            period={period}
          />
          <UsageTreemap
            data={breakdown.data}
            status={breakdown.status}
            mode={mode}
            period={period}
            hasData={periodHasData(period)}
          />
        </div>
        <RestOfHomeCard
          data={breakdown.data}
          status={breakdown.status}
          mode={mode}
        />
      </div>

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
