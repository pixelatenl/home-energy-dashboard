// A bar with rounded corners on the end away from its zero axis: a
// path with two true circular quarter-arc corners (arc commands, not
// quadratics - a degenerate quadratic control point renders as a
// chamfer, which reads as a jagged corner). The default rounds the
// top of an upward bar; "bottom" rounds the base end for bars that
// grow downward from their zero line. Shared by the solar production
// chart (day view), the usage slot chart and the battery flow charts.
export function barPath(
  x: number,
  width: number,
  top: number,
  base: number,
  radius: number,
  roundedEnd: "top" | "bottom" = "top",
): string {
  const r = Math.min(radius, width / 2, base - top)
  if (roundedEnd === "bottom") {
    return `M ${x} ${top} H ${x + width} V ${base - r} A ${r} ${r} 0 0 1 ${x + width - r} ${base} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${base - r} Z`
  }
  return `M ${x} ${base} V ${top + r} A ${r} ${r} 0 0 1 ${x + r} ${top} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${top + r} V ${base} Z`
}
