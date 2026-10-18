import { BatteryCharging } from "lucide-react"
import { BatteryGauge } from "@/components/BatteryPanel"
import InfoTooltip from "@/components/InfoTooltip"
import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  BATTERY_IDLE_COLOR,
  CHARGING_COLOR,
  DISCHARGING_COLOR,
} from "@/lib/flowDiagram"
import { useSummary } from "@/lib/useSummary"

// The card's tooltip: what the gauge reads and what its colors mean.
const BATTERY_TOOLTIP =
  "The battery's current state of charge, refreshed with the summary cycle. The gauge's color follows the battery's state: green while charging, amber while discharging, teal at rest."

// The hub's compact battery presence: current charge percentage with a
// state-colored fill indicator, centered like the live usage circle.
// The full battery panel moves to the Battery tab in a later phase.
// The state colors are the flow diagram's shared battery palette:
// muted green charging, muted amber discharging, muted teal idle.

function BatteryStatusWidget() {
  const { summary, status } = useSummary()

  if (status === "loading") {
    return (
      <div
        className="min-h-32 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }

  const available = status === "ok" && summary?.battery_available === true
  const soc = available ? (summary.battery_soc_pct ?? null) : null
  const state = available ? summary.battery_state : null
  const color =
    state === "charging"
      ? CHARGING_COLOR
      : state === "discharging"
        ? DISCHARGING_COLOR
        : BATTERY_IDLE_COLOR

  return (
    <Card className="relative">
      <div className="absolute right-3 top-3">
        <InfoTooltip text={BATTERY_TOOLTIP} />
      </div>
      <CardHeader className="flex flex-1 flex-col items-stretch">
        <CardTitle className="flex items-center gap-2 text-muted-foreground">
          <BatteryCharging className="size-6" aria-hidden="true" />
          Battery status
        </CardTitle>
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
  )
}

export default BatteryStatusWidget
