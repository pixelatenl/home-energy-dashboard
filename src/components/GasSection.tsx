import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame } from "lucide-react";
import PanelHeader from "@/components/PanelHeader";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Card, CardContent } from "@/components/ui/card";
import type { GasUsageData } from "@/lib/api";
import { useMode } from "@/lib/mode";
import { niceStep } from "@/lib/chartScale";
import { amsterdamDayStartMs, localDateOf } from "@/lib/time";

// Bucket length of one series interval: hours and days are fixed, a
// month ends at the next month's local midnight (month intervals start
// at local midnight, the same convention as the daily buckets).
function bucketEndMs(
  ts: string,
  granularity: "hour" | "day" | "month",
): number {
  if (granularity === "month") {
    const [year, month] = localDateOf(ts).split("-").map(Number);
    const nextFirst =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    return amsterdamDayStartMs(nextFirst);
  }
  return Date.parse(ts) + (granularity === "hour" ? 3_600_000 : 86_400_000);
}

// Interval label for the tooltip, at the endpoint's granularity.
function intervalLabel(
  ts: string,
  granularity: "hour" | "day" | "month",
): string {
  const date = new Date(ts);
  if (granularity === "hour") {
    return date.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (granularity === "day") {
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

// The chart's geometry in percent of the plot box: the top band
// reserves room so the topmost gridline's label never clips above
// the plot, the value scale runs from zero at the baseline.
const PLOT_H = 144;
const PLOT_PAD = 12;

// X tick labels across the full period window, at the centers of
// the window's idealized buckets - data or not: a week labels all
// seven days even while only part of it has data yet, a month its
// quarter days, a year its months, a day every third hour. The
// label centers on where its bucket sits on the window's scale, so
// it lines up with its bar once that bar exists.
function axisTicks(
  fromMs: number,
  toMs: number,
  granularity: "hour" | "day" | "month",
): { pct: number; label: string }[] {
  const span = toMs - fromMs;
  // The local date key at an instant, the app's Europe/Amsterdam
  // convention, for the weekday and month names.
  const dateKeyAt = (ms: number) => localDateOf(new Date(ms).toISOString());
  if (granularity === "hour") {
    return [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
      pct: ((hour + 0.5) / 24) * 100,
      label: String(hour).padStart(2, "0"),
    }));
  }
  if (granularity === "month") {
    return Array.from({ length: 12 }, (_, month) => {
      const dateKey = dateKeyAt(fromMs + ((month + 0.5) / 12) * span);
      return {
        pct: ((month + 0.5) / 12) * 100,
        label: new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-GB", {
          month: "short",
        }),
      };
    });
  }
  const days = Math.max(1, Math.round(span / 86_400_000));
  if (days <= 7) {
    // A week: every day labeled, the whole period visible.
    return Array.from({ length: days }, (_, day) => {
      const dateKey = dateKeyAt(fromMs + (day + 0.5) * 86_400_000);
      return {
        pct: ((day + 0.5) / days) * 100,
        label: new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-GB", {
          weekday: "short",
        }),
      };
    });
  }
  // A month: its quarter days.
  return [1, 8, 15, 22]
    .filter((day) => day <= days)
    .map((day) => ({
      pct: ((day - 1 + 0.5) / days) * 100,
      label: String(day),
    }));
}

