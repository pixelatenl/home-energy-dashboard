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
  type BatteryFlowData,
  type BatteryFlowInterval,
  type BatterySocPoint,
} from "@/lib/api"
import { useAiContext } from "@/lib/useAiContext"
import {
  BATTERY_IDLE_COLOR,
  CHARGING_COLOR,
  DISCHARGING_COLOR,
} from "@/lib/flowDiagram"
import { useSummary } from "@/lib/useSummary"
import { localDateOf, localHourFractionOf, localHourOf } from "@/lib/time"
import { useMode } from "@/lib/mode"
import {
  periodEnd,
  periodLabel,
  periodStart,
  type Period,
} from "@/lib/period"
import { niceStep } from "@/lib/chartScale"

// The flow charts' y-axis grid: a nice step per half band (charge up,
// discharge down), with only the lines that fall inside the plot
// band drawn and labeled - the step can round past the data's max.
const flowGridKwh = (maxFlow: number) => {
  const step = niceStep(maxFlow / 2)
  return [2 * step, step, 0, -step, -2 * step]
}

// The y-axis tick label: plain kWh, the Unicode minus below zero.
const flowTickLabel = (value: number): string =>
  value === 0
    ? "0"
    : `${value < 0 ? "\u2212" : ""}${
        Math.abs(value) < 10
          ? Math.abs(value).toFixed(1)
          : String(Math.round(Math.abs(value)))
      }`

// The SOC line uses a muted plum, the same family as the usage
// treemap's muted palette.
const SOC_COLOR = "#6f5d7e"

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

// Money with the usage pages' sign convention: negative amounts read
// "\u2212\u20AC0.09" (the Unicode minus), never clamped to zero.
function formatEur(value: number | null): string {
  return value === null
    ? "\u2014"
    : `${value < 0 ? "\u2212" : ""}\u20AC${Math.abs(value).toFixed(2)}`
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

// Floating tooltip shown while hovering a slot of a chart, in the
// popover idiom. It always carries both dimensions - the kWh and
// the money - so the Energy/Cost toggle is a restyle, not new data.
function FlowTooltip({
  label,
  inKwh,
  outKwh,
  inCostEur,
  outValueEur,
  socPct,
  leftPercent,
}: {
  label: string
  inKwh: number | null
  outKwh: number | null
  inCostEur: number | null
  outValueEur: number | null
  socPct: number | null
  leftPercent: number
}) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-32 -translate-x-1/2 whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{ left: `${leftPercent}%` }}
    >
      <div className="font-medium tabular-nums">{label}</div>
      {(inKwh !== null || outKwh !== null) && (
        <div className="text-muted-foreground tabular-nums">
          in {(inKwh ?? 0).toFixed(2)} kWh / out {(outKwh ?? 0).toFixed(2)}{" "}
          kWh
        </div>
      )}
      <div className="text-muted-foreground tabular-nums">
        {inCostEur === null
          ? "charge cost unknown"
          : `charge ${formatEur(inCostEur)}`}
        {" / "}
        {outValueEur === null
          ? "value unknown"
          : `value ${formatEur(outValueEur)}`}
      </div>
      {socPct !== null && (
        <div className="text-muted-foreground tabular-nums">
          SOC {socPct}%
        </div>
      )}
    </div>
  )
}

