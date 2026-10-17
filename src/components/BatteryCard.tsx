import { BatteryCharging } from "lucide-react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { SummaryData } from "@/lib/api"
import { CHARGING_COLOR, DISCHARGING_COLOR } from "@/lib/flowDiagram"

// Charging and discharging share the flow diagram's muted battery
// palette; idle stays a neutral gray.
const IDLE_COLOR = "#94a3b8"

function stateColor(state: string): string {
  if (state === "charging") {
    return CHARGING_COLOR
  }
  if (state === "discharging") {
    return DISCHARGING_COLOR
  }
  return IDLE_COLOR
}

function stateLabel(state: string, powerW: number | null): string {
  if (state === "charging" && powerW !== null) {
    return `Charging +${Math.round(powerW)} W`
  }
  if (state === "discharging" && powerW !== null) {
    return `Discharging ${Math.round(powerW)} W`
  }
  return "Idle"
}

// Battery card in the stats header row: a horizontal gauge filled to the
// state of charge, a status line and today's throughput. Hidden entirely
// when the battery is unavailable; empty values never render.
function BatteryCard({ summary }: { summary: SummaryData }) {
  if (!summary.battery_available) {
    return null
  }
  const color = stateColor(summary.battery_state)
  const soc = summary.battery_soc_pct
  const today = summary.today
  return (
    <Card className="min-h-32">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <BatteryCharging className="size-3.5" aria-hidden="true" />
          Battery
        </CardDescription>
        <div className="flex items-center gap-3 pt-1">
          <div className="flex items-center">
            <div className="h-8 w-16 rounded-md border-2 p-[3px]">
              <div
                className="h-full rounded-[3px] transition-[width]"
                style={{
                  width: `${Math.min(Math.max(soc ?? 0, 0), 100)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <div
              className="ml-0.5 h-3 w-1.5 rounded-r-sm"
              style={{ backgroundColor: color, opacity: 0.6 }}
              aria-hidden="true"
            />
          </div>
          <CardTitle className="text-3xl tabular-nums">
            {soc === null ? "\u2014" : `${soc}%`}
          </CardTitle>
        </div>
        <p
          className="text-sm font-medium tabular-nums"
          style={{ color }}
        >
          {stateLabel(summary.battery_state, summary.battery_power_w)}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          Today: {(today.battery_charged_kwh ?? 0).toFixed(1)} kWh in /{" "}
          {(today.battery_discharged_kwh ?? 0).toFixed(1)} kWh out
        </p>
      </CardHeader>
    </Card>
  )
}

export default BatteryCard
