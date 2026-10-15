import { useCallback, useEffect, useState } from "react"
import { Zap } from "lucide-react"
import houseUrl from "@/house.png"
import TimeOfDayBackground from "@/components/TimeOfDayBackground"
import { useTimeOfDayPhase } from "@/lib/timeOfDay"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  fetchWeatherHourly,
  type BatteryFlowHour,
  type PvFlowHour,
  type WeatherHour,
} from "@/lib/api"
import {
  SOLAR_COLOR,
  DISCHARGING_COLOR,
  GRID_IMPORT_COLOR,
  DIAGRAM_WIDTH,
  DIAGRAM_HEIGHT,
  HOME_LABEL,
  HOUSE_IMAGE,
  NODE_RADIUS,
  buildFlowDiagram,
  type FlowData,
  type FlowEdge,
  type FlowNode,
} from "@/lib/flowDiagram"
import { useSummary } from "@/lib/useSummary"
import { useDataRefreshListener } from "@/lib/useDataRefresh"
import { amsterdamNow, todayInAmsterdam, localHourFractionOf } from "@/lib/time"

// --- Render pass over the diagram data (see src/lib/flowDiagram.ts) ---
// The home node is the house illustration from src/house.png, embedded
// inside the SVG so the flow lines share its coordinate space; solar,
// grid and battery stay rounded gradient tiles around it. Every
// connection renders from the shared base line styles; only the
// traveling pulses carry per-flow colors.

// Line weight grows with power: 1.5 px at the flow threshold up to 4.5
// px at high power; the sqrt scaling keeps midrange values readable.
const FLOW_THRESHOLD_W = 25
const FLOW_WIDTH_MAX_W = 4000

function flowWidth(value: number): number {
  const t = Math.min(Math.max(value / FLOW_WIDTH_MAX_W, 0), 1)
  return 1.5 + 3 * Math.sqrt(t)
}

// Crossing time in seconds: how long the traveling pulse takes to run
// one line - about six seconds near the threshold, under a second at
// high power.
function flowDuration(value: number): number {
  const seconds = 6 * Math.sqrt(FLOW_THRESHOLD_W / value)
  return Math.min(6, Math.max(0.7, seconds))
}

// --- Shared flow line style (the only definition; every connection
// renders from it) ---
// Every active line shares one base style - the grid line's deep
// indigo at reduced opacity under the translucent white band - so the
// flow identity lives entirely in the colored traveling pulse on top
// (solar orange, grid indigo, battery state color). Inactive lines
// are a single 1px white line at half opacity - present, but visually
// quiet. No borders anywhere.
const FLOW_BAND = "rgba(255, 255, 255, 0.5)"
const ACTIVE_BASE_COLOR = GRID_IMPORT_COLOR
const INACTIVE_LINE = "rgba(255, 255, 255, 0.3)"

// The traveling pulse, in path-length fractions: every pulse path
// carries pathLength="1", so these are the same for every edge. The
// comet covers 15 percent of its line, then a gap of one full line
// length before it re-enters at the start - one pulse per line,
// wrapping seamlessly every 1.15 path lengths, the cycle the
// flow-pulse keyframe in index.css matches.
const PULSE_FRACTION = 0.15
const PULSE_CYCLE = 1 + PULSE_FRACTION

// One flow line: the shared base line with the flow's bright pulse
// traveling along it when it carries power, a thin translucent white
// line when it does not. Pulse speed and line weight scale with power;
// the pulse travels along the path direction, so a reversed flow runs
// its own line the other way.
function FlowLine({ edge }: { edge: FlowEdge }) {
  const active = edge.active && edge.value !== null
  const value = edge.value ?? 0
  const width = flowWidth(value)
  if (!active) {
    return (
      <path
        d={edge.path}
        fill="none"
        stroke={INACTIVE_LINE}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
      />
    )
  }
  return (
    <g className="flow-shadow">
      <path
        d={edge.path}
        fill="none"
        stroke={FLOW_BAND}
        strokeWidth={width + 2}
        strokeLinecap="round"
      />
      <path
        d={edge.path}
        fill="none"
        stroke={ACTIVE_BASE_COLOR}
        strokeOpacity={0.45}
        strokeWidth={width}
        strokeLinecap="round"
      />
      <path
        d={edge.path}
        pathLength={1}
        fill="none"
        stroke={edge.color}
        strokeWidth={width + 1}
        strokeLinecap="round"
        strokeDasharray={`${PULSE_FRACTION} 1`}
        className="flow-pulse"
        style={{
          animationDuration: `${(flowDuration(value) * PULSE_CYCLE).toFixed(2)}s`,
        }}
      />
    </g>
  )
}

