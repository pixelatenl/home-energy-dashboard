import { useCallback, useMemo } from "react";
import { AIContextSectionBox } from "@/components/AIContextBox";
import GasSection from "@/components/GasSection";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Skeleton } from "@/components/ui/skeleton";
import HeatingModelCard from "@/components/HeatingModelCard";
import ModeToggle from "@/components/ModeToggle";
import PageLayout from "@/components/PageLayout";
import PeriodNavigator from "@/components/PeriodNavigator";
import { Card, CardContent } from "@/components/ui/card";
import ZoneTimeline from "@/components/ZoneTimeline";
import { fetchHeatContext } from "@/lib/api";
import { contextBoxByKey, contextBoxItems } from "@/lib/contextBoxes";
import { periodHasData } from "@/lib/period";
import { useAiContextSections } from "@/lib/useAiContext";
import { useHeatGas } from "@/lib/useHeatGas";
import { useHeatModel } from "@/lib/useHeatModel";
import { useHeatZones } from "@/lib/useHeatZones";
import { usePeriod } from "@/lib/usePeriod";

// First local day with heat data, matching the server's dataStart.
const HEAT_DATA_START = "2026-10-12";

// The heat and hot water spoke. The gas chart leads, carrying the
// mode-aware usage and cost; the zone timeline follows with per-zone
// temperatures and heating intervals; the heating cost card closes
// the page. Heating intervals are inferred from the setpoint gap
// (captioned in the timeline); the gas footnote covers the
// post-midnight gap.
function HeatPage() {
  const { period, isCurrent } = usePeriod();
  const hasData = periodHasData(period, HEAT_DATA_START);
  const zones = useHeatZones(period.kind, period.date);
  const gas = useHeatGas(period.kind, period.date);
  const model = useHeatModel(period.kind, period.date);
  // One context fetch per page visit per period anchor; the mode is
  // not a dependency, so the Energy/Cost toggle never refetches a box.
  const context = useAiContextSections(
    useCallback(
      (force?: boolean) => fetchHeatContext(period.kind, period.date, force),
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
      title="Heat"
      subtitle="Gas, zones and heating cost"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator />
          <ModeToggle />
        </div>
      }
    >
      {!hasData ? (
        <Card>
          <CardContent className="text-sm text-subtle-foreground">
            Heat data starts on 12 October 2026.
          </CardContent>
        </Card>
      ) : (
        <>
          <GasSection data={gas.data} status={gas.status} />
          <AIContextSectionBox
            item={contextBoxByKey(boxes, "gas")}
            {...boxProps}
          />
          <SkeletonReveal
            loading={zones.status === "loading" && zones.data === null}
            skeleton={
              // The zones panel's shape: the PanelHeader's two
              // lines, then the timeline rows as one block.
              <Card className="min-h-64" aria-busy="true">
                <div className="grid auto-rows-min items-start gap-1 px-4">
                  <Skeleton className="h-[24.75px] w-28" />
                  <Skeleton className="h-5 w-72" />
                </div>
                <div className="mt-4 space-y-1.5 px-4">
                  {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              </Card>
            }
          >
            {zones.status === "error" ? (
              <Card>
                <CardContent className="text-sm text-subtle-foreground">
                  Could not load zone data. Try again in a moment.
                </CardContent>
              </Card>
            ) : zones.data !== null ? (
              <ZoneTimeline
                data={zones.data}
                kind={period.kind}
                showNow={isCurrent}
              />
            ) : null}
          </SkeletonReveal>
          <AIContextSectionBox
            item={contextBoxByKey(boxes, "zones")}
            {...boxProps}
          />
          <HeatingModelCard data={model.data} status={model.status} />
          <AIContextSectionBox
            item={contextBoxByKey(boxes, "heating_cost")}
            {...boxProps}
          />
        </>
      )}
    </PageLayout>
  );
}

export default HeatPage;
