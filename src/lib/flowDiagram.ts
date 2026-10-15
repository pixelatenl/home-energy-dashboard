import { BatteryCharging, Home, Sun, UtilityPole } from "lucide-react"
import type { CSSProperties, ComponentType } from "react"
import type { BatteryState, SummaryData } from "@/lib/api"

// Flow palette - the colors of the flows' traveling pulses, the only
// per-flow difference in the diagram: solar warm orange, grid deep
// indigo for both directions (the pulse's direction of travel carries
// the flow direction), battery green for both directions (the
// widget's charging accent). The base lines under the pulses are one
// shared style in the render pass; the battery node keeps its
// state-dependent accent.
export const SOLAR_COLOR = "#f8ae17"
// The solar flows' pulse color: the palette yellow shifted darker and
// into orange, so the pulse stays visible against the bright day sky
// (the today chart keeps the lighter SOLAR_COLOR on its glass panel).
export const SOLAR_FLOW_COLOR = "#e58806"
export const CHARGING_COLOR = "hsl(140 70% 45%)"
export const DISCHARGING_COLOR = "#f59e0b"
export const GRID_IMPORT_COLOR = "#3b3fbf"
export const GRID_EXPORT_COLOR = GRID_IMPORT_COLOR
// The battery's idle accent: teal, between the charging green and the
// grid indigo, so a resting battery reads as "standing by" rather
// than disabled grey.
export const BATTERY_IDLE_COLOR = "hsl(185 65% 45%)"

// Node tile gradients: the rounded-square node surfaces, each accent
// blooming out of a deep shade of its own hue on the AI surfaces'
// diagonal - deep behind the icon, vivid under the figures - so the
// white icon and text stay legible on every hue. The battery tile
// follows its live state; idle and unavailable stay neutral slate.
const SOLAR_TILE_GRADIENT =
  "linear-gradient(135deg, hsl(40 94% 28%), hsl(40 94% 52%))"
const GRID_TILE_GRADIENT =
  "linear-gradient(135deg, hsl(238 53% 28%), hsl(238 53% 50%))"
const BATTERY_TILE_GRADIENTS: Record<BatteryState, string> = {
  charging: "linear-gradient(135deg, hsl(140 70% 24%), hsl(140 70% 45%))",
  discharging: "linear-gradient(135deg, hsl(38 93% 25%), hsl(38 93% 50%))",
  idle: "linear-gradient(135deg, hsl(185 65% 24%), hsl(185 65% 46%))",
  unavailable: "linear-gradient(135deg, hsl(185 65% 24%), hsl(185 65% 46%))",
}

// Diagram geometry in design units. The diagram box is aspect-locked and
// scales with the widget width; overlays position by percentage so the
// geometry here is resolution independent.
export const DIAGRAM_WIDTH = 900
export const DIAGRAM_HEIGHT = 680
export const NODE_RADIUS = 58

export interface Point {
  x: number
  y: number
}

// Node centers: Solar top left, Battery bottom left, Home (the house
// illustration) in the middle, Grid bottom right. Grid sits low so its
// line to the battery runs beneath the house instead of through it.
export const FLOW_POSITIONS: Record<
  "sun" | "home" | "battery" | "grid",
  Point
> = {
  sun: { x: 85, y: 130 },
  home: { x: 450, y: 300 },
  grid: { x: 830, y: 600 },
  battery: { x: 85, y: 600 },
}

// The house illustration (src/house.png), embedded inside the diagram SVG
// so the flows share its coordinate space. The square canvas of the
// source image maps onto this box.
export const HOUSE_IMAGE = {
  x: 250,
  y: 100,
  width: 400,
  height: 400,
}
// Where the home value pill sits: below the illustration.
export const HOME_LABEL: Point = { x: 450, y: 548 }

