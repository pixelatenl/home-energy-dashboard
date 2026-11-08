import { useMemo, useState } from "react";
import { Flame } from "lucide-react";
import PanelHeader from "@/components/PanelHeader";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { Mode } from "@/lib/mode";
import { periodLabel, type Period } from "@/lib/period";
import { barPath } from "@/lib/barPath";
import { niceStep } from "@/lib/chartScale";
import { useHeatGas } from "@/lib/useHeatGas";
import {
  gasAxisLabel,
  gasChartSlots,
  gasSlotBarValue,
  gasSlotCostLabel,
  gasSlotLabel,
  gasSlotPriceLabel,
  gasWindowEmpty,
  type GasChartGranularity,
} from "@/lib/usageGas";
import { formatM3 } from "@/lib/gasCard";

// The chart's geometry: the viewBox height equals the rendered
// height (h-56 = 224px), so one viewBox unit is one pixel vertically
// and the HTML y-axis labels can sit exactly on the gridlines. Only
// the x axis stretches with the width - the per-slot chart's
// convention, followed here.
const WIDTH = 960;
const HEIGHT = 224;
const TOP = 10;
const BASE = HEIGHT - 6;
const PRICE_MIN_GAP = 0.01;
const GRID_LINES = 3;
// The gas price overlay's line color: the data-viz palette's muted
// terracotta (the heat page's gas bars), distinct from the per-slot
// chart's amber electricity price line.
const GAS_PRICE_COLOR = "#a86538";

interface UsageGasChartProps {
  period: Period;
  isCurrent: boolean;
  mode: Mode;
}

