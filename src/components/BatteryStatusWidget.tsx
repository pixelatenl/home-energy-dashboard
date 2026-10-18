import { BatteryCharging } from "lucide-react";
import { BatteryGauge } from "@/components/BatteryPanel";
import InfoTooltip from "@/components/InfoTooltip";
import SkeletonReveal from "@/components/SkeletonReveal";
import StatCardLink from "@/components/StatCardLink";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BATTERY_IDLE_COLOR,
  CHARGING_COLOR,
  DISCHARGING_COLOR,
} from "@/lib/flowDiagram";
import { useSummary } from "@/lib/useSummary";

// The card's tooltip: what the gauge reads and what its colors mean.
const BATTERY_TOOLTIP =
  "The battery's current state of charge, refreshed with the summary cycle. The gauge's color follows the battery's state: green while charging, amber while discharging, teal at rest.";

// The hub's compact battery presence: current charge percentage with a
// state-colored fill indicator, centered like the live usage circle.
// The full battery panel moves to the Battery tab in a later phase.
// The state colors are the flow diagram's shared battery palette:
// muted green charging, muted amber discharging, muted teal idle.

function BatteryStatusWidget() {
  const { summary, status } = useSummary();

  // The skeleton mirrors the card's composition: title row, model
  // sub-line, then the gauge's block shape centered in the rest.
  const loading = status === "loading";

  const available = status === "ok" && summary?.battery_available === true;
  const soc = available ? (summary.battery_soc_pct ?? null) : null;
  const state = available ? summary.battery_state : null;
  const color =
    state === "charging"
      ? CHARGING_COLOR
      : state === "discharging"
        ? DISCHARGING_COLOR
        : BATTERY_IDLE_COLOR;

  return (
    <SkeletonReveal
      loading={loading}
      skeleton={
        // The skeleton mirrors the loaded card's own stack, not the
        // metric cards' spread layout: title row, model sub-line
        // directly beneath it, then the gauge's block shape centered
        // in the remaining space.
        <Card className="h-full min-h-24" aria-busy="true">
          <div className="flex flex-1 flex-col items-stretch gap-1 px-4">
            <Skeleton className="h-[24.75px] w-24" />
            <Skeleton className="h-4 w-40" />
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center" aria-hidden="true">
                <Skeleton className="h-20 w-40 rounded-md" />
                <Skeleton className="ml-0.5 h-7 w-2.5 rounded-r-md" />
              </div>
            </div>
          </div>
        </Card>
      }
    >
      <Card className="relative transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens this week in the Battery tab. */}
        <StatCardLink
          to="/battery?period=week"
          label="Battery status: open this week in the Battery tab"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={BATTERY_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch">
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <BatteryCharging className="size-6" aria-hidden="true" />
            Battery status
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Anker SOLIX Solarbank Max AC (7kWh)
          </p>
          {!available ? (
            <p className="text-sm text-muted-foreground">No battery data</p>
          ) : (
            /* The same battery gauge the full panel uses: fill and
              percentage in one, colored by the battery state. */
            <div className="flex flex-1 items-center justify-center">
              <BatteryGauge soc={soc} color={color} />
            </div>
          )}
        </CardHeader>
      </Card>
    </SkeletonReveal>
  );
}

export default BatteryStatusWidget;
