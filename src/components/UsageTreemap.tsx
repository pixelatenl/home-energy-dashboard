import { useEffect, useMemo, useRef, useState } from "react"
import { LayoutGrid } from "lucide-react"
import PanelHeader from "@/components/PanelHeader"
import { Card, CardContent } from "@/components/ui/card"
import type { UsageBreakdown } from "@/lib/api"
import { usageCategoryColor } from "@/lib/applianceColors"
import type { Mode } from "@/lib/mode"
import { periodLabel, type Period } from "@/lib/period"
import {
  buildTiles,
  formatMetric,
  primaryOf,
  squarify,
} from "@/lib/usageTreemap"

// The tile gap: the layout is exact, so the gap is shaved off every
// rectangle's edges at render time.
const TILE_GAP = 3

// Area tiers for tile content: below the small threshold a tile shows
// its color only, between small and full it adds the label and the
// primary value, above full every line shows. The thresholds hold
// the 5-category worst case readable on a laptop panel.
const FULL_TILE_AREA = 9_000
const SMALL_TILE_AREA = 3_000

interface UsageTreemapProps {
  data: UsageBreakdown | null
  status: "loading" | "ok" | "error"
  mode: Mode
  period: Period
  hasData: boolean
}

// The Usage tab's left panel: the category treemap of the period's
// household usage. Tile area encodes the mode's primary metric, each
// tile also shows the secondary metric and its share of the total,
// the heat pump carries its "Est." badge, and under-threshold
// categories collapse into "Other". Tiles are keyed by category and
// transition their positions, so switching period or mode animates
// instead of remounting (no flicker). The tooltip follows
// docs/spec.md section 5.3.
function UsageTreemap({
  data,
  status,
  mode,
  period,
  hasData,
}: UsageTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  // The layout is computed in measured pixels so the squarified
  // aspect ratios hold at whatever width the panel gets.
  useEffect(() => {
    const element = containerRef.current
    if (element === null) {
      return
    }
    const observer = new ResizeObserver(() => {
      setSize({ w: element.clientWidth, h: element.clientHeight })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const tiles = useMemo(
    () => (data === null ? [] : buildTiles(data, mode, usageCategoryColor)),
    [data, mode]
  )
  const layout = useMemo(
    () =>
      size === null
        ? new Map()
        : squarify(
            tiles.map((tile) => ({ key: tile.key, value: tile.primary })),
            size.w,
            size.h
          ),
    [tiles, size]
  )
  const hovered =
    hoveredKey === null ? null : (tiles.find((t) => t.key === hoveredKey) ?? null)

  const label = periodLabel(period)
  // The known set's share of the period, the coverage the treemap
  // shows; the Rest of your home card owns the remainder.
  const knownPrimary =
    data === null
      ? null
      : mode === "energy"
        ? data.split.measured_kwh + data.split.estimated_kwh
        : (data.split.measured_cost_eur ?? 0) +
          (data.split.estimated_cost_eur ?? 0)
  const totalPrimary =
    data === null ? null : primaryOf({ kwh: data.total.kwh, cost_eur: data.total.cost_eur }, mode)
  const coveragePct =
    knownPrimary !== null && totalPrimary !== null && totalPrimary > 0
      ? Math.round((knownPrimary / totalPrimary) * 100)
      : 0

  return (
    <Card className="flex flex-col">
      <PanelHeader
        icon={LayoutGrid}
        title="Usage breakdown"
        description={
          knownPrimary === null || totalPrimary === null
            ? `Metered appliances and heat pump estimate (${label})`
            : `Metered appliances and heat pump estimate, ${formatMetric(knownPrimary, mode)} of ${formatMetric(totalPrimary, mode)}, ${coveragePct}% of the period`
        }
      />
      <CardContent className="flex flex-1 flex-col">
        {status === "error" && (
          <p className="flex h-80 items-center justify-center rounded-xl border text-sm text-muted-foreground">
            Could not load the usage breakdown. Try again in a moment.
          </p>
        )}
        {status !== "error" && (
          <div
            ref={containerRef}
            className="relative h-80 w-full overflow-hidden rounded-xl border bg-muted/30"
            onMouseLeave={() => setHoveredKey(null)}
          >
            {data === null && (
              <div
                className="absolute inset-0 animate-pulse rounded-xl bg-muted"
                aria-hidden="true"
              />
            )}
            {data !== null && tiles.length === 0 && (
              <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
                {totalPrimary === null || totalPrimary <= 0
                  ? hasData
                    ? "No usage recorded for this period yet."
                    : "No usage data for this period."
                  : "No metered appliance or heat pump usage for this period. The Rest of your home card covers everything else."}
              </p>
            )}
            {data !== null &&
              tiles.map((tile) => {
                const rect = layout.get(tile.key)
                if (rect === undefined) {
                  return null
                }
                const area = rect.w * rect.h
                const full = area >= FULL_TILE_AREA
                const medium = area >= SMALL_TILE_AREA
                return (
                  <div
                    key={tile.key}
                    className="absolute overflow-hidden rounded-lg transition-[height,left,top,width] duration-300 ease-out"
                    style={{
                      left: rect.x + TILE_GAP,
                      top: rect.y + TILE_GAP,
                      width: Math.max(0, rect.w - TILE_GAP * 2),
                      height: Math.max(0, rect.h - TILE_GAP * 2),
                      backgroundColor: tile.color,
                    }}
                    onMouseEnter={() => setHoveredKey(tile.key)}
                    onFocus={() => setHoveredKey(tile.key)}
                    onBlur={() =>
                      setHoveredKey((key) =>
                        key === tile.key ? null : key
                      )
                    }
                    tabIndex={0}
                    aria-label={`${tile.label}: ${formatMetric(tile.primary, mode)}, ${Math.round(tile.share * 100)}% of total`}
                  >
                    {medium && (
                      <div className="flex h-full flex-col justify-between overflow-hidden p-2">
                        <div className="flex items-start justify-between gap-1">
                          <span className="truncate text-xs font-medium text-white">
                            {tile.label}
                          </span>
                          {tile.isEstimate && full && (
                            <span className="shrink-0 rounded-full bg-black/30 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                              Est.
                            </span>
                          )}
                        </div>
                        {full && (
                          <div>
                            <p className="text-sm font-semibold leading-snug text-white tabular-nums">
                              {formatMetric(tile.primary, mode)}
                            </p>
                            <p className="truncate text-[11px] text-white/80 tabular-nums">
                              {tile.secondary === null
                                ? `${Math.round(tile.share * 100)}%`
                                : `${formatMetric(tile.secondary, mode === "energy" ? "cost" : "energy")} \u00b7 ${Math.round(tile.share * 100)}%`}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            {data !== null && hovered !== null && layout.has(hovered.key) && (
              <div
                className="pointer-events-none absolute z-10 w-52 rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
                style={{
                  left: Math.max(
                    0,
                    Math.min(layout.get(hovered.key).x + 4, (size?.w ?? 0) - 216)
                  ),
                  top: Math.max(
                    0,
                    Math.min(layout.get(hovered.key).y + 4, (size?.h ?? 0) - 96)
                  ),
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {hovered.label}
                  </span>
                  {hovered.isEstimate && (
                    <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                      Est.
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {formatMetric(hovered.primary, mode)} &middot;{" "}
                  {Math.round(hovered.share * 100)}% of total
                </div>
                {hovered.secondary !== null && (
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatMetric(
                      hovered.secondary,
                      mode === "energy" ? "cost" : "energy"
                    )}
                  </div>
                )}
                <div className="text-xs text-muted-foreground tabular-nums">
                  Previous {period.kind}:{" "}
                  {formatMetric(hovered.previousPrimary, mode)}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default UsageTreemap
