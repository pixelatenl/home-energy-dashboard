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
// grid and battery stay circular nodes around it, connected by animated
// dashed lines.

// Line weight grows with power: 2 px at the flow threshold up to 8 px at
// high power; the sqrt scaling keeps midrange values readable.
const FLOW_THRESHOLD_W = 25
const FLOW_WIDTH_MAX_W = 4000

function flowWidth(value: number): number {
  const t = Math.min(Math.max(value / FLOW_WIDTH_MAX_W, 0), 1)
  return 2 + 6 * Math.sqrt(t)
}

// Dash cycle length in seconds: near-still at the threshold, about one
// second at high power.
function flowDuration(value: number): number {
  const seconds = 12 * Math.sqrt(FLOW_THRESHOLD_W / value)
  return Math.min(12, Math.max(1, seconds))
}

// One flow line. Active flows are dashed and animated: the dashes travel
// along the path in the direction it is drawn - every flow direction is
// its own path, so a reversed flow (battery discharging, grid export)
// simply travels its own line the other way. Line weight and dash speed
// scale with power. Zero or unknown flows render as faint static lines.
function FlowLine({ edge }: { edge: FlowEdge }) {
  if (!edge.active || edge.value === null) {
    return (
      <path
        d={edge.path}
        fill="none"
        stroke={edge.color}
        strokeWidth={2}
        opacity={0.25}
      />
    )
  }
  const value = edge.value
  return (
    <path
      d={edge.path}
      fill="none"
      stroke={edge.color}
      strokeWidth={flowWidth(value)}
      strokeDasharray="10 14"
      className="flow-dash"
      style={{ animationDuration: `${flowDuration(value).toFixed(2)}s` }}
    />
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

// A node: a circle carrying its icon, name and live figure. Body text
// size, scaling with the diagram via container query units.
function FlowNodeView({ node }: { node: FlowNode }) {
  const Icon = node.icon
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border-2 bg-card text-center"
      style={{
        left: `${(node.x / DIAGRAM_WIDTH) * 100}%`,
        top: `${(node.y / DIAGRAM_HEIGHT) * 100}%`,
        width: `${((NODE_RADIUS * 2) / DIAGRAM_WIDTH) * 100}%`,
        aspectRatio: "1",
        borderColor: node.borderColor ?? "var(--color-border)",
      }}
    >
      <Icon
        className="shrink-0"
        style={{ width: "2.9cqw", height: "2.9cqw", color: node.iconColor }}
        aria-hidden="true"
      />
      <span
        className="whitespace-nowrap font-medium leading-none"
        style={{ fontSize: "max(0.8rem, 2.2cqw)" }}
      >
        {node.name}
      </span>
      <span
        className="whitespace-nowrap font-semibold leading-none tabular-nums"
        style={{ fontSize: "max(0.8rem, 2.2cqw)" }}
      >
        {node.figure}
      </span>
      {node.sub && (
        <span
          className="whitespace-nowrap leading-none tabular-nums opacity-70"
          style={{ fontSize: "max(0.7rem, 1.9cqw)" }}
        >
          {node.sub}
        </span>
      )}
    </div>
  )
}

// The home node: the house illustration with its consumption figure in a
// pill below the drawing.
function HomeLabel({ node }: { node: FlowNode }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border/70 bg-card px-2.5 py-1 font-semibold leading-none tabular-nums shadow-sm"
      style={{
        left: `${(HOME_LABEL.x / DIAGRAM_WIDTH) * 100}%`,
        top: `${(HOME_LABEL.y / DIAGRAM_HEIGHT) * 100}%`,
        fontSize: "max(0.8rem, 2.2cqw)",
      }}
    >
      <span className="mr-1 font-medium opacity-70">{node.name}</span>
      {node.figure}
    </div>
  )
}

// An edge value chip: the watt figure in a pill with the page card
// background so the number reads clearly against the flow line.
function FlowEdgeChip({ edge }: { edge: FlowEdge }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border/70 bg-card font-semibold leading-none tabular-nums shadow-sm"
      style={{
        left: `${(edge.chip.x / DIAGRAM_WIDTH) * 100}%`,
        top: `${(edge.chip.y / DIAGRAM_HEIGHT) * 100}%`,
        fontSize: "max(0.75rem, 2.2cqw)",
        padding: "0.2cqw 0.7cqw",
      }}
    >
      {edge.value === null ? "\u2014" : `${edge.value} W`}
    </div>
  )
}

// Renders the diagram data: the house and flow lines in SVG, nodes and
// value chips as overlays, in an aspect-locked box that fills the widget
// width. Chips only appear on active flows. On the dark night, sunset
// and dusk skies the inherited currentColor turns light so the "no
// active flow" note stays legible.
function FlowDiagram({ data, onDark }: { data: FlowData; onDark: boolean }) {
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

// The live energy flow widget: the flow snapshot from /api/summary drawn
// around the house illustration - Solar top left, Battery bottom left,
// Grid bottom right - with orthogonal animated dashed flow lines and
// value chips at the stat card value size, over a time-of-day sky.
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

  return (
    <Card className="relative">
      {/* The sky fills the card behind everything; content sits above it. */}
      <TimeOfDayBackground phase={phase} sunProgress={sunProgress} />
      <CardHeader className="relative z-10">
        {/* Same muted panel background as the charts. */}
        <div className="rounded-xl bg-muted/30 p-4">
          <CardTitle
            className={`flex items-center gap-2 transition-colors duration-[2500ms] ${
              onDark ? "text-white" : ""
            }`}
          >
            <Zap className="size-5" aria-hidden="true" />
            Live energy flow
          </CardTitle>
          <CardDescription
            className={`transition-colors duration-[2500ms] ${
              onDark ? "text-white/75" : ""
            }`}
          >
            Power between solar, home, grid and battery
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="relative z-10 flex justify-center">
        <FlowDiagram data={buildFlowDiagram(summary)} onDark={onDark} />
      </CardContent>
    </Card>
  )
}

export default LiveEnergyFlow