// The house illustration, embedded as the reference image for the home
// node, drawn behind the flow lines.
function HouseImage() {
  return (
    <image
      href={houseUrl}
      x={HOUSE_IMAGE.x}
      y={HOUSE_IMAGE.y}
      width={HOUSE_IMAGE.width}
      height={HOUSE_IMAGE.height}
    />
  )
}

// Responsive node typography: nothing falls below a readable size on
// phones, nothing grows past the diagram's design size on desktop.
const NODE_TEXT = "clamp(0.7rem, 2.5vw, 0.9rem)"
const NODE_SUB_TEXT = "clamp(0.65rem, 2.3vw, 0.8rem)"
const NODE_ICON = "clamp(0.9rem, 3vw, 1.15rem)"

// A node: a rounded-corner square tile carrying its icon, name and
// live figure over its flow's gradient (see the palette in
// flowDiagram.ts) - deep behind the icon, vivid under the figures -
// with white text, a soft white border and the card's shadow for lift.
// The battery tile follows its state color; the home node stays the
// house illustration and never renders here.
function FlowNodeView({ node }: { node: FlowNode }) {
  const Icon = node.icon
  const gradient = node.gradient ?? null
  return (
    <div
      className={`absolute flex aspect-square -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-xl border text-center shadow-card ${
        gradient ? "border-white/25 text-white" : "bg-background"
      }`}
      style={{
        left: `${(node.x / DIAGRAM_WIDTH) * 100}%`,
        top: `${(node.y / DIAGRAM_HEIGHT) * 100}%`,
        width: `${((NODE_RADIUS * 2) / DIAGRAM_WIDTH) * 100}%`,
        background: gradient ?? undefined,
        borderColor: gradient ? undefined : node.borderColor ?? "var(--color-border)",
      }}
    >
      <Icon
        className="shrink-0"
        style={{
          width: NODE_ICON,
          height: NODE_ICON,
          color: gradient ? "#ffffff" : node.iconColor,
        }}
        aria-hidden="true"
      />
      <span
        className="whitespace-nowrap font-medium leading-none"
        style={{ fontSize: NODE_TEXT }}
      >
        {node.name}
      </span>
      <span
        className="whitespace-nowrap font-semibold leading-none tabular-nums"
        style={{ fontSize: NODE_TEXT }}
      >
        {node.figure}
      </span>
      {node.sub && (
        <span
          className="whitespace-nowrap leading-none tabular-nums opacity-80"
          style={{ fontSize: NODE_SUB_TEXT }}
        >
          {node.sub}
        </span>
      )}
    </div>
  )
}

// The home node: the house illustration with its consumption figure in a
// solid pill below the drawing.
function HomeLabel({ node }: { node: FlowNode }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border/70 bg-background px-2.5 py-1 font-semibold leading-none tabular-nums shadow-sm"
      style={{
        left: `${(HOME_LABEL.x / DIAGRAM_WIDTH) * 100}%`,
        top: `${(HOME_LABEL.y / DIAGRAM_HEIGHT) * 100}%`,
        fontSize: NODE_TEXT,
      }}
    >
      <span className="mr-1 font-medium">{node.name}</span>
      {node.figure}
    </div>
  )
}

