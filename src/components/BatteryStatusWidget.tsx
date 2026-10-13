import { BatteryCharging } from "lucide-react"
import { BatteryGauge } from "@/components/BatteryPanel"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useSummary } from "@/lib/useSummary"

// The hub's compact battery presence: current charge percentage with a
// state-colored fill indicator, plus today's charged and discharged
// totals, all from the same summary payload the battery panel reads.
// The full battery panel moves to the Battery tab in a later phase.

// Palette shared with the battery panel and its charts: green
// charging, amber discharging, neutral idle.
const CHARGING_COLOR = "hsl(140 70% 45%)"
const DISCHARGING_COLOR = "#f59e0b"
const NEUTRAL_COLOR = "#94a3b8"

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
        : NEUTRAL_COLOR

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BatteryCharging className="size-5" aria-hidden="true" />
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
