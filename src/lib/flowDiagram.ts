import { BatteryCharging, Home, Sun, UtilityPole } from "lucide-react"
import type { CSSProperties, ComponentType } from "react"
import type { SummaryData } from "@/lib/api"

// Flow palette: solar warm yellow, battery charging green, battery
// discharging amber, grid import blue, grid export violet.
export const SOLAR_COLOR = "#fbbf24"
export const CHARGING_COLOR = "hsl(140 70% 45%)"
export const DISCHARGING_COLOR = "#f59e0b"
export const GRID_IMPORT_COLOR = "#3b82f6"
export const GRID_EXPORT_COLOR = "#8b5cf6"
export const NEUTRAL_COLOR = "#94a3b8"

// Diagram geometry in design units. The diagram box is aspect-locked and
// scales with the widget width; overlays position by percentage so the
// geometry here is resolution independent.
export const DIAGRAM_WIDTH = 780
export const DIAGRAM_HEIGHT = 350
export const NODE_RADIUS = 58
export const ARROW_TRIM = NODE_RADIUS + 8

export interface Point {
  x: number
  y: number
}

// Node centers: Sun left, Home center, Grid right, Battery below Home.
export const FLOW_POSITIONS: Record<
  "sun" | "home" | "battery" | "grid",
  Point
> = {
  sun: { x: 85, y: 95 },
  home: { x: 390, y: 95 },
  grid: { x: 695, y: 95 },
  battery: { x: 390, y: 270 },
}

export type IconComponent = ComponentType<{
  className?: string
  style?: CSSProperties
}>

// A diagram node: position, caption and live figure. Pure data; the render
// pass turns it into a circle, a future illustrated house view can do more.
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
}

// A diagram edge: an arrow between two nodes with its watt value and the
// position of its value chip. The shift moves the line perpendicular to
// its axis so opposite arrows on the same segment do not overlap.
export interface FlowEdge {
  key: string
  from: Point
  to: Point
  shift: number
  value: number
  color: string
  chip: Point
}

export interface FlowData {
  nodes: FlowNode[]
  edges: FlowEdge[]
  hasFlow: boolean
}

const isShown = (value: number | null): value is number =>
  value !== null && value > 25

// Data logic: turns the flow snapshot into nodes and edges. The arrow
// mappings are strict so nothing is double-counted and every arrow hides
// below 25 W. The Home figure is the sum of the visible incoming arrows,
// so the diagram always balances visually regardless of the individual
// series' refresh moments.
export function buildFlowDiagram(summary: SummaryData | null): FlowData {
  const flow = summary?.flow
  const solarToBattery = flow?.battery_solar_in_w ?? null
  // Grid share of the charging power (solar share deducted).
  const gridToBattery =
    flow?.battery_charge_w != null
      ? flow.battery_charge_w - (solarToBattery ?? 0)
      : null
  // Household PV: PV production minus what charges the battery directly.
  const solarToHome =
    flow?.pv_w != null ? flow.pv_w - (solarToBattery ?? 0) : null
  // Household grid import: import minus the battery's grid charging share.
  const gridToHome =
    flow?.grid_import_w != null
      ? flow.grid_import_w -
        (gridToBattery !== null && gridToBattery > 25 ? gridToBattery : 0)
      : null
  const homeToGrid = flow?.grid_export_w ?? null
  // The battery only feeds the house; its charging never renders here.
  const batteryToHome = flow?.battery_discharge_w ?? null

  const edges: FlowEdge[] = []
  if (isShown(solarToHome)) {
    edges.push({
      key: "solar_to_home",
      from: FLOW_POSITIONS.sun,
      to: FLOW_POSITIONS.home,
      shift: 0,
      value: solarToHome,
      color: SOLAR_COLOR,
      chip: { x: 237.5, y: 95 },
    })
  }
  if (isShown(solarToBattery)) {
    edges.push({
      key: "solar_to_battery",
      from: FLOW_POSITIONS.sun,
      to: FLOW_POSITIONS.battery,
      shift: 0,
      value: solarToBattery,
      color: SOLAR_COLOR,
      chip: { x: 237.5, y: 182.5 },
    })
  }
  if (isShown(gridToHome)) {
    edges.push({
      key: "grid_to_home",
      from: FLOW_POSITIONS.grid,
      to: FLOW_POSITIONS.home,
      // Drawn below the axis so it stays clear of the export arrow.
      shift: 32,
      value: gridToHome,
      color: GRID_IMPORT_COLOR,
      chip: { x: 542.5, y: 127 },
    })
  }
  if (isShown(homeToGrid)) {
    edges.push({
      key: "home_to_grid",
      from: FLOW_POSITIONS.home,
      to: FLOW_POSITIONS.grid,
      // Drawn above the axis so it stays clear of the import arrow.
      shift: -26,
      value: homeToGrid,
      color: GRID_EXPORT_COLOR,
      chip: { x: 542.5, y: 69 },
    })
  }
  if (isShown(gridToBattery)) {
    edges.push({
      key: "grid_to_battery",
      from: FLOW_POSITIONS.grid,
      to: FLOW_POSITIONS.battery,
      shift: 0,
      value: gridToBattery,
      color: CHARGING_COLOR,
      chip: { x: 542.5, y: 182.5 },
    })
  }
  if (isShown(batteryToHome)) {
    edges.push({
      key: "battery_to_home",
      from: FLOW_POSITIONS.battery,
      to: FLOW_POSITIONS.home,
      shift: 0,
      value: batteryToHome,
      color: DISCHARGING_COLOR,
      chip: { x: 390, y: 182 },
    })
  }

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

  const gridImport = flow?.grid_import_w ?? null
  const gridExport = flow?.grid_export_w ?? null
  const gridFigure =
    gridImport !== null && (gridExport === null || gridImport >= gridExport)
      ? `${gridImport} W`
      : gridExport !== null
        ? `${gridExport} W`
        : "\u2014"
  const soc = summary?.battery_soc_pct
  const batteryPowerW = summary?.battery_power_w ?? null
  const batteryState = summary?.battery_state
  const batteryColor =
    batteryState === "charging"
      ? CHARGING_COLOR
      : batteryState === "discharging"
        ? DISCHARGING_COLOR
        : NEUTRAL_COLOR

  const nodes: FlowNode[] = [
    {
      key: "sun",
      ...FLOW_POSITIONS.sun,
      name: "Sun",
      figure: flow?.pv_w != null ? `${flow.pv_w} W` : "\u2014",
      icon: Sun,
      iconColor: SOLAR_COLOR,
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
    },
  ]

  return { nodes, edges, hasFlow: edges.length > 0 }
}
