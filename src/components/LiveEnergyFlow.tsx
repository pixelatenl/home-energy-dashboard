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
// grid and battery stay circular nodes around it. Every connection uses
// the shared base line styles; only the animated dash overlays carry
// per-flow colors.

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

// --- Shared flow line style (the only definition; every connection
// renders from it) ---
// Every line, active and inactive, rides the same translucent white
// band: on the light day sky the band lifts the dashes' contrast; on
// the dark night sky it glows softly. The dashes on top are the only
// difference: colored and animated for active flows (solar yellow,
// grid deep indigo, battery green), soft light gray and static for
// inactive ones. No borders anywhere.
const FLOW_BAND = "rgba(255, 255, 255, 0.5)"
const INACTIVE_DASH = "#b6c2d4"

// One flow line: the shared white band, then the dashes - animated and
// in the flow's color when it carries power, static light gray when it
// does not. Dash speed and line weight scale with power; the dashes
// travel along the path direction, so a reversed flow travels its own
// line the other way.
function FlowLine({ edge }: { edge: FlowEdge }) {
  const active = edge.active && edge.value !== null
  const value = edge.value ?? 0
  const width = active ? flowWidth(value) : 2
  return (
    <g className="flow-shadow">
      <path
        d={edge.path}
        fill="none"
        stroke={FLOW_BAND}
        strokeWidth={width + 3}
        strokeLinecap="round"
      />
      <path
        d={edge.path}
        fill="none"
        stroke={active ? edge.color : INACTIVE_DASH}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray="10 14"
        className={active ? "flow-dash" : undefined}
        style={
          active
            ? { animationDuration: `${flowDuration(value).toFixed(2)}s` }
            : undefined
        }
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

// A node: a circle with a solid card fill carrying its icon, name and
// live figure, so it reads on any sky.
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
        style={{ width: NODE_ICON, height: NODE_ICON, color: node.iconColor }}
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
          className="whitespace-nowrap leading-none tabular-nums opacity-70"
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
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border/70 bg-card px-2.5 py-1 font-semibold leading-none tabular-nums shadow-sm"
      style={{
        left: `${(HOME_LABEL.x / DIAGRAM_WIDTH) * 100}%`,
        top: `${(HOME_LABEL.y / DIAGRAM_HEIGHT) * 100}%`,
        fontSize: NODE_TEXT,
      }}
    >
      <span className="mr-1 font-medium opacity-70">{node.name}</span>
      {node.figure}
    </div>
  )
}

// An edge value chip: the watt figure in a solid pill with dark text on
// the card background, so the number reads on any sky gradient.
function FlowEdgeChip({ edge }: { edge: FlowEdge }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border/70 bg-card px-2 py-0.5 font-semibold leading-none tabular-nums text-card-foreground shadow-sm"
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
            className="flex items-center gap-2.5 rounded-lg border-2 bg-card p-2.5"
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

  const diagram = buildFlowDiagram(summary)

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
