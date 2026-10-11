import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
} from "react"
import AIContextBox from "@/components/AIContextBox"
import { BatteryCharging, Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  fetchBatteryContext,
  fetchSummary,
  type BatteryFlowHour,
  type BatterySocPoint,
  type SummaryData,
} from "@/lib/api"
import { useAiContext } from "@/lib/useAiContext"
import { localHourFractionOf, localHourOf } from "@/lib/time"

const CHARGING_COLOR = "hsl(140 70% 45%)"
const DISCHARGING_COLOR = "#f59e0b"

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

// Floating tooltip shown while hovering an hour slot of the chart.
function FlowTooltip({
  hour,
  inKwh,
  outKwh,
  socPct,
  leftPercent,
}: {
  hour: number
  inKwh: number | null
  outKwh: number | null
  socPct: number | null
  leftPercent: number
}) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-28 -translate-x-1/2 whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{ left: `${leftPercent}%` }}
    >
      <div className="font-medium tabular-nums">
        {String(hour).padStart(2, "0")}:00
      </div>
      {(inKwh !== null || outKwh !== null) && (
        <div className="text-muted-foreground tabular-nums">
          in {(inKwh ?? 0).toFixed(2)} kWh / out {(outKwh ?? 0).toFixed(2)}{" "}
          kWh
        </div>
      )}
      {socPct !== null && (
        <div className="text-muted-foreground tabular-nums">
          SOC {socPct}%
        </div>
      )}
    </div>
  )
}

// Color swatches matching the chart elements in FlowChart.
function FlowLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className="size-3 rounded-sm"
          style={{ backgroundColor: CHARGING_COLOR, opacity: 0.8 }}
        />
        Charged kWh (up)
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-3 rounded-sm"
          style={{ backgroundColor: DISCHARGING_COLOR, opacity: 0.8 }}
        />
        Discharged kWh (down)
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line
            x1="1"
            y1="4"
            x2="15"
            y2="4"
            stroke="currentColor"
            strokeWidth={2}
          />
        </svg>
        State of charge (%)
      </span>
    </div>
  )
}