// The gas slot chart (docs/spec.md section 8.1): a full-width card
// beneath the per-slot chart, one neutral bar per slot at the
// /api/heat/gas endpoint's granularity - hourly for day periods,
// daily for weeks and months (the days ahead sit on the axis without
// a bar), monthly for years - following the per-slot chart's
// conventions: rounded tops, gridlines at round steps, x labels per
// granularity, no legend. The bars follow the mode (m3 in energy
// mode, the slot's EUR in cost mode; a slot without its price row
// reads the dash in the tooltip, never 0). The gas price rides as a
// muted terracotta line overlay on its own min-to-max scale labeled
// at the right edge, always €/m³ in both modes, on by default with a
// single toggle. The now marker shows the current hour on the current
// day period only. The data is one fetchHeatGas call anchored on the
// navigator's period; the chart fails soft independently of the
// breakdown, keeps its previous content while revalidating on period
// switches (no skeleton flash), and shows the shared shape-matched
// skeleton only on first load.
function UsageGasChart({ period, isCurrent, mode }: UsageGasChartProps) {
  const { data, status } = useHeatGas(period.kind, period.date);
  const [priceOverlay, setPriceOverlay] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const granularity: GasChartGranularity = data?.granularity ?? "hour";
  const slots = useMemo(() => (data === null ? [] : gasChartSlots(data)), [data]);
  const slotCount = Math.max(1, slots.length);
  const slotWidth = WIDTH / slotCount;

  // The bars: the mode's primary metric (m3 in energy mode, the
  // slot's EUR at its price in cost mode), scaled to the y axis'
  // nice round maximum.
  const barMax = useMemo(
    () =>
      Math.max(...slots.map((slot) => gasSlotBarValue(slot, mode)), 0.001),
    [slots, mode],
  );
  const barValue = (index: number): number =>
    gasSlotBarValue(slots[index], mode);
  const step = niceStep(barMax / GRID_LINES);
  const axisMax = step * GRID_LINES;
  const valueY = (value: number): number =>
    BASE - Math.min(value / axisMax, 1) * (BASE - TOP);

  // The price overlay's own scale: min to max of the slot prices.
  const prices = slots
    .map((slot) => slot.priceEurPerM3)
    .filter((price): price is number => price !== null);
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
  const priceScale = Math.max(priceMax - priceMin, PRICE_MIN_GAP);
  const priceY = (price: number): number =>
    BASE - ((price - priceMin) / priceScale) * (BASE - TOP);

  // The now marker: the current slot, on the current day period only,
  // selected by timestamp containment against the slots' real hourly
  // instants, like the per-slot chart.
  const nowSlotIndex =
    isCurrent && granularity === "hour" && data !== null
      ? slots.findIndex((slot) => {
          const start = Date.parse(slot.ts);
          // eslint-disable-next-line react/purity
          const nowMs = Date.now();
          return nowMs >= start && nowMs < start + 3_600_000;
        })
      : -1;

  const hovered = hoveredIndex !== null ? (slots[hoveredIndex] ?? null) : null;
  const tickLabel = (value: number): string =>
    mode === "energy"
      ? step < 1
        ? value.toFixed(1)
        : String(Math.round(value))
      : value.toFixed(step < 0.1 ? 2 : 1);

  // The whole panel's loading reveal, in two synchronized parts -
  // the header and the chart content - mirroring the per-slot chart's
  // skeleton shapes. An error is not loading: the honest message fades
  // in; an empty period keeps its own honest state.
  const loading = status === "loading" && data === null;
  const headerSkeleton = (
    // The px-4 mirrors the CardHeader's own padding: this skeleton
    // renders beside the Card's chrome, not inside a padded slot.
    <div className="grid auto-rows-min items-start gap-1 px-4" aria-busy="true">
      <Skeleton className="h-[24.75px] w-40" />
      <Skeleton className="h-5 w-72" />
    </div>
  );
  const contentSkeleton = (
    <div className="flex flex-col" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-5 w-36" />
      </div>
      <Skeleton className="mt-2 h-56 w-full rounded-lg" />
      <Skeleton className="mt-1 h-4 w-full" />
    </div>
  );

  return (
    <Card>
      <SkeletonReveal loading={loading} skeleton={headerSkeleton}>
        <PanelHeader
          icon={Flame}
          title="Gas usage"
          description={`${periodLabel(period)} - gas consumption per ${
            granularity === "hour"
              ? "hour"
              : granularity === "day"
                ? "day"
                : "month"
          }`}
        />
      </SkeletonReveal>
      <CardContent>
        <SkeletonReveal loading={loading} skeleton={contentSkeleton}>
          {data === null ? (
            <p className="min-h-32 text-sm text-subtle-foreground">
              {status === "error"
                ? "Could not load gas data."
                : "No gas data for this period."}
            </p>
          ) : gasWindowEmpty(data) || slots.length === 0 ? (
            <p className="min-h-32 text-sm text-subtle-foreground">
              No gas data for this period.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Total gas consumption (
                  {mode === "energy" ? "m³" : "EUR"})
                </span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Gas price €/m³
                  <Switch
                    checked={priceOverlay}
                    onCheckedChange={setPriceOverlay}
                    aria-label="Toggle the gas price overlay"
                  />
                </label>
              </div>
              <div
                className="relative mt-2 pl-9"
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* The y-axis labels, on the gridlines. */}
                {Array.from({ length: GRID_LINES + 1 }, (_, i) => i * step).map(
                  (value) => (
                    <span
                      key={value}
                      className="pointer-events-none absolute left-0 w-8 -translate-y-1/2 text-right text-[10px] text-subtle-foreground tabular-nums"
                      style={{ top: valueY(value) }}
                    >
                      {tickLabel(value)}
                    </span>
                  ),
                )}
                <div
                  className="relative"
                  onMouseMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const index = Math.floor(
                      ((event.clientX - rect.left) / rect.width) * slotCount,
                    );
                    setHoveredIndex(
                      index >= 0 && index < slotCount ? index : null,
                    );
                  }}
                >
                  <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    preserveAspectRatio="none"
                    className="h-56 w-full"
                    role="img"
                    aria-label="Gas consumption per slot"
                  >
                    {/* The gridlines and the axis baseline. */}
                    {Array.from(
                      { length: GRID_LINES },
                      (_, i) => (i + 1) * step,
                    ).map((value) => (
                      <line
                        key={value}
                        x1={0}
                        x2={WIDTH}
                        y1={valueY(value)}
                        y2={valueY(value)}
                        stroke="currentColor"
                        strokeOpacity={0.12}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <line
                      x1={0}
                      x2={WIDTH}
                      y1={BASE}
                      y2={BASE}
                      stroke="currentColor"
                      strokeOpacity={0.3}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    {slots.map((slot, index) => {
                      const value = barValue(index);
                      if (value <= 0) {
                        return null;
                      }
                      return (
                        <path
                          key={slot.ts}
                          d={barPath(
                            index * slotWidth + slotWidth * 0.15,
                            slotWidth * 0.7,
                            valueY(value),
                            BASE,
                            5,
                          )}
                          className="fill-muted-foreground/40"
                        />
                      );
                    })}
                    {hoveredIndex !== null && (
                      <rect
                        x={hoveredIndex * slotWidth}
                        y={0}
                        width={slotWidth}
                        height={HEIGHT}
                        fill="currentColor"
                        opacity={0.08}
                      />
                    )}
                    {priceOverlay &&
                      slots.length > 1 &&
                      slots.some((slot) => slot.priceEurPerM3 !== null) && (
                        <polyline
                          points={slots
                            .map((slot, index) => {
                              if (slot.priceEurPerM3 === null) {
                                return null;
                              }
                              return `${index * slotWidth + slotWidth / 2},${priceY(slot.priceEurPerM3)}`;
                            })
                            .filter((point): point is string => point !== null)
                            .join(" ")}
                          fill="none"
                          stroke={GAS_PRICE_COLOR}
                          strokeWidth={1.5}
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                    {nowSlotIndex >= 0 && (
                      <line
                        x1={(nowSlotIndex + 0.5) * slotWidth}
                        x2={(nowSlotIndex + 0.5) * slotWidth}
                        y1={TOP}
                        y2={HEIGHT}
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeDasharray="2 4"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                  {priceOverlay && prices.length > 0 && (
                    <span className="pointer-events-none absolute right-1 top-0 text-[10px] text-subtle-foreground tabular-nums">
                      €{priceMax.toFixed(2)}/m³
                    </span>
                  )}
                  {priceOverlay && prices.length > 0 && (
                    <span className="pointer-events-none absolute right-1 bottom-1 text-[10px] text-subtle-foreground tabular-nums">
                      €{priceMin.toFixed(2)}/m³
                    </span>
                  )}
                  {hovered && (
                    <div
                      className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
                      style={{
                        left: `${Math.min(Math.max((hoveredIndex! / slotCount) * 100, 12), 86)}%`,
                      }}
                    >
                      <div className="text-sm font-medium tabular-nums">
                        {gasSlotLabel(hovered, granularity)} &middot;{" "}
                        {formatM3(hovered.m3)}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {gasSlotCostLabel(hovered)} at{" "}
                        {gasSlotPriceLabel(hovered)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="relative mt-1 h-4 pl-9 text-xs text-subtle-foreground tabular-nums">
                {slots.map((slot, index) => {
                  const label = gasAxisLabel(slot, index, granularity);
                  if (label === "") {
                    return null;
                  }
                  return (
                    <span
                      key={slot.ts}
                      className="absolute top-0 -translate-x-1/2"
                      style={{
                        left: `calc(2.25rem + ${(index + 0.5) / slotCount} * (100% - 2.25rem))`,
                      }}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
              {/* The data caveats as the one-line footnote, the gas
                  section's idiom: the endpoint's own meta note plus the
                  last-known-price fallback for the cost. */}
              {data.totals.hasUnknownPrice && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Some gas in this period has no known price; the cost covers
                  only the priced part.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {data.meta.note}. The cost uses the last known gas price when
                the period&rsquo;s price rows are missing.
              </p>
            </>
          )}
        </SkeletonReveal>
      </CardContent>
    </Card>
  );
}

export default UsageGasChart;
