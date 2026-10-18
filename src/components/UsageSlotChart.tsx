import { useMemo, useState } from "react";
import { ChartColumn } from "lucide-react";
import PanelHeader from "@/components/PanelHeader";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { UsageBreakdown, UsageSlot, UsageSlotUnit } from "@/lib/api";
import type { Mode } from "@/lib/mode";
import { periodLabel, type Period } from "@/lib/period";
import { localHourOf } from "@/lib/time";

// The chart's geometry: the viewBox height equals the rendered
// height (h-56 = 224px), so one viewBox unit is one pixel vertically
// and the HTML y-axis labels can sit exactly on the gridlines. Only
// the x axis stretches with the width.
const WIDTH = 960;
const HEIGHT = 224;
const TOP = 10;
const BASE = HEIGHT - 6;
const PRICE_MIN_GAP = 0.01;
const GRID_LINES = 3;

function formatKwh(value: number): string {
  return `${value.toFixed(1)} kWh`;
}

function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `€${value.toFixed(2)}`;
}

// The slot label: hour, day or month, from the slot's local start.
function slotLabel(slot: UsageSlot, unit: UsageSlotUnit): string {
  if (unit === "hour") {
    return `${String(localHourOf(slot.ts)).padStart(2, "0")}:00`;
  }
  if (unit === "day") {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Europe/Amsterdam",
    }).format(new Date(slot.ts));
  }
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(slot.ts));
}

// The x-axis label beneath each slot: the hour, the week's weekday or
// the day-of-month, the month abbreviation.
function axisLabel(
  slot: UsageSlot,
  index: number,
  unit: UsageSlotUnit,
): string {
  if (unit === "hour") {
    return index % 3 === 0 ? String(localHourOf(slot.ts)).padStart(2, "0") : "";
  }
  if (unit === "day") {
    const date = new Date(slot.ts);
    if (index === 0) {
      // The first day shows its weekday so the week view reads
      // immediately.
      return new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        timeZone: "Europe/Amsterdam",
      }).format(date);
    }
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      timeZone: "Europe/Amsterdam",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(slot.ts));
}

// A bar with rounded top corners only, so the bars sit flat on the
// axis: a path with two true circular quarter-arc corners at the top
// (arc commands, not quadratics - a degenerate quadratic control
// point renders as a chamfer, which reads as a jagged corner).
function barPath(
  x: number,
  width: number,
  top: number,
  base: number,
  radius: number,
): string {
  const r = Math.min(radius, width / 2, base - top);
  return `M ${x} ${base} V ${top + r} A ${r} ${r} 0 0 1 ${x + r} ${top} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${top + r} V ${base} Z`;
}

// A nice step for the y axis: 1, 2, 2.5 or 5 times a power of ten,
// so the gridlines carry round values.
function niceStep(raw: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const factor = raw / power;
  const nice =
    factor <= 1
      ? 1
      : factor <= 2
        ? 2
        : factor <= 2.5
          ? 2.5
          : factor <= 5
            ? 5
            : 10;
  return nice * power;
}

interface UsageSlotChartProps {
  data: UsageBreakdown | null;
  status: "loading" | "ok" | "error";
  mode: Mode;
  period: Period;
  isCurrent: boolean;
}

