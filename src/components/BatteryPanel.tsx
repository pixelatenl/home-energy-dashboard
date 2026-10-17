import { useState, type MouseEvent } from "react"
import AIContextBox from "@/components/AIContextBox"
import { BatteryCharging, Clock } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  fetchBatteryContext,
  type BatteryFlowHour,
  type BatterySocPoint,
} from "@/lib/api"
import { useAiContext } from "@/lib/useAiContext"
import {
  BATTERY_IDLE_COLOR,
  CHARGING_COLOR,
  DISCHARGING_COLOR,
} from "@/lib/flowDiagram"
import { useSummary } from "@/lib/useSummary"
import { localHourFractionOf, localHourOf } from "@/lib/time"

// The SOC line uses a muted plum, the same family as the usage
// treemap's muted palette.
const SOC_COLOR = "#6f5d7e"

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
}

// Horizontal battery shape: a rounded-rectangle outline with a terminal
// nub on the right, the inner fill width equal to the state of charge and
// the percentage inside; outline and fill are colored by state. Shared
// with the compact battery status widget on the hub.
export function BatteryGauge({ soc, color }: { soc: number | null; color: string }) {
  const pct = Math.min(Math.max(soc ?? 0, 0), 100)
  return (
    <div className="flex items-center">
      <div
        className="relative flex h-20 w-40 items-center overflow-hidden rounded-md border-2 p-1.5"
        style={{ borderColor: color }}
        role="img"
        aria-label={`Battery at ${soc ?? "unknown"} percent`}
      >
        <div
          className="h-full rounded-[5px] transition-[width]"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums text-foreground">
          {soc === null ? "\u2014" : `${soc}%`}
        </span>
      </div>
      <div
        className="ml-0.5 h-7 w-2.5 rounded-r-sm border-2 border-l-0"
        style={{ borderColor: color }}
        aria-hidden="true"
      />
    </div>
  )
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

// Dot chips matching the chart elements in FlowChart.
function FlowLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className="size-3 rounded-full"
          style={{ backgroundColor: CHARGING_COLOR, opacity: 0.8 }}
        />
        Charged kWh
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-3 rounded-full"
          style={{ backgroundColor: DISCHARGING_COLOR, opacity: 0.8 }}
        />
        Discharged kWh
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-3 rounded-full"
          style={{ backgroundColor: SOC_COLOR, opacity: 0.8 }}
        />
        State of charge
      </span>
    </div>
  )
}

// Combined chart for one day: charging kWh as green bars upward from the
// zero line, discharge kWh as amber bars downward, and the SOC series as a
// line on a secondary 0-100 percent axis. Hovering a slot shows a tooltip
// with that hour's flow and SOC. Rendered in the same muted strip
// background and height as the 5 day forecast's hourly chart, so the
// charts and AI insights align across the two cards.
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
  // Subtle accent fill under the SOC line, closed at the chart bottom.
  const socAreaPoints =
    socSeries.length > 1
      ? `${(localHourFractionOf(socSeries[0].ts) / 24) * width},${bottom} ${socPoints} ${
          (localHourFractionOf(socSeries[socSeries.length - 1].ts) / 24) *
          width
        },${bottom}`
      : null

  return (
    // Same strip background and height as the 5 day forecast's hourly
    // chart, so the two cards' charts and AI insights align.
    <div className="rounded-xl bg-muted/30 p-4 h-64">
      <div
        className="relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-44 w-full"
          role="img"
          aria-label="Hourly battery charge and discharge with state of charge"
        >
          {socAreaPoints && (
            <polygon points={socAreaPoints} fill={SOC_COLOR} opacity={0.08} />
          )}
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
              stroke={SOC_COLOR}
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
      <div className="relative mt-1 h-4 text-xs text-muted-foreground tabular-nums">
        <span className="absolute top-0 flex items-center gap-1">
          <Clock className="size-3" aria-hidden="true" />
          00
        </span>
        {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
          <span
            key={hour}
            className="absolute top-0 -translate-x-1/2"
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {String(hour).padStart(2, "0")}
          </span>
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
  const { summary, status } = useSummary()

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
        : BATTERY_IDLE_COLOR
  const statePowerText =
    state === "charging" && powerW !== null
      ? `Charging +${powerW} W`
      : state === "discharging" && powerW !== null
        ? `Discharging ${powerW} W`
        : "Idle"
  const caption = `Status: ${statePowerText}`
  const estimateText = summary.battery_full_in_min
    ? `Full in about ${formatMinutes(summary.battery_full_in_min)}`
    : summary.battery_empty_in_min
      ? `Empty in about ${formatMinutes(summary.battery_empty_in_min)}`
      : null
  const today = summary.today
  const netKwh =
    (today.battery_charged_kwh ?? 0) - (today.battery_discharged_kwh ?? 0)
  const flow = summary.battery_flow_hourly
  const socSeries = summary.battery_soc_series
  const hasChartData = flow.length > 0 || socSeries.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-muted-foreground">
          <BatteryCharging className="size-6" aria-hidden="true" />
          Battery
        </CardTitle>
        <CardDescription>
          Anker SOLIX Solarbank Max AC - state of charge and today&rsquo;s
          flow
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Min height matches the 5 day forecast's day selector row, so
            the charts and the AI insights align across the two cards. */}
        <div className="grid min-h-48 items-start gap-6 md:grid-cols-[13rem_1fr]">
          <div className="space-y-3">
            <BatteryGauge soc={soc} color={color} />
            <p
              className="text-sm font-medium tabular-nums"
              style={{ color }}
            >
              {caption}{" "}
            </p>
            {estimateText && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {estimateText}
              </p>
            )}
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
                This week {formatKwh(summary.week.battery_charged_kwh)} in
                / {formatKwh(summary.week.battery_discharged_kwh)} out
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                This month {formatKwh(summary.month.battery_charged_kwh)}{" "}
                in / {formatKwh(summary.month.battery_discharged_kwh)} out
              </p>
            </div>
          </div>
        </div>

        <div>
          {hasChartData ? (
            <FlowChart flow={flow} socSeries={socSeries} />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
              No battery data for today yet
            </div>
          )}
        </div>

        <AIContextBox {...batteryContext} />
      </CardContent>
    </Card>
  )
}

export default BatteryPanel
