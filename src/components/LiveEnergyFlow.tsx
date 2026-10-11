import { Zap } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ARROW_TRIM,
  DIAGRAM_HEIGHT,
  DIAGRAM_WIDTH,
  NODE_RADIUS,
  buildFlowDiagram,
  type FlowData,
  type FlowEdge,
  type FlowNode,
  type Point,
} from "@/lib/flowDiagram"
import { useSummary } from "@/lib/useSummary"

// --- Render pass over the diagram data (see src/lib/flowDiagram.ts) ---
// A future illustrated house view replaces this pass without touching the
// data logic.

function FlowArrow({
  from,
  to,
  shift,
  color,
}: {
  from: Point
  to: Point
  shift: number
  color: string
}) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const ux = dx / length
  const uy = dy / length
  // Perpendicular shift so opposite arrows on the same segment are drawn
  // as parallel lines.
  const px = -uy * shift
  const py = ux * shift
  const start = {
    x: from.x + px + ux * ARROW_TRIM,
    y: from.y + py + uy * ARROW_TRIM,
  }
  const tip = {
    x: to.x + px - ux * ARROW_TRIM,
    y: to.y + py - uy * ARROW_TRIM,
  }
  const lineEnd = { x: tip.x - ux * 12, y: tip.y - uy * 12 }
  const left = {
    x: tip.x - ux * 13 - uy * 6,
    y: tip.y - uy * 13 + ux * 6,
  }
  const right = {
    x: tip.x - ux * 13 + uy * 6,
    y: tip.y - uy * 13 - ux * 6,
  }
  return (
    <g>
      <line
        x1={start.x}
        y1={start.y}
        x2={lineEnd.x}
        y2={lineEnd.y}
        stroke={color}
        strokeWidth={2.5}
      />
      <polygon
        points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
        fill={color}
      />
    </g>
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

// An edge value chip: the watt figure in a pill with the page card
// background so the number reads clearly against the arrow.
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
      {edge.value} W
    </div>
  )
}

// Renders the diagram data: arrows in SVG, nodes and value chips as
// overlays, in an aspect-locked box that fills the widget width.
function FlowDiagram({ data }: { data: FlowData }) {
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
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Live energy flow diagram"
      >
        {data.edges.map((edge) => (
          <FlowArrow
            key={edge.key}
            from={edge.from}
            to={edge.to}
            shift={edge.shift}
            color={edge.color}
          />
        ))}
        {!data.hasFlow && (
          <text
            x={DIAGRAM_WIDTH / 2}
            y={DIAGRAM_HEIGHT / 2 + 6}
            fontSize="12"
            textAnchor="middle"
            fill="currentColor"
            opacity="0.6"
          >
            no active flow
          </text>
        )}
      </svg>
      {data.edges.map((edge) => (
        <FlowEdgeChip key={edge.key} edge={edge} />
      ))}
      {data.nodes.map((node) => (
        <FlowNodeView key={node.key} node={node} />
      ))}
    </div>
  )
}

// The live energy flow widget: the flow snapshot from /api/summary drawn
// as four nodes (Sun, Home, Grid in a row, Battery below Home) with
// arrow value chips at the stat card value size.
function LiveEnergyFlow() {
  const { summary, status } = useSummary()

  if (status === "loading") {
    return (
      <div
        className="min-h-72 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="size-5" aria-hidden="true" />
          Live energy flow
        </CardTitle>
        <CardDescription>
          Power between sun, home, grid and battery
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <FlowDiagram data={buildFlowDiagram(summary)} />
      </CardContent>
    </Card>
  )
}

export default LiveEnergyFlow