// Dot chips matching the chart elements in the flow charts.
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
// with that hour's flow, its money figures and the SOC. Rendered in the
// same muted strip background and height as the 5 day forecast's hourly
// chart, so the charts and AI insights align across the two cards.
function FlowChart({
  flow,
  socSeries,
}: {
  flow: BatteryFlowInterval[]
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
  const yFor = (kwh: number) => zeroY - kwh * flowScale
  const gridKwh = flowGridKwh(maxFlow).filter(
    (value) => yFor(value) >= top && yFor(value) <= bottom
  )
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
      <div className="flex gap-2">
        {/* The y-axis labels, on the gridlines. */}
        <div className="relative h-44 w-8 shrink-0 text-[10px] text-muted-foreground tabular-nums">
        <span className="absolute -top-3.5 left-0 text-[10px] text-muted-foreground">
          kWh
        </span>
          {gridKwh.map((value) => (
            <span
              key={value}
              className="pointer-events-none absolute right-0 -translate-y-1/2"
              style={{ top: `${(yFor(value) / height) * 100}%` }}
            >
              {flowTickLabel(value)}
            </span>
          ))}
        </div>
        <div
          className="relative h-44 w-full"
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
            {gridKwh
              .filter((value) => value !== 0)
              .map((value) => (
                <line
                  key={value}
                  x1={0}
                  x2={width}
                  y1={yFor(value)}
                  y2={yFor(value)}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
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
        {hoveredFlow !== null && (
          <FlowTooltip
            label={`${String(hoveredIndex).padStart(2, "0")}:00`}
            inKwh={hoveredFlow.in_kwh}
            outKwh={hoveredFlow.out_kwh}
            inCostEur={hoveredFlow.in_cost_eur}
            outValueEur={hoveredFlow.out_value_eur}
            socPct={hoveredSoc}
            leftPercent={tooltipLeftPercent}
          />
        )}
        </div>
      </div>
      <div className="flex gap-2">
        <div className="w-8 shrink-0" aria-hidden="true" />
        <div className="relative mt-1 h-4 w-full text-xs text-muted-foreground tabular-nums">
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
      </div>
      <FlowLegend />
    </div>
  )
}

// The chart's slot count for a period: one slot per day of a week or
// month, one per month of a year. The full period stays visible - a
// day without data yet simply shows no bar.
function periodSlotCount(period: Period): number {
  if (period.kind === "week") {
    return 7
  }
  if (period.kind === "year") {
    return 12
  }
  const start = Date.parse(`${periodStart(period)}T00:00:00Z`)
  const end = Date.parse(`${periodEnd(period)}T00:00:00Z`)
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1)
}

// The period chart for week, month and year: the daily (or monthly)
// charge/discharge aggregates as bars around the zero line, one slot
// per day (or month) of the selected period, with hover tooltips
// carrying both dimensions. No SOC line - the state of charge is a
// day-view series.
function PeriodFlowChart({
  flow,
  period,
}: {
  flow: BatteryFlowInterval[]
  period: Period
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const slotCount = periodSlotCount(period)
  const monthly = period.kind === "year"
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * slotCount)
    setHoveredIndex(index >= 0 && index < slotCount ? index : null)
  }
  // The bucket of a slot: day buckets place by their day's offset from
  // the period start, month buckets by their calendar month.
  const bucketOf = (interval: BatteryFlowInterval): number => {
    const dateKey = localDateOf(interval.ts)
    if (monthly) {
      const startMonth = Number(periodStart(period).slice(5, 7))
      return Number(dateKey.slice(5, 7)) - startMonth
    }
    const startMs = Date.parse(`${periodStart(period)}T00:00:00Z`)
    const ms = Date.parse(`${dateKey}T00:00:00Z`)
    return Math.round((ms - startMs) / 86_400_000)
  }
  const bySlot = new Map<number, BatteryFlowInterval>()
  for (const interval of flow) {
    bySlot.set(bucketOf(interval), interval)
  }
  const hoveredFlow = hoveredIndex === null ? null : (bySlot.get(hoveredIndex) ?? null)
  const tooltipLeftPercent =
    hoveredIndex === null
      ? 0
      : Math.min(Math.max(((hoveredIndex + 0.5) / slotCount) * 100, 10), 90)
  // The hovered slot's label: the day (or month) of that slot.
  const hoveredLabel = (() => {
    if (hoveredIndex === null) {
      return null
    }
    if (monthly) {
      const month = Number(periodStart(period).slice(5, 7)) + hoveredIndex
      const year = Number(periodStart(period).slice(0, 4)) + Math.floor((month - 1) / 12)
      return new Date(year, (month - 1) % 12, 15).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      })
    }
    const dateKey = periodStart(period)
    const ms = Date.parse(`${dateKey}T00:00:00Z`) + hoveredIndex * 86_400_000
    return new Date(ms).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    })
  })()

  const width = 960
  const height = 150
  const top = 8
  const bottom = height - 8
  const slot = width / slotCount
  const zeroY = top + (bottom - top) / 2
  const maxFlow = Math.max(
    flow.reduce((max, hour) => Math.max(max, hour.in_kwh, hour.out_kwh), 0),
    0.1
  )
  const flowScale = ((bottom - top) / 2 - 2) / maxFlow
  const yFor = (kwh: number) => zeroY - kwh * flowScale
  const gridKwh = flowGridKwh(maxFlow).filter(
    (value) => yFor(value) >= top && yFor(value) <= bottom
  )

  return (
    <div className="rounded-xl bg-muted/30 p-4 h-64">
      <div className="flex gap-2">
        {/* The y-axis labels, on the gridlines. */}
        <div className="relative h-44 w-8 shrink-0 text-[10px] text-muted-foreground tabular-nums">
        <span className="absolute -top-3.5 left-0 text-[10px] text-muted-foreground">
          kWh
        </span>
          {gridKwh.map((value) => (
            <span
              key={value}
              className="pointer-events-none absolute right-0 -translate-y-1/2"
              style={{ top: `${(yFor(value) / height) * 100}%` }}
            >
              {flowTickLabel(value)}
            </span>
          ))}
        </div>
        <div
          className="relative h-44 w-full"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="h-44 w-full"
            role="img"
            aria-label={`Battery charge and discharge per ${monthly ? "month" : "day"}`}
          >
            {gridKwh
              .filter((value) => value !== 0)
              .map((value) => (
                <line
                  key={value}
                  x1={0}
                  x2={width}
                  y1={yFor(value)}
                  y2={yFor(value)}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {[...bySlot.entries()].map(([index, interval]) => (
            <g key={interval.ts}>
              {interval.in_kwh > 0 && (
                <rect
                  x={index * slot + slot * 0.2}
                  y={zeroY - interval.in_kwh * flowScale}
                  width={slot * 0.6}
                  height={interval.in_kwh * flowScale}
                  rx={2}
                  fill={CHARGING_COLOR}
                  opacity={0.8}
                />
              )}
              {interval.out_kwh > 0 && (
                <rect
                  x={index * slot + slot * 0.2}
                  y={zeroY}
                  width={slot * 0.6}
                  height={interval.out_kwh * flowScale}
                  rx={2}
                  fill={DISCHARGING_COLOR}
                  opacity={0.8}
                />
              )}
            </g>
          ))}
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
        </svg>
        {hoveredFlow !== null && hoveredLabel !== null && (
          <FlowTooltip
            label={hoveredLabel}
            inKwh={hoveredFlow.in_kwh}
            outKwh={hoveredFlow.out_kwh}
            inCostEur={hoveredFlow.in_cost_eur}
            outValueEur={hoveredFlow.out_value_eur}
            socPct={null}
            leftPercent={tooltipLeftPercent}
          />
        )}
        </div>
      </div>
      {/* The x-axis labels across the full period, data or not,
          aligned with the plot past the y-axis gutter. */}
      <div className="flex gap-2">
        <div className="w-8 shrink-0" aria-hidden="true" />
        <div className="relative mt-1 h-4 w-full text-xs text-muted-foreground tabular-nums">
        {Array.from({ length: slotCount }, (_, index) => {
          let label = ""
          if (monthly) {
            const month = Number(periodStart(period).slice(5, 7)) + index
            const year = Number(periodStart(period).slice(0, 4)) + Math.floor((month - 1) / 12)
            label = new Date(year, (month - 1) % 12, 15).toLocaleDateString("en-GB", {
              month: "short",
            })
          } else if (period.kind === "week") {
            const ms =
              Date.parse(`${periodStart(period)}T00:00:00Z`) + index * 86_400_000
            label = new Date(ms).toLocaleDateString("en-GB", {
              weekday: "short",
              timeZone: "UTC",
            })
          } else if ([1, 8, 15, 22].includes(index + 1)) {
            label = String(index + 1)
          }
          if (label === "") {
            return null
          }
          return (
            <span
              key={index}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${((index + 0.5) / slotCount) * 100}%` }}
            >
              {label}
            </span>
          )
        })}
        </div>
      </div>
      <FlowLegend />
    </div>
  )
}

// Full-width battery panel of the Battery tab: the period-anchored
// flow totals and chart, plus the current-state block - the SOC
// gauge with the charge/discharge status and the time-to-full/empty
// estimate - rendered only while the selected period contains now;
// any past period closes the gap entirely. The Energy/Cost mode
// restyles the totals between kWh and the money story (charge cost
// vs discharge value, their difference the arbitrage) without a
// refetch. The AI context box rides along unchanged.
function BatteryPanel({
  period,
  isCurrent,
  flow,
  status,
}: {
  period: Period
  isCurrent: boolean
  flow: BatteryFlowData | null
  status: "loading" | "ok" | "error"
}) {
  const batteryContext = useAiContext(fetchBatteryContext)
  const { summary } = useSummary()
  const { mode } = useMode()

  if (status === "loading" && flow === null) {
    return (
      <div
        className="min-h-64 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }
  if (status === "error" || flow === null) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          Could not load battery data. Try again in a moment.
        </CardContent>
      </Card>
    )
  }

  // The current state, only while the selected period contains now.
  // Past periods render no placeholder - the layout closes the gap.
  const showCurrentState =
    isCurrent && summary !== null && summary.battery_available
  const soc = showCurrentState ? summary.battery_soc_pct : null
  const state = showCurrentState ? summary.battery_state : null
  const powerW = showCurrentState ? summary.battery_power_w : null
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
  const estimateText =
    showCurrentState && summary.battery_full_in_min
      ? `Full in about ${formatMinutes(summary.battery_full_in_min)}`
      : showCurrentState && summary.battery_empty_in_min
        ? `Empty in about ${formatMinutes(summary.battery_empty_in_min)}`
        : null

  const totals = flow.totals
  const hasChartData =
    flow.series.length > 0 || flow.soc_series.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-muted-foreground">
          <BatteryCharging className="size-6" aria-hidden="true" />
          Battery
        </CardTitle>
        <CardDescription>
          Anker SOLIX Solarbank Max AC - charge, discharge and value
          for {periodLabel(period).toLowerCase()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The current-state column rides left of the totals while the
            period contains now; without it the totals span the full
            width, closing the gap. */}
        <div
          className={`grid items-start gap-6 ${
            showCurrentState ? "min-h-48 md:grid-cols-[13rem_1fr]" : ""
          }`}
        >
          {showCurrentState && (
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
          )}

          <div>
            {/* The period totals as the period-summary stat row: small
                muted label, big bold value, no cards. The mode picks
                the dimension; the period rides the header's
                description. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {(mode === "energy"
                ? [
                    { label: "Charged", value: formatKwh(totals.charged_kwh) },
                    {
                      label: "Discharged",
                      value: formatKwh(totals.discharged_kwh),
                    },
                    {
                      label: "Net",
                      value: `${totals.net_kwh >= 0 ? "+" : ""}${totals.net_kwh.toFixed(1)} kWh`,
                    },
                  ]
                : [
                    {
                      label: "Charge cost",
                      value: formatEur(totals.charge_cost_eur),
                    },
                    {
                      label: "Discharge value",
                      value: formatEur(totals.discharge_value_eur),
                    },
                    {
                      label: "Arbitrage",
                      value:
                        totals.arbitrage_eur === null
                          ? "\u2014"
                          : `${totals.arbitrage_eur >= 0 ? "+" : ""}${formatEur(
                              totals.arbitrage_eur
                            )}`,
                    },
                  ]
              ).map((stat) => (
                <div key={stat.label}>
                  <p className="text-xs text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
            {mode === "cost" &&
              (totals.charge_cost_eur === null ||
                totals.discharge_value_eur === null) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Some flow in this period has no known price; the
                  money figures cover only the priced part.
                </p>
              )}
          </div>
        </div>

        <div>
          {hasChartData ? (
            flow.resolution === "hour" ? (
              <FlowChart flow={flow.series} socSeries={flow.soc_series} />
            ) : (
              <PeriodFlowChart flow={flow.series} period={period} />
            )
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
              No battery data for this period yet
            </div>
          )}
        </div>

        <AIContextBox {...batteryContext} />
      </CardContent>
    </Card>
  )
}

export default BatteryPanel