// The per-slot chart (docs/spec.md section 8): one bar per slot -
// hourly for day periods, daily for weeks and months, monthly for
// years - showing the slot's total household consumption, rounded
// tops, on a full-period axis (slots without data yet sit empty).
// The y axis carries gridlines with labels, the x axis a label per
// slot. The hourly price rides as an amber line overlay on its own
// scale (on by default, one toggle, identical in both modes), the
// now marker shows the current hour on the current day, and one
// shared hover tooltip shows the slot, the total, its EUR at the
// slot price and the active categories' breakdown. No legend.
function UsageSlotChart({
  data,
  status,
  mode,
  period,
  isCurrent,
}: UsageSlotChartProps) {
  const [priceOverlay, setPriceOverlay] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const slots = data?.slots.series ?? [];
  const unit = data?.slots.unit ?? "hour";
  const slotCount = Math.max(1, slots.length);
  const slotWidth = WIDTH / slotCount;

  // The bars: the mode's primary metric (kWh in energy mode, the
  // slot's EUR at its price in cost mode), scaled to the y axis'
  // nice round maximum.
  const barValue = (slot: UsageSlot): number =>
    mode === "energy" ? slot.kwh : (slot.cost_eur ?? 0);
  const barMax = useMemo(
    () => Math.max(...slots.map((slot) => barValue(slot)), 0.001),
    [slots, mode],
  );
  const step = niceStep(barMax / GRID_LINES);
  const axisMax = step * GRID_LINES;
  const valueY = (value: number): number =>
    BASE - Math.min(value / axisMax, 1) * (BASE - TOP);

  // The price overlay's own scale: min to max of the slot prices.
  const prices = slots
    .map((slot) => slot.price_eur)
    .filter((price): price is number => price !== null);
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
  const priceScale = Math.max(priceMax - priceMin, PRICE_MIN_GAP);
  const priceY = (price: number): number =>
    BASE - ((price - priceMin) / priceScale) * (BASE - TOP);

  // The now marker: the current local hour, on the current day
  // period only.
  const nowHour =
    isCurrent && unit === "hour" && data !== null
      ? localHourOf(new Date().toISOString())
      : null;

  const hovered = hoveredIndex !== null ? (slots[hoveredIndex] ?? null) : null;
  const title =
    unit === "hour"
      ? "Hourly usage"
      : unit === "day"
        ? "Daily usage"
        : "Monthly usage";
  const tickLabel = (value: number): string =>
    mode === "energy"
      ? step < 1
        ? value.toFixed(1)
        : String(Math.round(value))
      : value.toFixed(step < 0.1 ? 2 : 1);

  // The whole panel's loading reveal, in two synchronized parts -
  // the header and the chart content - so the Card's own gap keeps
  // the rhythm in every phase. The header skeleton mirrors the
  // PanelHeader's two lines; the content skeleton mirrors the
  // toolbar row, the chart's fixed 224 px block and the x-axis label
  // row. An error is not loading: the honest message fades in; an
  // empty period keeps its own honest state.
  const loading = status === "loading" && data === null;
  const headerSkeleton = (
    // The px-4 mirrors the CardHeader's own padding: this skeleton
    // renders beside the Card's chrome, not inside a padded slot.
    <div className="grid auto-rows-min items-start gap-1 px-4" aria-busy="true">
      {/* The PanelHeader's geometry: the text-lg title at
          leading-snug (24.75 px) over the text-sm description
          (20 px), one gap-1 apart. */}
      <Skeleton className="h-[24.75px] w-40" />
      <Skeleton className="h-5 w-72" />
    </div>
  );
  const contentSkeleton = (
    <div className="flex flex-col" aria-busy="true">
      {/* The toolbar row, then the chart's fixed-height block and
          the x-axis label row beneath it. */}
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
          icon={ChartColumn}
          title={title}
          description={`${periodLabel(period)} - household consumption per ${unit === "hour" ? "hour" : unit === "day" ? "day" : "month"}`}
        />
      </SkeletonReveal>
      <CardContent>
        <SkeletonReveal loading={loading} skeleton={contentSkeleton}>
          {data === null ? (
            <p className="min-h-32 text-sm text-muted-foreground">
              {status === "error"
                ? "Could not load the usage breakdown."
                : "No usage data for this period."}
            </p>
          ) : slots.length === 0 ? (
            <p className="min-h-32 text-sm text-muted-foreground">
              No usage data for this period.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Total household consumption (
                  {mode === "energy" ? "kWh" : "EUR"})
                </span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Hourly price €/kWh
                  <Switch
                    checked={priceOverlay}
                    onCheckedChange={setPriceOverlay}
                    aria-label="Toggle the hourly price overlay"
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
                      className="pointer-events-none absolute left-0 w-8 -translate-y-1/2 text-right text-[10px] text-muted-foreground tabular-nums"
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
                    aria-label="Household consumption per slot"
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
                      const value = barValue(slot);
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
                      slots.some((slot) => slot.price_eur !== null) && (
                        <polyline
                          points={slots
                            .map((slot, index) => {
                              if (slot.price_eur === null) {
                                return null;
                              }
                              return `${index * slotWidth + slotWidth / 2},${priceY(slot.price_eur)}`;
                            })
                            .filter((point): point is string => point !== null)
                            .join(" ")}
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth={1.5}
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                    {nowHour !== null && (
                      <line
                        x1={(nowHour + 0.5) * slotWidth}
                        x2={(nowHour + 0.5) * slotWidth}
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
                    <span className="pointer-events-none absolute right-1 top-0 text-[10px] text-muted-foreground tabular-nums">
                      €{priceMax.toFixed(2)}
                    </span>
                  )}
                  {priceOverlay && prices.length > 0 && (
                    <span className="pointer-events-none absolute right-1 bottom-1 text-[10px] text-muted-foreground tabular-nums">
                      €{priceMin.toFixed(2)}
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
                        {slotLabel(hovered, unit)} &middot;{" "}
                        {formatKwh(hovered.kwh)}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatEur(hovered.cost_eur)} at{" "}
                        {hovered.price_eur === null
                          ? "\u2014"
                          : `€${hovered.price_eur.toFixed(4)}`}
                        /kWh
                      </div>
                      {hovered.categories.map((category) => (
                        <div
                          key={category.key}
                          className="text-xs text-muted-foreground tabular-nums"
                        >
                          {category.label} {category.kwh.toFixed(2)} kWh
                          {category.class === "Est." ? " (Est.)" : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="relative mt-1 h-4 pl-9 text-xs text-muted-foreground tabular-nums">
                {slots.map((slot, index) => {
                  const label = axisLabel(slot, index, unit);
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
            </>
          )}
        </SkeletonReveal>
      </CardContent>
    </Card>
  );
}

export default UsageSlotChart;
