import { useEffect, useState } from "react"
import { Thermometer } from "lucide-react"
import PanelHeader from "@/components/PanelHeader"
import { Card, CardContent } from "@/components/ui/card"
import type { HeatZonePoint, HeatZonesData } from "@/lib/api"
import type { PeriodKind } from "@/lib/period"
import { localTimeOf } from "@/lib/time"

// The zone timeline hero: one row per zone plus the outdoor reference
// row, all sharing one time axis that spans the period window, so
// temperatures align vertically across rows. Hand-built in the app's
// div-and-SVG chart idiom: shaded bands for the heating intervals, a
// solid temperature line and a lighter stepped setpoint line. Each
// row's chart carries a hover tooltip with that line's own figures:
// the nearest sample's time, temperature and setpoint.

const VIEW_W = 100
const VIEW_H = 40

// The tooltip's date half for periods longer than a day, the app's
// Europe/Amsterdam formatting convention.
const TOOLTIP_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Amsterdam",
})

// The sample nearest a hovered instant; rows are short enough that a
// linear scan is fine on every mouse move.
function nearestPoint(
  points: HeatZonePoint[],
  ms: number
): HeatZonePoint | null {
  if (points.length === 0) {
    return null
  }
  let best = points[0]
  let bestDelta = Infinity
  for (const point of points) {
    const delta = Math.abs(Date.parse(point.ts) - ms)
    if (delta < bestDelta) {
      bestDelta = delta
      best = point
    }
  }
  return best
}

// Time -> percentage across the shared window, clamped to the axis.
function timePct(ms: number, fromMs: number, toMs: number): number {
  return Math.min(100, Math.max(0, ((ms - fromMs) / (toMs - fromMs)) * 100))
}

// Temperature -> viewBox y, scaled to one row's own range with padding.
function rowScale(points: HeatZonePoint[]) {
  let lo = Infinity
  let hi = -Infinity
  for (const point of points) {
    lo = Math.min(lo, point.temp)
    hi = Math.max(hi, point.temp)
    if (point.setpoint !== null) {
      lo = Math.min(lo, point.setpoint)
      hi = Math.max(hi, point.setpoint)
    }
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2
    lo = mid - 1
    hi = mid + 1
  }
  const pad = Math.min(2, (hi - lo) * 0.15)
  lo -= pad
  hi += pad
  return (temp: number) =>
    4 + (1 - (temp - lo) / (hi - lo)) * (VIEW_H - 8)
}