// Fixed flow anchors: points on the node tiles' edges and on the house
// illustration. The orthogonal routes are built from these exact
// coordinates, so every corner is exactly 90 degrees.
const ANCHORS = {
  solarRight: { x: 143, y: 130 },
  solarBottom: { x: 85, y: 188 },
  batteryTop: { x: 85, y: 542 },
  // Where the battery-to-home line leaves the tile's top edge, right
  // of the solar charging line at batteryTop.
  batteryTopRight: { x: 115, y: 542 },
  batteryRight: { x: 143, y: 600 },
  gridTop: { x: 830, y: 542 },
  gridLeft: { x: 772, y: 600 },
  // The export line lands on the tile's left edge high up; the circles
  // used to take it on the rim's diagonal, but the square's edge
  // reaches further out.
  gridUpperLeft: { x: 772, y: 559 },
  houseRoof: { x: 380, y: 175 },
  houseWallLeft: { x: 340, y: 350 },
  houseWallRightUpper: { x: 620, y: 320 },
  houseWallRightLower: { x: 620, y: 400 },
}

// Orthogonal flow routes: fixed waypoint lists where consecutive points
// share their x or y coordinate, so every segment is horizontal or
// vertical and every corner is exactly 90 degrees.
const ROUTES = {
  // Solar feeds the roof: right from the node, then down onto the roof.
  solar_to_home: [
    ANCHORS.solarRight,
    { x: 380, y: ANCHORS.solarRight.y },
    ANCHORS.houseRoof,
  ],
  // Solar can charge the battery straight down the left side.
  solar_to_battery: [ANCHORS.solarBottom, ANCHORS.batteryTop],
  // Grid import: up from the grid node, then left into the house.
  grid_to_home: [
    ANCHORS.gridTop,
    { x: ANCHORS.gridTop.x, y: ANCHORS.houseWallRightUpper.y },
    ANCHORS.houseWallRightUpper,
  ],
  // Grid export: out of the house, down, then right into the grid node.
  home_to_grid: [
    ANCHORS.houseWallRightLower,
    { x: 710, y: ANCHORS.houseWallRightLower.y },
    { x: 710, y: ANCHORS.gridUpperLeft.y },
    ANCHORS.gridUpperLeft,
  ],
  // Grid share of the battery charging runs beneath the house.
  grid_to_battery: [ANCHORS.gridLeft, ANCHORS.batteryRight],
  // The battery feeds the house: up from the node's top edge - right of
  // the solar charging line, well clear of the right edge so it does
  // not read as leaving from the side - then right into the wall.
  battery_to_home: [
    ANCHORS.batteryTopRight,
    { x: ANCHORS.batteryTopRight.x, y: ANCHORS.houseWallLeft.y },
    ANCHORS.houseWallLeft,
  ],
}

export type IconComponent = ComponentType<{
  className?: string
  style?: CSSProperties
}>

// A diagram node: position, caption and live figure. Pure data; the
// render pass turns it into a rounded gradient tile, or the house
// illustration for the home.
export interface FlowNode {
  key: string
  x: number
  y: number
  name: string
  figure: string
  sub?: string | null
  icon: IconComponent
  iconColor?: string
  borderColor?: string
  // The tile's surface: a per-flow gradient (see the palette above);
  // absent on the home node, whose surface is the illustration.
  gradient?: string
}

// A diagram flow: an SVG path of orthogonal segments with rounded
// corners, the live watt value, whether the flow is strong enough to
// animate (above the 25 W threshold), the color of its solid line and
// traveling pulse (the only per-flow styling; the contrast band and
// inactive lines are shared in the render pass), and the position of
// its value chip. Inactive and unknown (null) flows render as the
// shared dimmed base line with no overlay.
export interface FlowEdge {
  key: string
  path: string
  value: number | null
  active: boolean
  color: string
  chip: Point
}

// The corner radius of the flow lines' 90-degree bends, in design
// units; each bend clamps to half its adjacent legs so the fillet
// never overruns a short segment.
const CORNER_RADIUS = 24

// SVG path data for a polyline through the points, with every
// interior corner rounded: the path stops radius-short of the corner
// on the incoming leg and turns through a quadratic fillet centered on
// it, so the traveling pulse glides around each bend.
function polyline(points: Point[]): string {
  const parts = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]
    const corner = points[i]
    const next = points[i + 1]
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const after = Math.hypot(next.x - corner.x, next.y - corner.y)
    const radius = Math.min(CORNER_RADIUS, before / 2, after / 2)
    const ax = corner.x - ((corner.x - previous.x) / before) * radius
    const ay = corner.y - ((corner.y - previous.y) / before) * radius
    const bx = corner.x + ((next.x - corner.x) / after) * radius
    const by = corner.y + ((next.y - corner.y) / after) * radius
    parts.push(`L ${ax} ${ay}`, `Q ${corner.x} ${corner.y} ${bx} ${by}`)
  }
  const last = points[points.length - 1]
  parts.push(`L ${last.x} ${last.y}`)
  return parts.join(" ")
}

