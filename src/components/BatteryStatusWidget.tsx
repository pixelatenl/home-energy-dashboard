import { BatteryCharging } from "lucide-react"
import { BatteryGauge } from "@/components/BatteryPanel"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  BATTERY_IDLE_COLOR,
  CHARGING_COLOR,
  DISCHARGING_COLOR,
} from "@/lib/flowDiagram"
import { useSummary } from "@/lib/useSummary"

// The hub's compact battery presence: current charge percentage with a
// state-colored fill indicator, plus today's charged and discharged
// totals, all from the same summary payload the battery panel reads.
// The full battery panel moves to the Battery tab in a later phase.
// The state colors are the flow diagram's shared battery palette:
// muted green charging, muted amber discharging, muted teal idle.

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

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
  const charged = available
    ? (summary.today.battery_charged_kwh ?? null)
    : null
  const discharged = available
    ? (summary.today.battery_discharged_kwh ?? null)
    : null
  const state = available ? summary.battery_state : null
  const color =
    state === "charging"
      ? CHARGING_COLOR
      : state === "discharging"
        ? DISCHARGING_COLOR
        : BATTERY_IDLE_COLOR

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-muted-foreground">
          <BatteryCharging className="size-6" aria-hidden="true" />
          Battery
        </CardTitle>
        <CardDescription>Charge and today&rsquo;s flow</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!available ? (
          <p className="text-sm text-muted-foreground">No battery data</p>
        ) : (
          <>
            {/* The same battery gauge the full panel uses: fill and
                percentage in one, colored by the battery state. */}
            <BatteryGauge soc={soc} color={color} />
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatKwh(charged)} charged · {formatKwh(discharged)}{" "}
              discharged today
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default BatteryStatusWidget