// The solid temperature path. A single sample renders as a short
// vertical tick, since a zero-length path draws nothing.
function temperaturePath(
  points: HeatZonePoint[],
  fromMs: number,
  toMs: number
): string {
  const y = rowScale(points)
  if (points.length === 1) {
    const x = timePct(Date.parse(points[0].ts), fromMs, toMs)
    const yy = y(points[0].temp)
    return `M ${x} ${yy - 1.5} L ${x} ${yy + 1.5}`
  }
  return points
    .map((point, index) => {
      const x = timePct(Date.parse(point.ts), fromMs, toMs)
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y(point.temp).toFixed(2)}`
    })
    .join(" ")
}

// The stepped setpoint path: horizontal to the next sample, then
// vertical to its value. Segments break where the setpoint is
// unknown (null).
function setpointPath(
  points: HeatZonePoint[],
  fromMs: number,
  toMs: number
): string {
  const y = rowScale(points)
  let path = ""
  let prevX: number | null = null
  let prevY: number | null = null
  for (const point of points) {
    if (point.setpoint === null) {
      prevX = null
      prevY = null
      continue
    }
    const x = timePct(Date.parse(point.ts), fromMs, toMs)
    const yy = y(point.setpoint)
    if (prevX === null || prevY === null) {
      path += `${path === "" ? "" : " "}M ${x.toFixed(2)} ${yy.toFixed(2)}`
    } else {
      path += ` L ${x.toFixed(2)} ${prevY.toFixed(2)} L ${x.toFixed(2)} ${yy.toFixed(2)}`
    }
    prevX = x
    prevY = yy
  }
  return path
}

// One timeline row: fixed-width label, then the chart area. Every row
// uses the same left column and flex-1 chart area, so the time axis
// lines up across all rows. Hovering the chart pins a thin guide line
// at the pointer's instant and floats a tooltip with that row's own
// line figures: the nearest sample's time, temperature and setpoint.
function TimelineRow({
  label,
  points,
  intervals,
  fromMs,
  toMs,
  nowMs,
  showNow,
  lineClass,
  withSetpoint,
  kind,
}: {
  label: string
  points: HeatZonePoint[]
  intervals: { from: string; to: string }[]
  fromMs: number
  toMs: number
  nowMs: number
  showNow: boolean
  lineClass: string
  withSetpoint: boolean
  kind: PeriodKind
}) {
  const stepD = withSetpoint ? setpointPath(points, fromMs, toMs) : ""
  // The hovered instant, in window milliseconds; the tooltip reads
  // the sample nearest it.
  const [hoverMs, setHoverMs] = useState<number | null>(null)
  const hovered =
    hoverMs === null ? null : nearestPoint(points, hoverMs)
  const hoverPct =
    hoverMs === null
      ? null
      : Math.min(100, Math.max(0, ((hoverMs - fromMs) / (toMs - fromMs)) * 100))
  const hoveredTimeLabel =
    hovered === null
      ? ""
      : kind === "day"
        ? localTimeOf(hovered.ts)
        : `${TOOLTIP_DATE.format(new Date(hovered.ts))} ${localTimeOf(hovered.ts)}`
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-sm text-muted-foreground sm:w-28 lg:w-32">
        {label}
      </span>
      <div
        className="relative h-10 min-w-0 flex-1"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const frac = Math.min(
            1,
            Math.max(0, (event.clientX - rect.left) / rect.width)
          )
          setHoverMs(fromMs + frac * (toMs - fromMs))
        }}
        onMouseLeave={() => setHoverMs(null)}
      >
        {intervals.map((interval, index) => {
          const from = timePct(Date.parse(interval.from), fromMs, toMs)
          const to = timePct(Date.parse(interval.to), fromMs, toMs)
          return (
            <div
              key={index}
              className="absolute inset-y-0 rounded-sm bg-amber-500/15"
              style={{ left: `${from}%`, width: `${Math.max(to - from, 0.4)}%` }}
              aria-hidden="true"
            />
          )
        })}
        {showNow && nowMs >= fromMs && nowMs <= toMs && (
          <div
            className="absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: `${timePct(nowMs, fromMs, toMs)}%` }}
            aria-hidden="true"
          />
        )}
        {hoverPct !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/20"
            style={{ left: `${hoverPct}%` }}
            aria-hidden="true"
          />
        )}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {withSetpoint && stepD !== "" && (
            <path
              d={stepD}
              fill="none"
              className="stroke-muted-foreground/60"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={temperaturePath(points, fromMs, toMs)}
            fill="none"
            className={lineClass}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {hovered !== null && hoverPct !== null && (
          <div
            className="pointer-events-none absolute top-1/2 z-10 min-w-36 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
            style={{ left: `${Math.min(Math.max(hoverPct, 12), 88)}%` }}
          >
            <p className="text-xs font-medium">
              {label} &middot; {hoveredTimeLabel}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {`${hovered.temp.toFixed(1)} \u00b0C`}
            </p>
            {withSetpoint && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {hovered.setpoint === null
                  ? "setpoint unknown"
                  : `setpoint ${hovered.setpoint.toFixed(1)} \u00b0C`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Axis ticks: hour marks for a day, day marks for a week and month,
// month marks for a year, positioned on the same shared axis. The
// labels come from the timestamps at the tick positions, so they
// follow the window rather than assuming ideal fractions.
function tickMarks(
  fromMs: number,
  toMs: number,
  kind: PeriodKind
): { pct: number; label: string }[] {
  const span = toMs - fromMs
  const at = (frac: number) => new Date(fromMs + frac * span)
  const labelAt = (frac: number, options: Intl.DateTimeFormatOptions) =>
    at(frac).toLocaleDateString("en-GB", options)
  switch (kind) {
    case "day":
      return [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
        pct: frac * 100,
        label: String(Math.round(frac * 24)).padStart(2, "0"),
      }))
    case "week":
      return Array.from({ length: 7 }, (_, day) => ({
        pct: (day / 7) * 100,
        label: labelAt(day / 7, { weekday: "short", day: "numeric" }),
      }))
    case "month": {
      const days = Math.round(span / 86_400_000)
      return [1, 8, 15, 22]
        .filter((day) => day <= days)
        .map((day) => ({ pct: ((day - 1) / days) * 100, label: String(day) }))
    }
    case "year":
      return Array.from({ length: 12 }, (_, month) => ({
        pct: (month / 12) * 100,
        label: labelAt(month / 12, { month: "short" }),
      }))
  }
}

function TickRow({
  fromMs,
  toMs,
  kind,
}: {
  fromMs: number
  toMs: number
  kind: PeriodKind
}) {
  return (
    <div className="mt-1 flex items-center gap-3">
      <span className="w-24 shrink-0 sm:w-28 lg:w-32" aria-hidden="true" />
      <div className="relative h-4 min-w-0 flex-1 text-xs text-muted-foreground tabular-nums">
        {tickMarks(fromMs, toMs, kind).map((tick) => (
          <span
            key={`${tick.pct}-${tick.label}`}
            className="absolute top-0 -translate-x-1/2"
            style={{ left: `${tick.pct}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// The hero section: zone rows, the separated outdoor reference row,
// the shared axis with ticks and the now marker, and the legend with
// the inference caption. The caption covers every rendering of a
// heating interval on the page.
function ZoneTimeline({
  data,
  kind,
  showNow,
}: {
  data: HeatZonesData
  kind: PeriodKind
  showNow: boolean
}) {
  // The now marker follows the clock while the kiosk sits on the page.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const fromMs = Date.parse(data.window.start)
  const toMs = Date.parse(data.window.end)
  const outdoorPoints = data.outdoor.series.map((point) => ({
    ts: point.ts,
    temp: point.temp,
    setpoint: null,
  }))

  return (
    <Card>
      <PanelHeader
        icon={Thermometer}
        title="Zones"
        description="Per-zone temperature with setpoints and heating intervals"
      />
      <CardContent className="space-y-1.5">
        <div className="space-y-1.5">
          {data.zones.map((zone) => (
            <TimelineRow
              key={zone.key}
              label={zone.name}
              points={zone.series}
              intervals={zone.heatingIntervals}
              fromMs={fromMs}
              toMs={toMs}
              nowMs={nowMs}
              showNow={showNow}
              lineClass="stroke-foreground"
              withSetpoint={true}
              kind={kind}
            />
          ))}
        </div>
        <div className="mt-3 border-t pt-3">
          <TimelineRow
            label="Outdoor"
            points={outdoorPoints}
            intervals={[]}
            fromMs={fromMs}
            toMs={toMs}
            nowMs={nowMs}
            showNow={showNow}
            lineClass="stroke-[#3d6470]"
            withSetpoint={false}
            kind={kind}
          />
        </div>
        <TickRow fromMs={fromMs} toMs={toMs} kind={kind} />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-foreground" aria-hidden="true" />
            Temperature
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded bg-muted-foreground/60"
              aria-hidden="true"
            />
            Setpoint
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-4 rounded-sm bg-amber-500/30"
              aria-hidden="true"
            />
            Heating (inferred)
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Heating intervals are inferred from the setpoint gap, not
          measured heat demand.
        </p>
      </CardContent>
    </Card>
  )
}

export default ZoneTimeline