// An edge value chip: the watt figure in a solid pill on the
// background surface, so the number reads on any sky gradient.
function FlowEdgeChip({ edge }: { edge: FlowEdge }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border/70 bg-background px-2 py-0.5 font-semibold leading-none tabular-nums text-card-foreground shadow-sm"
      style={{
        left: `${(edge.chip.x / DIAGRAM_WIDTH) * 100}%`,
        top: `${(edge.chip.y / DIAGRAM_HEIGHT) * 100}%`,
        fontSize: NODE_TEXT,
      }}
    >
      {edge.value === null ? "\u2014" : `${edge.value} W`}
    </div>
  )
}

// Renders the diagram data: the house and flow lines in SVG, nodes and
// value chips as overlays, in an aspect-locked box that fills the widget
// width. Chips only appear on active flows. On the dark night sky the
// inherited currentColor turns light so the "no active flow" note stays
// legible.
function FlowDiagram({
  data,
  onDark,
}: {
  data: FlowData
  onDark: boolean
}) {
  return (
    <div
      className="relative mx-auto w-full max-w-[720px]"
      style={{
        aspectRatio: `${DIAGRAM_WIDTH} / ${DIAGRAM_HEIGHT}`,
        containerType: "inline-size",
      }}
    >
      <svg
        viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}
        preserveAspectRatio="none"
        className={`absolute inset-0 h-full w-full transition-colors duration-[2500ms] ${
          onDark ? "text-white" : ""
        }`}
        role="img"
        aria-label="Live energy flow diagram"
      >
        <HouseImage />
        {data.edges.map((edge) => (
          <FlowLine key={edge.key} edge={edge} />
        ))}
        {!data.hasFlow && (
          <text
            x={DIAGRAM_WIDTH / 2}
            y={580}
            fontSize="12"
            textAnchor="middle"
            fill="currentColor"
            opacity="0.6"
          >
            no active flow
          </text>
        )}
      </svg>
      {data.edges
        .filter((edge) => edge.active)
        .map((edge) => (
          <FlowEdgeChip key={edge.key} edge={edge} />
        ))}
      {data.nodes.map((node) =>
        node.key === "home" ? (
          <HomeLabel key={node.key} node={node} />
        ) : (
          <FlowNodeView key={node.key} node={node} />
        )
      )}
    </div>
  )
}

