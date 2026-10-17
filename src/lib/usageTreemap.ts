// Pure logic for the usage treemap: metric selection per mode, the
// squarified layout and the tile model (Other collapse included). No
// React, no DOM - the component renders what these produce, and the
// tests exercise them directly.

import type { UsageBreakdown, UsageBreakdownCategory } from "@/lib/api"
import type { Mode } from "@/lib/mode"

// Categories under this share of the period's primary metric collapse
// into one "Other" tile, so unreadable sliver tiles never appear. The
// 2 percent floor aligns with the smallest tile that still fits a
// label and value on a laptop panel (docs/spec.md section 5.2).
export const OTHER_SHARE_THRESHOLD = 0.02

// "Other" only renders when its own share reaches this floor: a
// tinier bucket would be an unreadable sliver tile, so it is omitted
// from the treemap (the totals caption still carries the period
// total).
export const OTHER_MIN_SHARE = 0.01

// The primary metric in each mode: kWh in energy mode, cost in cost
// mode. The secondary metric is always the other one. Tiles, captions
// and the tooltip all read through these, so toggling the mode swaps
// primary and secondary everywhere at once.
export function primaryOf(
  category: Pick<UsageBreakdownCategory, "kwh" | "cost_eur">,
  mode: Mode
): number {
  return mode === "energy" ? category.kwh : (category.cost_eur ?? 0)
}

export function secondaryOf(
  category: Pick<UsageBreakdownCategory, "kwh" | "cost_eur">,
  mode: Mode
): number | null {
  return mode === "energy" ? category.cost_eur : category.kwh
}

export function formatMetric(value: number, mode: Mode): string {
  return mode === "energy"
    ? `${value.toFixed(1)} kWh`
    : `€${value.toFixed(2)}`
}

// One rendered tile: a category (or the collapsed "Other" bucket)
// with the values the tile, caption and tooltip show.
export interface TreemapTile {
  key: string
  label: string
  color: string
  isEstimate: boolean
  primary: number
  secondary: number | null
  share: number
  previousPrimary: number
}

// The tile model from one period's breakdown in one mode: the known
// categories - everything measured plus the heat pump estimate - in
// the API's order, with the under-threshold ones collapsed into
// "Other" at the end. The remainder is NOT a tile (docs/spec.md
// section 5.2: the Rest of your home card owns it); tile shares are
// the true share of the period total. Returns an empty array when the
// period has no primary total or no known category clears the
// collapse floor (the component's empty state).
export function buildTiles(
  data: UsageBreakdown,
  mode: Mode,
  colorOf: (key: string) => string
): TreemapTile[] {
  const totalPrimary =
    mode === "energy" ? data.total.kwh : (data.total.cost_eur ?? 0)
  if (totalPrimary <= 0) {
    return []
  }
  const kept: TreemapTile[] = []
  const small: UsageBreakdownCategory[] = []
  for (const category of data.categories) {
    if (category.class === "remainder") {
      continue
    }
    const primary = primaryOf(category, mode)
    if (primary <= 0) {
      continue
    }
    if (primary / totalPrimary < OTHER_SHARE_THRESHOLD) {
      small.push(category)
    } else {
      const previousPrimary =
        mode === "energy"
          ? category.previous_kwh
          : (category.previous_cost_eur ?? 0)
      kept.push({
        key: category.key,
        label: category.label,
        color: colorOf(category.key),
        isEstimate: category.class === "Est.",
        primary,
        secondary: secondaryOf(category, mode),
        share: primary / totalPrimary,
        previousPrimary,
      })
    }
  }
  if (small.length > 0) {
    const primary = small.reduce((sum, c) => sum + primaryOf(c, mode), 0)
    if (primary / totalPrimary < OTHER_MIN_SHARE) {
      return kept
    }
    const secondaryValues = small.map((c) => secondaryOf(c, mode))
    const secondary = secondaryValues.some((v) => v === null)
      ? null
      : (secondaryValues as number[]).reduce((sum, v) => sum + v, 0)
    const previousPrimary = small.reduce(
      (sum, c) =>
        sum +
        (mode === "energy" ? c.previous_kwh : (c.previous_cost_eur ?? 0)),
      0
    )
    kept.push({
      key: "other",
      label: "Other",
      color: colorOf("other"),
      isEstimate: false,
      primary,
      secondary,
      share: primary / totalPrimary,
      previousPrimary,
    })
  }
  return kept
}

// A laid-out rectangle in pixels.
export interface TileRect {
  x: number
  y: number
  w: number
  h: number
}

// The squarified treemap layout (Bruls, Huizing and van Wijk): the
// largest value starts a row along the shorter side of the remaining
// rectangle, and each row only grows while its worst aspect ratio
// improves. Values are normalized to the rectangle's area, so tile
// area encodes the metric exactly. Pure: values and pixels in, a
// rectangle per key out.
export function squarify(
  items: { key: string; value: number }[],
  width: number,
  height: number
): Map<string, TileRect> {
  const rects = new Map<string, TileRect>()
  const sorted = items
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
  if (sorted.length === 0 || width <= 0 || height <= 0) {
    return rects
  }
  const total = sorted.reduce((sum, item) => sum + item.value, 0)
  const areas = sorted.map((item) => ({
    key: item.key,
    area: (item.value / total) * width * height,
  }))

  // The worst (largest) aspect ratio of the row's tiles if stacked
  // against side pixels.
  const worst = (row: { area: number }[], side: number): number => {
    const sum = row.reduce((acc, item) => acc + item.area, 0)
    const max = Math.max(...row.map((item) => item.area))
    const min = Math.min(...row.map((item) => item.area))
    const sum2 = sum * sum
    const side2 = side * side
    return Math.max((side2 * max) / sum2, sum2 / (side2 * min))
  }

  let x = 0
  let y = 0
  let w = width
  let h = height
  let index = 0
  while (index < areas.length && w > 0 && h > 0) {
    const side = Math.min(w, h)
    const row = [areas[index]]
    let next = index + 1
    while (
      next < areas.length &&
      worst([...row, areas[next]], side) <= worst(row, side)
    ) {
      row.push(areas[next])
      next += 1
    }
    const rowArea = row.reduce((sum, item) => sum + item.area, 0)
    if (w >= h) {
      // A vertical strip on the left; the row stacks top to bottom.
      const stripWidth = rowArea / h
      let cy = y
      for (const item of row) {
        const itemHeight = item.area / stripWidth
        rects.set(item.key, { x, y: cy, w: stripWidth, h: itemHeight })
        cy += itemHeight
      }
      x += stripWidth
      w -= stripWidth
    } else {
      // A horizontal strip on top; the row runs left to right.
      const stripHeight = rowArea / w
      let cx = x
      for (const item of row) {
        const itemWidth = item.area / stripHeight
        rects.set(item.key, { x: cx, y, w: itemWidth, h: stripHeight })
        cx += itemWidth
      }
      y += stripHeight
      h -= stripHeight
    }
    index = next
  }
  return rects
}
