import { BatteryCharging } from "lucide-react";
import { BatteryGauge } from "@/components/BatteryPanel";
import InfoTooltip from "@/components/InfoTooltip";
import SkeletonReveal from "@/components/SkeletonReveal";
import StatCardLink from "@/components/StatCardLink";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { LiveField } from "@/lib/api";
import { batteryStateLabel } from "@/lib/batteryStateLabel";
import { formatGridWatts } from "@/lib/gridPulse";
import { HUB_LINKS } from "@/lib/hubLinks";
import {
  BATTERY_IDLE_COLOR,
  CHARGING_COLOR,
  DISCHARGING_COLOR,
} from "@/lib/flowDiagram";
import {
  LIVE_STALE_AFTER_MS,
  liveFieldAgeMs,
  useLive,
} from "@/lib/useLive";

// The card's tooltip: what the gauge reads and what its colors mean.
const BATTERY_TOOLTIP =
  "The battery's current state of charge and state, live from the power sensors every 20 seconds. The state line reads the charging or discharging power while the battery flows. The gauge's color follows the battery's state: amber while charging, green while discharging, teal at rest. When the live sensors are unreachable the newest stored reading is used. A dimmed state with a dot is an honest reading more than a minute old.";

// The hub's compact battery presence: current charge percentage with a
// state-colored fill indicator, centered like the live usage circle,
// with the live state centered directly beneath the visual. The full
// battery panel moves to the Battery tab in a later phase. The state
// colors are the flow diagram's shared battery palette: muted amber
// charging, muted green discharging, muted teal idle.

function BatteryStatusWidget() {
  const { snapshot: live, status: liveStatus } = useLive();

  const wattOf = (field?: LiveField): number | null =>
    typeof field?.value === "number" ? field.value : null;

  // The skeleton mirrors the card's composition: title row, model
  // sub-line, then the gauge's block shape with the state line beneath
  // it, centered in the rest.
  const loading = live === null && liveStatus === "loading";

  const socField = live?.fields.batterySocPct ?? null;
  const stateField = live?.fields.batteryState ?? null;
  const soc = typeof socField?.value === "number" ? socField.value : null;
  // Rendered verbatim: the server computed it from the live charge and
  // discharge power at the shared 25 W deadband; the label is the shared
  // display mapping, so an unavailable state reads "unknown", never a
  // fabricated one.
  const state = stateField?.state ?? "unavailable";
  const label = batteryStateLabel(state);
  // The power behind the state: net battery power (charging minus
  // discharging, the same figure the flow page's battery node carries -
  // during charging the discharge sensor rests at 0, so net is the
  // actual charge draw). Only the flowing states carry a figure; idle
  // sits inside the deadband and unknown has none to show.
  const chargeW = wattOf(live?.fields.batteryChargeW);
  const dischargeW = wattOf(live?.fields.batteryDischargeW);
  const netPowerW =
    chargeW !== null && dischargeW !== null ? chargeW - dischargeW : null;
  const powerText =
    netPowerW !== null &&
    (state === "charging" || state === "discharging")
      ? formatGridWatts(Math.abs(netPowerW))
      : null;
  const color =
    state === "charging"
      ? CHARGING_COLOR
      : state === "discharging"
        ? DISCHARGING_COLOR
        : BATTERY_IDLE_COLOR;

  // Stale handling, the Live power card's own rule: a reading older
  // than the shared threshold (or one kept after a failed poll) dims
  // with a dot. The label itself never changes - a stale zero stays a
  // valid idle.
  const stateAgeMs =
    live !== null && stateField !== null
      ? liveFieldAgeMs(live, stateField)
      : null;
  const stale =
    live !== null &&
    state !== "unavailable" &&
    (liveStatus === "error" ||
      (stateAgeMs !== null && stateAgeMs > LIVE_STALE_AFTER_MS));

  return (
    <SkeletonReveal
      loading={loading}
      skeleton={
        // The skeleton mirrors the loaded card's own stack, not the
        // metric cards' spread layout: title row, model sub-line,
        // then the gauge's block shape with the state line beneath
        // it, centered in the remaining space.
        <Card className="h-full min-h-24" aria-busy="true">
          <div className="flex flex-1 flex-col items-stretch gap-1 px-4">
            <Skeleton className="h-[24.75px] w-24" />
            <Skeleton className="h-4 w-40" />
            <div className="flex flex-1 flex-col items-center justify-center gap-1">
              <div className="flex items-center" aria-hidden="true">
                <Skeleton className="h-20 w-40 rounded-md" />
                <Skeleton className="ml-0.5 h-7 w-2.5 rounded-r-md" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        </Card>
      }
    >
      <Card className="relative transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens today in the Battery tab. */}
        <StatCardLink
          to={HUB_LINKS.batteryStatus}
          label="Battery status: open today in the Battery tab"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={BATTERY_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch">
          <CardTitle className="flex items-center gap-2 text-title-foreground">
            <BatteryCharging className="size-6 shrink-0" aria-hidden="true" />
            Battery status
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Anker SOLIX Solarbank Max AC (7kWh)
          </p>
          {/* The gauge block: the visual centered, with the live
            state - rendered verbatim - centered directly beneath
            it. */}
          <div className="flex flex-1 flex-col items-center justify-center gap-1">
            {soc === null ? (
              <p className="text-sm text-subtle-foreground">
                No battery data
              </p>
            ) : (
              /* The same battery gauge the full panel uses: fill and
                percentage in one, colored by the battery state. */
              <BatteryGauge soc={soc} color={color} />
            )}
            <p
              className={`text-xs tabular-nums ${
                stale ? "text-subtle-foreground" : "text-muted-foreground"
              }`}
              title={
                stale
                  ? "last live reading is more than a minute old"
                  : undefined
              }
            >
              {label}
              {powerText !== null && (
                <>
                  {" "}
                  &middot; {powerText}
                </>
              )}
              {stale && (
                <span className="ml-0.5" aria-hidden="true">
                  &middot;
                </span>
              )}
            </p>
          </div>
        </CardHeader>
      </Card>
    </SkeletonReveal>
  );
}

export default BatteryStatusWidget;
