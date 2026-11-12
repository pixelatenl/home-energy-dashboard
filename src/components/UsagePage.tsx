import { useCallback, useMemo } from "react";
import { AIContextSectionBox } from "@/components/AIContextBox";
import ModeToggle from "@/components/ModeToggle";
import PageLayout from "@/components/PageLayout";
import PeriodNavigator from "@/components/PeriodNavigator";
import RestOfHomeCard from "@/components/RestOfHomeCard";
import UsageSlotChart from "@/components/UsageSlotChart";
import UsageGasChart from "@/components/UsageGasChart";
import SelfUsageCard from "@/components/SelfUsageCard";
import UsageSummaryStats from "@/components/UsageSummaryStats";
import { Card, CardContent } from "@/components/ui/card";
import UsageTreemap from "@/components/UsageTreemap";
import { fetchUsageContext } from "@/lib/api";
import { contextBoxByKey, contextBoxItems } from "@/lib/contextBoxes";
import { useMode } from "@/lib/mode";
import { periodHasData } from "@/lib/period";
import { useAiContextSections } from "@/lib/useAiContext";
import { usePeriod } from "@/lib/usePeriod";
import { useUsageBreakdown } from "@/lib/useUsageBreakdown";

// The Usage tab's final layout (docs/spec.md section 7): the left
// column stacks the period summary card above the category treemap,
// the right column holds the Rest of your home card, and the per-slot
// chart plus the gas slot chart span the full width beneath. The
// breakdown reads from one fetch anchored to the navigator's period;
// the gas stat and chart read their own /api/heat/gas fetches, so
// either side fails soft without the other. The Energy/Cost mode
// swaps the primary and secondary metric everywhere on the tab.
function UsagePage() {
  const { period, isCurrent } = usePeriod();
  const { mode } = useMode();
  const anchor = useMemo(
    () => ({ period: period.kind, date: period.date }),
    [period.kind, period.date],
  );
  const breakdown = useUsageBreakdown(anchor);
  // One context fetch per page visit per period anchor; the Energy/Cost
  // mode is not a dependency, so the toggle never refetches a box (the
  // facts carry both dimensions).
  const context = useAiContextSections(
    useCallback(
      (force?: boolean) => fetchUsageContext(period.kind, period.date, force),
      [period.kind, period.date],
    ),
  );
  const boxes = useMemo(() => contextBoxItems(context.response), [context.response]);
  const boxProps = {
    loading: context.loading,
    generatedAt: context.response?.insight_as_of ?? null,
    error: context.response?.error ?? null,
  };

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
      {/* The period summary: the stat cards row opens the page
          directly, like every other tab - no section header, the
          navigator's own label already states the period. */}
      <UsageSummaryStats
        data={breakdown.data}
        status={breakdown.status}
        mode={mode}
        period={period}
        aside={<SelfUsageCard period={period} mode={mode} />}
      />

      {/* One glass card carries the two breakdown sections side by
          side: the Usage breakdown left, Rest of your home right,
          with a soft divider between them from the lg breakpoint up
          and stacked sections on narrow widths. */}
      <Card>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <UsageTreemap
              data={breakdown.data}
              status={breakdown.status}
              mode={mode}
              period={period}
              hasData={periodHasData(period)}
            />
            <AIContextSectionBox
              item={contextBoxByKey(boxes, "breakdown")}
              {...boxProps}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:pl-6">
            <RestOfHomeCard
              data={breakdown.data}
              status={breakdown.status}
              mode={mode}
            />
            <AIContextSectionBox
              item={contextBoxByKey(boxes, "rest_of_home")}
              {...boxProps}
            />
          </div>
        </CardContent>
      </Card>

      {/* The per-slot chart spans the full width beneath: hourly bars
          for day periods, daily bars for weeks and months, monthly
          bars for years. Its context box sits under the chart. */}
      <div className="mt-4">
        <UsageSlotChart
          data={breakdown.data}
          status={breakdown.status}
          mode={mode}
          period={period}
          isCurrent={isCurrent}
        />
      </div>
      <AIContextSectionBox
        item={contextBoxByKey(boxes, "over_time")}
        {...boxProps}
      />

      {/* The gas slot chart sits beneath it in its own card, fed by
          its own /api/heat/gas fetch: one bar per slot at the
          endpoint's granularity, with the €/m³ price overlay. It
          fails soft independently of the breakdown above. */}
      <div className="mt-4">
        <UsageGasChart period={period} isCurrent={isCurrent} mode={mode} />
      </div>
    </PageLayout>
  );
}

export default UsagePage;
