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

// The live energy flow widget: the flow snapshot from /api/summary drawn
// around the house illustration - Solar top left, Battery bottom left,
// Grid bottom right - with rounded flow lines carrying traveling
// pulses and value chips at the stat card value size, over a
// time-of-day sky. The compact today charts that used to ride beneath
// the flow live in their own widget now (src/components/TodayCharts.tsx).
function LiveEnergyFlow() {
  const { summary, status } = useSummary()
  const { phase, sunProgress, onDark } = useTimeOfDayPhase()

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
    </Card>
  )
}

export default LiveEnergyFlow