// Combined chart for one day: charging kWh as green bars upward from the
// zero line, discharge kWh as amber bars downward, and the SOC series as a
// line on a secondary 0-100 percent axis. Hovering a slot shows a tooltip
// with that hour's flow and SOC.
function FlowChart({
  flow,
  socSeries,
}: {
  flow: BatteryFlowHour[]
  socSeries: BatterySocPoint[]
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * 24)
    setHoveredIndex(index >= 0 && index < 24 ? index : null)
  }
  const hoveredFlow =
    hoveredIndex !== null
      ? (flow.find((hour) => localHourOf(hour.ts) === hoveredIndex) ?? null)
      : null
  const hoveredSoc =
    hoveredIndex !== null
      ? (socSeries.findLast((point) => localHourOf(point.ts) === hoveredIndex)
          ?.soc_pct ?? null)
      : null
  // Horizontal anchor for the tooltip, clamped so it stays inside the chart.
  const tooltipLeftPercent =
    hoveredIndex === null
      ? 0
      : Math.min(Math.max(((hoveredIndex + 0.5) / 24) * 100, 10), 90)

  const width = 960
  const height = 150
  const top = 8
  const bottom = height - 8
  const slot = width / 24
  const zeroY = top + (bottom - top) / 2
  const maxFlow = Math.max(
    flow.reduce((max, hour) => Math.max(max, hour.in_kwh, hour.out_kwh), 0),
    0.1
  )
  const flowScale = ((bottom - top) / 2 - 2) / maxFlow
  const socY = (soc: number) => bottom - (soc / 100) * (bottom - top)
  const socPoints = socSeries
    .map(
      (point) =>
        `${(localHourFractionOf(point.ts) / 24) * width},${socY(point.soc_pct)}`
    )
    .join(" ")

  return (
    <div>
      <div
        className="relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-36 w-full"
          role="img"
          aria-label="Hourly battery charge and discharge with state of charge"
        >
          {flow.map((hour) => {
            const hourSlot = localHourOf(hour.ts)
            return (
              <g key={hour.ts}>
                {hour.in_kwh > 0 && (
                  <rect
                    x={hourSlot * slot + slot * 0.15}
                    y={zeroY - hour.in_kwh * flowScale}
                    width={slot * 0.7}
                    height={hour.in_kwh * flowScale}
                    rx={2}
                    fill={CHARGING_COLOR}
                    opacity={0.8}
                  />
                )}
                {hour.out_kwh > 0 && (
                  <rect
                    x={hourSlot * slot + slot * 0.15}
                    y={zeroY}
                    width={slot * 0.7}
                    height={hour.out_kwh * flowScale}
                    rx={2}
                    fill={DISCHARGING_COLOR}
                    opacity={0.8}
                  />
                )}
              </g>
            )
          })}
          {hoveredIndex !== null && (
            <rect
              x={hoveredIndex * slot}
              y={0}
              width={slot}
              height={height}
              fill="currentColor"
              opacity={0.08}
            />
          )}
          <line
            x1={0}
            x2={width}
            y1={zeroY}
            y2={zeroY}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {socPoints && (
            <polyline
              points={socPoints}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {(hoveredFlow !== null || hoveredSoc !== null) && (
          <FlowTooltip
            hour={hoveredIndex ?? 0}
            inKwh={hoveredFlow ? hoveredFlow.in_kwh : null}
            outKwh={hoveredFlow ? hoveredFlow.out_kwh : null}
            socPct={hoveredSoc}
            leftPercent={tooltipLeftPercent}
          />
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span className="flex items-center gap-1">
          <Clock className="size-3" aria-hidden="true" />
          00
        </span>
        {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
          <span key={hour}>{String(hour).padStart(2, "0")}</span>
        ))}
      </div>
      <FlowLegend />
    </div>
  )
}

// Full-width battery panel below the chart widgets. Hidden entirely when
// the battery is unavailable.
function BatteryPanel() {
  const batteryContext = useAiContext(fetchBatteryContext)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")

  const load = useCallback(async () => {
    try {
      const data = await fetchSummary()
      setSummary(data)
      setStatus("ok")
    } catch {
      setStatus("error")
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  // Keep the battery state current while the page stays open; the server
  // caches the summary for 5 minutes, so this matches its refresh cadence.
  useEffect(() => {
    const id = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(id)
  }, [load])

  if (status === "loading") {
    return (
      <div
        className="min-h-64 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }

  if (status !== "ok" || !summary || !summary.battery_available) {
    return null
  }

  const soc = summary.battery_soc_pct
  const state = summary.battery_state
  const powerW = summary.battery_power_w
  const color =
    state === "charging"
      ? CHARGING_COLOR
      : state === "discharging"
        ? DISCHARGING_COLOR
        : "#94a3b8"
  const stateText =
    state === "charging"
      ? "Charging"
      : state === "discharging"
        ? "Discharging"
        : "Idle"
  const powerText =
    powerW === null
      ? "Idle"
      : `${powerW > 0 ? "+" : ""}${powerW} W ${
          powerW > 0 ? "charging" : powerW < 0 ? "discharging" : "idle"
        }`
  const today = summary.today
  const netKwh =
    (today.battery_charged_kwh ?? 0) - (today.battery_discharged_kwh ?? 0)
  const flow = summary.battery_flow_hourly
  const socSeries = summary.battery_soc_series
  const hasChartData = flow.length > 0 || socSeries.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BatteryCharging className="size-5" aria-hidden="true" />
          Battery
        </CardTitle>
        <CardDescription>
          Anker SOLIX Solarbank Max AC - state of charge and today&rsquo;s
          flow
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-6 md:grid-cols-[15rem_13rem_1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center">
                <div className="h-10 w-20 rounded-lg border-2 p-1">
                  <div
                    className="h-full rounded-[4px] transition-[width]"
                    style={{
                      width: `${Math.min(Math.max(soc ?? 0, 0), 100)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
                <div
                  className="ml-0.5 h-4 w-1.5 rounded-r-sm"
                  style={{ backgroundColor: color, opacity: 0.6 }}
                  aria-hidden="true"
                />
              </div>
              <p className="text-4xl font-semibold tabular-nums">
                {soc === null ? "\u2014" : `${soc}%`}
              </p>
            </div>
            <Badge variant="outline" style={{ color }}>
              {stateText}
            </Badge>
            <p className="text-sm tabular-nums">{powerText}</p>
          </div>

          <div>
            <p className="text-sm font-medium">Today</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatKwh(today.battery_charged_kwh)} in
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatKwh(today.battery_discharged_kwh)} out
            </p>
            <p className="text-xl font-semibold tabular-nums">
              net {netKwh >= 0 ? "+" : ""}
              {netKwh.toFixed(1)} kWh
            </p>
            <div className="mt-3 space-y-1">
              <p className="text-xs text-muted-foreground tabular-nums">
                This week {formatKwh(summary.week.battery_charged_kwh)} in /{" "}
                {formatKwh(summary.week.battery_discharged_kwh)} out
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                This month {formatKwh(summary.month.battery_charged_kwh)} in /{" "}
                {formatKwh(summary.month.battery_discharged_kwh)} out
              </p>
            </div>
          </div>

          <div>
            {hasChartData ? (
              <FlowChart flow={flow} socSeries={socSeries} />
            ) : (
              <div className="flex h-36 items-center justify-center rounded-lg bg-muted/50 text-sm text-muted-foreground">
                No battery data for today yet
              </div>
            )}
          </div>
        </div>

        <AIContextBox {...batteryContext} />
      </CardContent>
    </Card>
  )
}

export default BatteryPanel