// The gas section for the active period: a time-anchored bar series at
// the endpoint's granularity (hourly for day, daily for week and
// month, monthly for year) plus totals, over a zero-baseline y axis
// with a nice-step scale and x ticks centered on the bars. The bars
// carry the muted terracotta of the data-viz palette; an interval
// without a price reads dimmer, with a stub height. The Energy/Cost
// mode picks the primary axis - m3 or EUR - and the other dimension
// stays visible as a secondary value; the mode only restyles, it
// never refetches. Tooltips always carry all three numbers: m3,
// EUR per m3 and cost. An interval without a price shows "price
// unknown" and no cost, never 0.
function GasSection({
  data,
  status,
}: {
  data: GasUsageData | null;
  status: "loading" | "ok" | "error";
}) {
  const { mode } = useMode();
  // The hovered instant; the tooltip reads the bucket that contains
  // it, and a thin guide line marks that bucket's center. Declared
  // before the early returns so the hook's order is stable.
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  // The panel's shape-matched skeleton: the PanelHeader's two
  // lines, the totals stat row, the chart's fixed-height plot with
  // its axis label row. The reveal sits in the same tree position
  // for every branch; an error is not loading.
  const loading = status === "loading" && data === null;
  const skeleton = (
    <Card className="min-h-48" aria-busy="true">
      <div className="grid auto-rows-min items-start gap-1 px-4">
        <Skeleton className="h-[24.75px] w-20" />
        <Skeleton className="h-5 w-56" />
      </div>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {[0, 1].map((index) => (
            <div key={index} className="flex flex-col gap-1">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        {/* The chart block spans the card's full content width like
            every other row - the loaded plot's y-axis gutter offset
            is a detail of the rendered chart, not a shape the
            skeleton needs to carry. */}
        <Skeleton className="mt-4 h-36 w-full rounded-lg" />
      </CardContent>
    </Card>
  );

  if (status === "error" || data === null) {
    return (
      <SkeletonReveal loading={loading} skeleton={skeleton}>
        {status === "error" ? (
          <Card>
            <CardContent className="text-sm text-subtle-foreground">
              Could not load gas data. Try again in a moment.
            </CardContent>
          </Card>
        ) : null}
      </SkeletonReveal>
    );
  }

  const fromMs = Date.parse(data.window.start);
  const toMs = Date.parse(data.window.end);
  const pct = (ms: number) =>
    Math.min(100, Math.max(0, ((ms - fromMs) / (toMs - fromMs)) * 100));
  const primary = (interval: { m3: number; cost_eur: number | null }) =>
    mode === "cost" ? interval.cost_eur : interval.m3;
  const max = Math.max(
    0.001,
    ...data.series.map((interval) => primary(interval) ?? 0),
  );
  const step = niceStep(max / 3);
  const axisMax = step * 3;
  // A value's y position in percent of the plot box, with the top
  // band reserved for the topmost label.
  const yPct = (value: number) =>
    ((PLOT_PAD + (1 - Math.min(value / axisMax, 1)) * (PLOT_H - PLOT_PAD)) /
      PLOT_H) *
    100;
  const tickLabel = (value: number): string =>
    mode === "cost"
      ? `€${value < 1 ? value.toFixed(2) : value.toFixed(1)}`
      : value < 10
        ? value.toFixed(1)
        : String(Math.round(value));
  // The totals in the period-summary stat idiom: label above, big
  // bold value below; the mode's primary dimension leads.
  const stats =
    mode === "cost"
      ? [
          { label: "Cost", value: `€${data.totals.cost_eur.toFixed(2)}` },
          { label: "Gas use", value: `${data.totals.m3.toFixed(2)} m3` },
        ]
      : [
          { label: "Gas use", value: `${data.totals.m3.toFixed(2)} m3` },
          { label: "Cost", value: `€${data.totals.cost_eur.toFixed(2)}` },
        ];
  const ticks = axisTicks(fromMs, toMs, data.granularity);
  const hoveredIndex =
    hoverMs === null
      ? null
      : (() => {
          const index = data.series.findIndex((interval) => {
            const startMs = Date.parse(interval.ts);
            return (
              hoverMs >= startMs &&
              hoverMs < bucketEndMs(interval.ts, data.granularity)
            );
          });
          return index === -1 ? null : index;
        })();
  const hovered = hoveredIndex === null ? null : data.series[hoveredIndex];
  let hoveredCenterPct: number | null = null;
  if (hovered !== null) {
    const left = pct(Date.parse(hovered.ts));
    const slotWidth = Math.max(
      pct(bucketEndMs(hovered.ts, data.granularity)) - left,
      0.4,
    );
    hoveredCenterPct = left + slotWidth / 2;
  }

  return (
    <SkeletonReveal loading={false} skeleton={skeleton}>
      <Card>
        <PanelHeader
          icon={Flame}
          title="Gas"
          description="Gas use and cost for the period"
        />
        <CardContent>
          {/* The totals as the period-summary stat row: small muted
            label, big bold value, no cards. No top margin: the card's
            own header gap seats the block, and the matching margin
            below centers it between the subtitle and the chart. */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {stats.map((stat) => (
              <div key={stat.label}>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            {/* The y-axis labels, on the gridlines. */}
            <div className="relative h-36 w-8 shrink-0 text-[10px] text-subtle-foreground tabular-nums">
              {/* The axis unit: the mode's primary dimension. */}
              <span className="absolute -top-3.5 left-0">
                {mode === "cost" ? "\u20AC" : "m3"}
              </span>
              {[axisMax, step * 2, step, 0].map((value) => (
                <span
                  key={value}
                  className="pointer-events-none absolute right-0 -translate-y-1/2"
                  style={{ top: `${yPct(value)}%` }}
                >
                  {tickLabel(value)}
                </span>
              ))}
            </div>
            <div
              className="relative h-36 w-full"
              onMouseMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const frac = Math.min(
                  1,
                  Math.max(0, (event.clientX - rect.left) / rect.width),
                );
                setHoverMs(fromMs + frac * (toMs - fromMs));
              }}
              onMouseLeave={() => setHoverMs(null)}
            >
              {/* The gridlines above the baseline. */}
              {[axisMax, step * 2, step].map((value) => (
                <div
                  key={value}
                  className="pointer-events-none absolute inset-x-0 border-t border-foreground/10"
                  style={{ top: `${yPct(value)}%` }}
                  aria-hidden="true"
                />
              ))}
              {data.series.map((interval) => {
                const startMs = Date.parse(interval.ts);
                const left = pct(startMs);
                const slotWidth = Math.max(
                  pct(bucketEndMs(interval.ts, data.granularity)) - left,
                  0.4,
                );
                // The bar occupies the middle 60 percent of its bucket,
                // centered - the solar production chart's day-view
                // idiom, so neighboring bars never touch.
                const value = primary(interval);
                const known = value !== null;
                return (
                  <div
                    key={interval.ts}
                    className={`absolute bottom-0 rounded-t-sm ${
                      known ? "bg-[#a86538]" : "bg-[#a86538]/40"
                    }`}
                    style={{
                      left: `${left + slotWidth * 0.2}%`,
                      width: `${slotWidth * 0.6}%`,
                      height: known
                        ? `${(value / axisMax) * (1 - PLOT_PAD / PLOT_H) * 100}%`
                        : "1.5%",
                    }}
                  />
                );
              })}
              {hoveredCenterPct !== null && (
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-foreground/20"
                  style={{ left: `${hoveredCenterPct}%` }}
                  aria-hidden="true"
                />
              )}
              {hovered !== null && (
                <div
                  className="pointer-events-none absolute top-1/2 z-10 min-w-40 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
                  style={{
                    left: `${Math.min(Math.max(hoveredCenterPct ?? 50, 12), 88)}%`,
                  }}
                >
                  <p className="text-xs font-medium">
                    {intervalLabel(hovered.ts, data.granularity)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {`${hovered.m3.toFixed(2)} m3`}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {hovered.price_eur_per_m3 === null
                      ? "price unknown"
                      : hovered.cost_eur === null
                        ? `€${hovered.price_eur_per_m3.toFixed(4)}/m3 · cost unknown`
                        : `€${hovered.price_eur_per_m3.toFixed(4)}/m3 · €${hovered.cost_eur.toFixed(2)}`}
                  </p>
                </div>
              )}
            </div>
          </div>
          {/* The x-axis labels across the full period window - a
            labeled day with no data yet shows its label and simply
            no bar - centered on each bucket's place on the scale. */}
          <div className="flex gap-2">
            <div className="w-8 shrink-0" aria-hidden="true" />
            <div className="relative h-4 w-full text-xs text-subtle-foreground tabular-nums">
              {ticks.map((tick) => (
                <span
                  key={`${tick.pct}-${tick.label}`}
                  className="absolute top-0 -translate-x-1/2"
                  style={{ left: `${tick.pct}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {data.totals.hasUnknownPrice && (
            <p className="mt-2 text-xs text-muted-foreground">
              Some gas in this period has no known price; the cost covers only
              the priced part.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{data.meta.note}</p>
        </CardContent>
      </Card>
    </SkeletonReveal>
  );
}

export default GasSection;