// The midpoint of a route's longest segment, where its value chip sits
// on its own straight run.
function longestSegmentMidpoint(points: Point[]): Point {
  let best = { x: 0, y: 0, length: -1 }
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    // Segments are axis-aligned, so the Manhattan length is exact.
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
    if (length > best.length) {
      best = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, length }
    }
  }
  return { x: best.x, y: best.y }
}

export interface FlowData {
  nodes: FlowNode[]
  edges: FlowEdge[]
  hasFlow: boolean
}

const isShown = (value: number | null): value is number =>
  value !== null && value > 25

// Clamps a nullable watt figure to a non-negative value; null stays null
// so absent sensors keep rendering as the shared inactive line.
function clampW(value: number | null): number | null {
  return value === null ? null : Math.max(0, value)
}

// Subtracts a nullable subtrahend, treating null as 0, and clamps at 0.
function subtractClamped(
  value: number | null,
  sub: number | null
): number | null {
  if (value === null) return null
  return Math.max(0, value - (sub ?? 0))
}

// Data logic: turns the flow snapshot into nodes and flows.
//
// Balance model (all instantaneous, in W):
//   home_load = solar_to_home + grid_to_home + battery_to_home
//
// The P1 grid figures (grid_import_w / grid_export_w) are NET values
// measured at the meter; the Anker battery_charge_w is a GROSS value on
// the AC side of the unit and includes its conversion losses. The grid
// share of the charging is therefore capped at the net import (a few
// percent of gross exceeds net), and every derived flow is clamped at
// zero, so the arrows can never contradict each other. A flow at or
// below 25 W (or unknown) renders as a faint static line. The Home
// figure is the sum of the active incoming flows, so the diagram always
// balances visually regardless of the individual series' refresh
// moments.
//
// Known limitation: with simultaneous import and export the P1 net
// figures hide both gross streams, so a negative grid_to_home is
// rendered as inactive rather than split into import and export.
export function buildFlowDiagram(summary: SummaryData | null): FlowData {
  const flow = summary?.flow

  // Raw sensor values. grid_import_w and grid_export_w are net P1
  // figures; battery_charge_w is the gross AC-side charging power.
  const pvW = flow?.pv_w ?? null
  const gridImportW = flow?.grid_import_w ?? null
  const gridExportW = flow?.grid_export_w ?? null
  const batterySolarInW = flow?.battery_solar_in_w ?? null
  const batteryChargeW = flow?.battery_charge_w ?? null
  const batteryDischargeW = flow?.battery_discharge_w ?? null

  // 1. Solar split: the panels that feed the Anker directly charge the
  // battery first; only their excess (and the rooftop inverter's share)
  // reaches the home. The direct solar input can never exceed PV
  // production, so it is capped.
  const solarToBattery =
    pvW !== null && batterySolarInW !== null
      ? Math.min(pvW, batterySolarInW)
      : batterySolarInW
  const solarToHome = subtractClamped(pvW, solarToBattery)

  // 2. Grid share of the battery charging: gross charging power minus the
  // solar share covered above, never negative, and never more than the
  // net grid import can supply (losses make gross exceed net by a few
  // percent; the cap absorbs that without double counting).
  const gridToBatteryUncapped = subtractClamped(batteryChargeW, solarToBattery)
  const gridToBattery =
    gridToBatteryUncapped !== null && gridImportW !== null
      ? Math.min(gridToBatteryUncapped, gridImportW)
      : gridToBatteryUncapped

  // 3. The grid import that is not charging the battery feeds the home.
  // After the cap this can never go negative.
  const gridToHome = subtractClamped(gridImportW, gridToBattery)

  // 4. The battery discharges only into the home; charging never renders
  // on this edge.
  const batteryToHome = clampW(batteryDischargeW)

  // 5. Export to the grid passes through unchanged.
  const homeToGrid = gridExportW

  const edges: FlowEdge[] = []
  // Adds a flow from its fixed orthogonal route; every connection always
  // renders, as a solid line with a traveling pulse above the 25 W
  // threshold and as a faint static line at or near zero.
  const addFlow = (
    key: string,
    route: Point[],
    value: number | null,
    color: string
  ) => {
    const path = polyline(route)
    edges.push({
      key,
      path,
      value,
      active: isShown(value),
      color,
      chip: longestSegmentMidpoint(route),
    })
  }
  // Solar feeds the roof and, in parallel, can charge the battery
  // straight down the left side.
  addFlow(
    "solar_to_home",
    ROUTES.solar_to_home,
    solarToHome,
    SOLAR_FLOW_COLOR
  )
  addFlow(
    "solar_to_battery",
    ROUTES.solar_to_battery,
    solarToBattery,
    SOLAR_FLOW_COLOR
  )
  // Import arrives at the upper right of the house, export leaves from
  // the lower right; the two orthogonal routes never cross.
  addFlow("grid_to_home", ROUTES.grid_to_home, gridToHome, GRID_IMPORT_COLOR)
  addFlow("home_to_grid", ROUTES.home_to_grid, homeToGrid, GRID_EXPORT_COLOR)
  // Grid share of the battery charging runs beneath the house.
  addFlow(
    "grid_to_battery",
    ROUTES.grid_to_battery,
    gridToBattery,
    CHARGING_COLOR
  )
  // The battery feeds the house from the lower left; both battery flows
  // share the one green battery accent.
  addFlow(
    "battery_to_home",
    ROUTES.battery_to_home,
    batteryToHome,
    CHARGING_COLOR
  )

  // Balance rule: Home shows the sum of the visible incoming arrows, so
  // node and arrow figures can never contradict each other.
  const incoming = [solarToHome, gridToHome, batteryToHome]
  const hasIncomingData =
    incoming.some((value) => value !== null) || isShown(homeToGrid)
  const homeW = Math.max(
    0,
    incoming.reduce<number>(
      (sum, value) => sum + (isShown(value) ? value : 0),
      0
    )
  )

  const gridFigure =
    gridImportW !== null &&
    (gridExportW === null || gridImportW >= gridExportW)
      ? `${gridImportW} W`
      : gridExportW !== null
        ? `${gridExportW} W`
        : "\u2014"
  const soc = summary?.battery_soc_pct
  const batteryPowerW = summary?.battery_power_w ?? null
  const batteryState = summary?.battery_state
  const batteryColor =
    batteryState === "charging"
      ? CHARGING_COLOR
      : batteryState === "discharging"
        ? DISCHARGING_COLOR
        : BATTERY_IDLE_COLOR

  const nodes: FlowNode[] = [
    {
      key: "sun",
      ...FLOW_POSITIONS.sun,
      name: "Solar",
      figure: pvW != null ? `${pvW} W` : "\u2014",
      icon: Sun,
      iconColor: SOLAR_COLOR,
      gradient: SOLAR_TILE_GRADIENT,
    },
    {
      key: "home",
      ...FLOW_POSITIONS.home,
      name: "Home",
      figure: hasIncomingData ? `${homeW} W` : "\u2014",
      icon: Home,
    },
    {
      key: "grid",
      ...FLOW_POSITIONS.grid,
      name: "Grid",
      figure: gridFigure,
      icon: UtilityPole,
      gradient: GRID_TILE_GRADIENT,
    },
    {
      key: "battery",
      ...FLOW_POSITIONS.battery,
      name: "Battery",
      figure: soc != null ? `${soc}%` : "\u2014",
      sub:
        batteryPowerW !== null
          ? `${batteryPowerW > 0 ? "+" : ""}${batteryPowerW} W`
          : null,
      icon: BatteryCharging,
      iconColor: batteryColor,
      borderColor: batteryColor,
      gradient: BATTERY_TILE_GRADIENTS[batteryState ?? "idle"],
    },
  ]

  return { nodes, edges, hasFlow: edges.some((edge) => edge.active) }
}