// Simplified stacked layout for phone widths, where the diamond diagram
// becomes cramped: one row per node with its live value in a chip.
function StackedNodes({ data }: { data: FlowData }) {
  return (
    <div className="space-y-2">
      {data.nodes.map((node) => {
        const Icon = node.icon
        return (
          <div
            key={node.key}
            className="flex items-center gap-2.5 rounded-lg border-2 bg-background p-2.5"
            style={{ borderColor: node.borderColor ?? "var(--color-border)" }}
          >
            <Icon
              className="size-5 shrink-0"
              style={{ color: node.iconColor }}
              aria-hidden="true"
            />
            <span className="text-sm font-medium">{node.name}</span>
            {node.sub && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {node.sub}
              </span>
            )}
            <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums">
              {node.figure}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// --- Compact today charts under the flow diagram ---
// Two muted charts so the animated flow lines stay the hero's visual
// lead: actual hourly solar production against the forecast curve, and
// hourly battery charge versus discharge. Each leads with its day
// total so the curves read with their value, and both ride the same
// full-day time axis with a shared now marker, on the glass treatment
// the hero header uses. No axes or gridlines; the flow above carries
// the emotional weight, these carry the numbers.

// Shared chart geometry: a wide, short viewBox stretched to the block
// width; strokes use non-scaling so the stretch does not distort them.
const TODAY_CHART_W = 240
const TODAY_CHART_H = 48

// Palette: the flow's solar yellow for actual production; the battery
// panel's green/amber pair for charge and discharge.
const CHARGING_COLOR = "hsl(140 70% 45%)"

// Glass panel around one chart block, matching the hero header and the
// AI summary's glass furniture.
const TODAY_CHART_PANEL =
  "rounded-xl border border-white/20 bg-white/15 p-3 backdrop-blur-sm"

// Label styling: the hero's on-dark transition so the titles read on
// both skies.
function todayChartLabelClass(onDark: boolean): string {
  return `text-xs font-medium transition-colors duration-[2500ms] ${
    onDark ? "text-white" : ""
  }`
}

// The headline figure's styling: the same on-dark transition, one
// weight up from the label - the chart's value, stated in numbers.
function todayChartValueClass(onDark: boolean): string {
  return `mt-1 text-sm font-semibold tabular-nums transition-colors duration-[2500ms] ${
    onDark ? "text-white" : ""
  }`
}

// The now marker's x position for the full-day 0-24h axis.
function nowXOf(nowFraction: number): number {
  return (Math.min(Math.max(nowFraction, 0), 24) / 24) * TODAY_CHART_W
}

// Legend styling: the fine-print register with the same on-dark
// transition as the labels.
function todayChartLegendClass(onDark: boolean): string {
  return `mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs transition-colors duration-[2500ms] ${
    onDark ? "text-white" : "text-muted-foreground"
  }`
}

// The solar chart's legend: the produced line's yellow against the
// dashed forecast curve's white, with matching swatch shapes.
function TodaySolarLegend({ onDark }: { onDark: boolean }) {
  return (
    <div className={todayChartLegendClass(onDark)}>
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-4 rounded-sm"
          style={{ backgroundColor: SOLAR_COLOR }}
        />
        Produced
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line
            x1="1"
            y1="4"
            x2="15"
            y2="4"
            stroke="white"
            strokeOpacity={0.55}
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        </svg>
        Forecast
      </span>
    </div>
  )
}

// The battery chart's legend: the bar pair's green and amber.
function TodayBatteryLegend({ onDark }: { onDark: boolean }) {
  return (
    <div className={todayChartLegendClass(onDark)}>
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-4 rounded-sm"
          style={{ backgroundColor: CHARGING_COLOR, opacity: 0.7 }}
        />
        Charged
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-4 rounded-sm"
          style={{ backgroundColor: DISCHARGING_COLOR, opacity: 0.7 }}
        />
        Discharged
      </span>
    </div>
  )
}

// "Solar today": the day's production total as the headline figure,
// then the actual hourly production (from the summary's
// pv_flow_hourly) as a stepped subtle area in the flow's solar
// yellow, with the hourly forecast curve (estimated_pv_wh) as a
// dashed overlay.
function TodaySolarChart({
  actual,
  forecast,
  onDark,
  nowFraction,
  producedKwh,
}: {
  actual: PvFlowHour[]
  forecast: WeatherHour[] | null
  onDark: boolean
  nowFraction: number
  producedKwh: number | null
}) {
  // kWh per local hour, both series on the same scale.
  const actualByHour = new Array<number>(24).fill(0)
  for (const hour of actual) {
    actualByHour[localHourFractionOf(hour.ts) | 0] += hour.kwh
  }
  const forecastByHour = new Array<number>(24).fill(0)
  for (const hour of forecast ?? []) {
    forecastByHour[Number(hour.hour.slice(11, 13))] =
      hour.estimated_pv_wh / 1000
  }
  const maxKwh = Math.max(
    ...actualByHour,
    ...forecastByHour,
    0.1
  )
  const y = (kwh: number) => TODAY_CHART_H - (kwh / maxKwh) * (TODAY_CHART_H - 4) - 2
  // Stepped area under the actual production line, closed at the base.
  const stepPoints: string[] = []
  for (let hour = 0; hour < 24; hour += 1) {
    const left = (hour / 24) * TODAY_CHART_W
    const right = ((hour + 1) / 24) * TODAY_CHART_W
    const top = y(actualByHour[hour])
    stepPoints.push(`${left},${top} ${right},${top}`)
  }
  const areaPoints = `0,${TODAY_CHART_H} ${stepPoints.join(" ")} ${TODAY_CHART_W},${TODAY_CHART_H}`
  // Forecast curve through the hour midpoints, dashed.
  const forecastPoints = forecastByHour
    .map((kwh, hour) => `${((hour + 0.5) / 24) * TODAY_CHART_W},${y(kwh)}`)
    .join(" ")
  const hasForecast = forecast !== null && forecast.length > 0
  const hasActual = actual.some((hour) => hour.kwh > 0)

  return (
    <div className={TODAY_CHART_PANEL}>
      <p className={todayChartLabelClass(onDark)}>Solar today</p>
      <p className={todayChartValueClass(onDark)}>
        {producedKwh === null ? "\u2014" : `${producedKwh.toFixed(1)} kWh`}{" "}
        produced
      </p>
      {!hasActual && !hasForecast ? (
        <p className="mt-2 text-xs text-muted-foreground">No data yet</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${TODAY_CHART_W} ${TODAY_CHART_H}`}
            preserveAspectRatio="none"
            className="mt-1 h-20 w-full"
            role="img"
            aria-label="Hourly solar production today against the forecast"
          >
          <polygon points={areaPoints} fill={SOLAR_COLOR} opacity={0.25} />
          <polyline
            points={stepPoints.join(" ")}
            fill="none"
            stroke={SOLAR_COLOR}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {hasForecast && (
            <polyline
              points={forecastPoints}
              fill="none"
              stroke="white"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <line
            x1={nowXOf(nowFraction)}
            x2={nowXOf(nowFraction)}
            y1={0}
            y2={TODAY_CHART_H}
            stroke="white"
            strokeOpacity={0.5}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          </svg>
          <TodaySolarLegend onDark={onDark} />
        </>
      )}
    </div>
  )
}

// "Battery today": the day's charged and discharged totals as the
// headline figure, then the hourly charge as green bars up from the
// zero line and discharge as amber bars down, in the battery panel's
// colors, on the same full-day axis.
function TodayBatteryChart({
  flow,
  onDark,
  nowFraction,
  chargedKwh,
  dischargedKwh,
}: {
  flow: BatteryFlowHour[]
  onDark: boolean
  nowFraction: number
  chargedKwh: number | null
  dischargedKwh: number | null
}) {
  const zeroY = TODAY_CHART_H / 2
  const slot = TODAY_CHART_W / 24
  const byHour = new Map<number, { in: number; out: number }>()
  for (const hour of flow) {
    const key = localHourFractionOf(hour.ts) | 0
    const entry = byHour.get(key) ?? { in: 0, out: 0 }
    entry.in += hour.in_kwh
    entry.out += hour.out_kwh
    byHour.set(key, entry)
  }
  const maxKwh = Math.max(
    ...[...byHour.values()].map((entry) => Math.max(entry.in, entry.out)),
    0.1
  )
  const scale = (TODAY_CHART_H / 2 - 2) / maxKwh
  const hasFlow = byHour.size > 0

  return (
    <div className={TODAY_CHART_PANEL}>
      <p className={todayChartLabelClass(onDark)}>Battery today</p>
      <p className={todayChartValueClass(onDark)}>
        {chargedKwh === null ? "\u2014" : `${chargedKwh.toFixed(1)} kWh`}{" "}
        charged &middot;{" "}
        {dischargedKwh === null
          ? "\u2014"
          : `${dischargedKwh.toFixed(1)} kWh`}{" "}
        discharged
      </p>
      {!hasFlow ? (
        <p className="mt-2 text-xs text-muted-foreground">No data yet</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${TODAY_CHART_W} ${TODAY_CHART_H}`}
            preserveAspectRatio="none"
            className="mt-1 h-20 w-full"
            role="img"
            aria-label="Hourly battery charge and discharge today"
          >
          <line
            x1={0}
            x2={TODAY_CHART_W}
            y1={zeroY}
            y2={zeroY}
            stroke="white"
            strokeOpacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
          {[...byHour.entries()].map(([hour, entry]) => (
            <g key={hour}>
              {entry.in > 0 && (
                <rect
                  x={hour * slot + slot * 0.2}
                  y={zeroY - entry.in * scale}
                  width={slot * 0.6}
                  height={entry.in * scale}
                  fill={CHARGING_COLOR}
                  opacity={0.7}
                />
              )}
              {entry.out > 0 && (
                <rect
                  x={hour * slot + slot * 0.2}
                  y={zeroY}
                  width={slot * 0.6}
                  height={entry.out * scale}
                  fill={DISCHARGING_COLOR}
                  opacity={0.7}
                />
              )}
            </g>
          ))}
          <line
            x1={nowXOf(nowFraction)}
            x2={nowXOf(nowFraction)}
            y1={0}
            y2={TODAY_CHART_H}
            stroke="white"
            strokeOpacity={0.5}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          </svg>
          <TodayBatteryLegend onDark={onDark} />
        </>
      )}
    </div>
  )
}

// The live energy flow widget: the flow snapshot from /api/summary drawn
// around the house illustration - Solar top left, Battery bottom left,
// Grid bottom right - with rounded flow lines carrying traveling
// pulses and value chips at the stat card value size, over a
// time-of-day sky.
function LiveEnergyFlow() {
  const { summary, status } = useSummary()
  const { phase, sunProgress, onDark } = useTimeOfDayPhase()

  // The solar forecast curve for the compact solar chart: the hourly
  // weather endpoint's estimated PV per hour; null keeps the chart on
  // the actual production only. State is only updated after the
  // await, so this is safe to call from effects.
  const [forecastHours, setForecastHours] = useState<WeatherHour[] | null>(
    null
  )
  const loadForecast = useCallback(async () => {
    try {
      const result = await fetchWeatherHourly(todayInAmsterdam())
      setForecastHours(result.hours)
    } catch {
      setForecastHours(null)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void loadForecast()
  }, [loadForecast])

  // Re-fetch when the header refresh button fires.
  useDataRefreshListener(() => void loadForecast())

  // Ticks once a minute so the charts' now marker follows the clock.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const now = amsterdamNow(nowTick)

  if (status === "loading") {
    return (
      <div
        className="min-h-[480px] animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }

  const diagram = buildFlowDiagram(summary)

  return (
    <Card className="relative">
      {/* The sky fills the card behind everything; content sits above it. */}
      <TimeOfDayBackground phase={phase} sunProgress={sunProgress} />
      {/* Bottom scrim: darkens the lower area so the compact today
          charts pop against it (on the day sky especially). It sits
          above the sky and below the content, fading up. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#020211]/70 to-transparent"
        aria-hidden="true"
      />
      <CardHeader className="relative z-10">
        <CardTitle className="flex items-center gap-2 text-muted-foreground">
          <Zap className="size-6" aria-hidden="true" />
          Live energy flow
        </CardTitle>
        <CardDescription
          className={`transition-colors duration-[2500ms] ${
            onDark ? "text-white" : "text-foreground"
          }`}
        >
          Power between solar, home, grid and battery
        </CardDescription>
      </CardHeader>
      <CardContent className="relative z-10 flex justify-center">
        {/* The diamond diagram on wider screens; a simplified stacked
            list below 400 px, where the diagram gets cramped. */}
        <div className="hidden w-full min-[400px]:block">
          <FlowDiagram data={diagram} onDark={onDark} />
        </div>
        <div className="w-full min-[400px]:hidden">
          <StackedNodes data={diagram} />
        </div>
      </CardContent>
      {/* The compact today charts ride beneath the flow, subordinate to
          the animated flow lines: they stack on narrow widths and sit
          side by side from the sm breakpoint up. Each leads with its
          day total so the curves carry numbers, not just shape. */}
      <CardContent className="relative z-10">
        <div className="grid gap-3 sm:grid-cols-2">
          <TodaySolarChart
            actual={summary?.pv_flow_hourly ?? []}
            forecast={forecastHours}
            onDark={onDark}
            nowFraction={now.fraction}
            producedKwh={summary?.today.pv_kwh ?? null}
          />
          <TodayBatteryChart
            flow={summary?.battery_flow_hourly ?? []}
            onDark={onDark}
            nowFraction={now.fraction}
            chargedKwh={summary?.today.battery_charged_kwh ?? null}
            dischargedKwh={summary?.today.battery_discharged_kwh ?? null}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export default LiveEnergyFlow
