import { useCallback, useEffect, useState, type MouseEvent } from "react";
import AIContextBox from "@/components/AIContextBox";
import PanelHeader from "@/components/PanelHeader";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Euro } from "lucide-react";
import {
  fetchPriceContext,
  fetchPrices,
  type CheapestBlock,
  type PriceHour,
  type PriceSource,
} from "@/lib/api";
import { useAiContext } from "@/lib/useAiContext";
import { useDataRefreshListener } from "@/lib/useDataRefresh";
import {
  amsterdamNow,
  localDateOf,
  localHourOf,
  localTimeOf,
  todayInAmsterdam,
} from "@/lib/time";

interface PreparedHour {
  hour: number; // local hour slot 0-23
  price: number | null;
  source: PriceSource;
  ts: string;
}

// Every price reads at two decimals - the human register; the exact
// per-kWh values stay in the payload and the debug views.
function formatPrice(value: number | null): string {
  return value === null ? "\u2014" : `€${value.toFixed(2)}`;
}

// Green (cheap) through neutral to red (expensive), relative to the day's
// own min and max - muted and mid-dark, the same depth as the usage
// treemap's palette, so the bars sit with the warm glass aesthetic
// instead of bright signal colors.
function priceColor(price: number, min: number, max: number): string {
  const span = max - min || 1;
  const t = Math.min(1, Math.max(0, (price - min) / span));
  const hue = 140 * (1 - t);
  return `hsl(${hue} 40% 38%)`;
}

function prepareHours(hours: PriceHour[], dateKey: string): PreparedHour[] {
  return hours
    .filter((hour) => localDateOf(hour.ts) === dateKey)
    .map((hour) => ({
      hour: localHourOf(hour.ts),
      price: hour.price_eur,
      source: hour.source,
      ts: hour.ts,
    }));
}

// Bar chart for one day's hours. The cheapest block is outlined and the
// "Now" marker is drawn in the same style as the weather hourly strip.
// Floating tooltip shown while hovering an hour slot of the chart.
function PriceTooltip({
  hour,
  average,
  leftPercent,
}: {
  hour: PreparedHour;
  average: number | null;
  leftPercent: number;
}) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-28 -translate-x-1/2 whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
      style={{ left: `${leftPercent}%` }}
    >
      <div className="font-medium tabular-nums">
        {String(hour.hour).padStart(2, "0")}:00 &middot;{" "}
        {formatPrice(hour.price)}
      </div>
      <div className="text-muted-foreground tabular-nums">
        {hour.source === "db" ? "measured" : "forecast"}
        {average !== null && ` · avg ${formatPrice(average)}`}
      </div>
    </div>
  );
}

function PriceBars({
  hours,
  average,
  nowFraction,
  block,
  scale,
}: {
  hours: PreparedHour[];
  average: number | null;
  nowFraction: number | null;
  block: { startHour: number; endHour: number } | null;
  // Shared min/max across charts, so a euro has the same bar height and
  // color everywhere; falls back to the chart's own range when omitted.
  scale?: { min: number; max: number } | null;
}) {
  const width = 960;
  const height = 150;
  // The top band leaves room for the two stacked labels ("Now" and
  // "cheapest window"); the bars, the marker line and the window outline
  // all start below it.
  const top = 32;
  const base = height - 16;
  const slot = width / 24;
  const prices = hours
    .map((hour) => hour.price)
    .filter((price): price is number => price !== null);
  const min = scale?.min ?? (prices.length > 0 ? Math.min(...prices) : 0);
  const max =
    scale?.max ?? (prices.length > 0 ? Math.max(...prices, average ?? 0) : 0);
  const scaleMax = max > 0 ? max : 0.05;
  const y = (price: number) => base - (price / scaleMax) * (base - top);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * 24);
    setHoveredIndex(index >= 0 && index < 24 ? index : null);
  };
  const hoveredHour =
    hoveredIndex !== null
      ? (hours.find(
          (hour) => hour.hour === hoveredIndex && hour.price !== null,
        ) ?? null)
      : null;
  // Horizontal anchor for the tooltip, clamped so it stays inside the chart.
  const tooltipLeftPercent =
    hoveredHour === null
      ? 0
      : Math.min(Math.max(((hoveredHour.hour + 0.5) / 24) * 100, 10), 90);

  return (
    <div>
      <div
        className="relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-36 w-full"
          role="img"
          aria-label="Hourly electricity prices"
        >
          {hours.map((hour) => {
            if (hour.price === null) {
              return null;
            }
            const barHeight = Math.max(0, base - y(hour.price));
            return (
              <rect
                key={hour.ts}
                x={hour.hour * slot + slot * 0.15}
                y={y(hour.price)}
                width={slot * 0.7}
                height={barHeight}
                rx={2}
                fill={priceColor(hour.price, min, max)}
              />
            );
          })}
          {hoveredIndex !== null && (
            <rect
              x={hoveredIndex * slot}
              y={0}
              width={slot}
              height={height}
              fill="currentColor"
              opacity={0.08}
            />
          )}
          {average !== null && (
            <line
              x1={0}
              x2={width}
              y1={y(average)}
              y2={y(average)}
              stroke="currentColor"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {block && (
            <rect
              x={block.startHour * slot + 2}
              y={top}
              width={(block.endHour - block.startHour) * slot - 4}
              height={height - top - 2}
              rx={6}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* The Now marker pins to the current hour's bar center -
              "now" in the hourly price context is that hour's price,
              so it jumps one bar at each hour boundary instead of
              gliding through it. */}
          {nowFraction !== null && (
            <line
              x1={((Math.floor(nowFraction) + 0.5) / 24) * width}
              x2={((Math.floor(nowFraction) + 0.5) / 24) * width}
              y1={top}
              y2={height}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="2 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {nowFraction !== null && (
          <span
            className="pointer-events-none absolute top-0 -translate-x-1/2 text-[10px] text-subtle-foreground"
            style={{
              left: `${((Math.floor(nowFraction) + 0.5) / 24) * 100}%`,
            }}
          >
            Now
          </span>
        )}
        {block && (
          <span
            className="pointer-events-none absolute top-4 -translate-x-1/2 whitespace-nowrap text-[10px] text-subtle-foreground"
            style={{
              left: `${((block.startHour + block.endHour) / 2 / 24) * 100}%`,
            }}
          >
            Cheapest remaining window
          </span>
        )}
        {hoveredHour && (
          <PriceTooltip
            hour={hoveredHour}
            average={average}
            leftPercent={tooltipLeftPercent}
          />
        )}
      </div>
      {/* The hour labels sit centered under their bars - the label 12
          beneath the 12th bar, the price of that hour - not at the
          slot boundary where the hour starts. */}
      <div className="relative mt-1 h-4 text-xs text-subtle-foreground tabular-nums">
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => (
          <span
            key={hour}
            className="absolute top-0 -translate-x-1/2"
            style={{ left: `${((hour + 0.5) / 24) * 100}%` }}
          >
            {String(hour).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}

// Color swatches matching the chart elements in PriceBars.
function PriceChartLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className="h-3 w-6 rounded-sm"
          style={{
            background:
              "linear-gradient(90deg, hsl(140 40% 38%), hsl(0 40% 38%))",
          }}
        />
        Hourly price (green cheap, red expensive)
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line
            x1="1"
            y1="4"
            x2="15"
            y2="4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="4 2"
          />
        </svg>
        Average
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-[6px] border" />
        Cheapest remaining window
      </span>
    </div>
  );
}

// Block trimmed to one chart day: only when start and end fall on the same
// date as the chart.
function blockForDate(
  block: CheapestBlock | null,
  dateKey: string,
): { startHour: number; endHour: number } | null {
  if (!block) {
    return null;
  }
  if (
    localDateOf(block.start) !== dateKey ||
    localDateOf(block.end) !== dateKey
  ) {
    return null;
  }
  return {
    startHour: localHourOf(block.start),
    endHour: localHourOf(block.end),
  };
}

function blockLabel(block: CheapestBlock): string {
  const sameDay = localDateOf(block.start) === localDateOf(block.end);
  const start = `${localTimeOf(block.start)}`;
  const end = `${sameDay ? "" : "+1d "}${localTimeOf(block.end)}`;
  return `${start} - ${end}`;
}

function PricesWidget() {
  const priceContext = useAiContext(fetchPriceContext);
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof fetchPrices>
  > | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  // Ticks once a minute so the "Now" marker stays in place.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await fetchPrices(2);
      setSummary(data);
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  // Re-fetch immediately when the header refresh button fires.
  useDataRefreshListener(load);

  const today = todayInAmsterdam();
  const tomorrow = localDateOf(
    new Date(nowTick + 24 * 3_600_000).toISOString(),
  );
  const now = amsterdamNow(nowTick);
  const todayHours = summary ? prepareHours(summary.hours, today) : [];
  const tomorrowHours = summary ? prepareHours(summary.hours, tomorrow) : [];
  const currentPrice =
    todayHours.find((hour) => hour.hour === Math.floor(now.fraction))?.price ??
    null;
  const peak = todayHours.reduce<PreparedHour | null>((best, hour) => {
    if (hour.price === null) {
      return best;
    }
    return !best || (best.price ?? -Infinity) < hour.price ? hour : best;
  }, null);
  const block = summary?.cheapest_block ?? null;
  // The day's actual cheapest window, whole-day, from the server: the
  // same single source the advisory card reads, so the two surfaces
  // can never disagree about the day's cheapest hours.
  const dayBlock = summary?.day_cheapest_block ?? null;
  // Shared price scale across both days so a euro always has the same bar
  // height and color in today's and tomorrow's charts.
  const allPrices = summary
    ? [...todayHours, ...tomorrowHours]
        .map((hour) => hour.price)
        .filter((price): price is number => price !== null)
    : [];
  const sharedScale =
    allPrices.length > 0
      ? { min: Math.min(...allPrices), max: Math.max(...allPrices) }
      : null;

  // The skeleton mirrors the panel's composition - header, three
  // stat columns, the two chart blocks with their captions, the
  // legend row and the AI context box - so the panel keeps its
  // height while loading and nothing shifts when the prices land.
  const skeleton = (
    <Card aria-busy="true">
      <div className="flex flex-col gap-1 px-4 pt-4">
        {/* The header rows' exact heights: the title's text-lg at
            leading-snug (24.75 px), the description's text-sm line
            (20 px). */}
        <Skeleton className="h-[24.75px] w-40" />
        <Skeleton className="h-5 w-72" />
      </div>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex flex-col gap-1">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
        <div className="rounded-inset bg-muted/30 p-4">
          <Skeleton className="h-36 w-full rounded-md" />
          <Skeleton className="mt-1 h-4 w-1/2" />
          <Skeleton className="mt-1 h-4 w-2/3" />
        </div>
        <div className="rounded-inset bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="mt-2 h-36 w-full rounded-md" />
          <Skeleton className="mt-1 h-4 w-1/2" />
        </div>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24 w-full rounded-inset" />
      </CardContent>
    </Card>
  );

  return (
    <SkeletonReveal loading={status === "loading"} skeleton={skeleton}>
      <Card>
        <PanelHeader
          icon={Euro}
          title="Electricity prices"
          description="Hourly tariffs including VAT, with the cheapest window highlighted"
        />
        <CardContent className="space-y-4">
          {status === "error" && (
            <div className="flex min-h-72 items-center justify-between rounded-inset border border-destructive/30 px-4">
              <p className="text-sm text-destructive">
                Could not load the prices.
              </p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          )}
          {status === "ok" && summary && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Now</p>
                  <p className="text-3xl font-semibold tabular-nums">
                    {formatPrice(currentPrice)}
                  </p>
                  <p className="text-xs text-muted-foreground">€/kWh</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Today&rsquo;s average
                  </p>
                  <p className="text-3xl font-semibold tabular-nums">
                    {formatPrice(summary.today.average)}
                  </p>
                  <p className="text-xs text-muted-foreground">€/kWh</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Today&rsquo;s peak
                  </p>
                  <p className="text-3xl font-semibold tabular-nums">
                    {formatPrice(peak?.price ?? null)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {peak ? `at ${String(peak.hour).padStart(2, "0")}:00` : ""}
                  </p>
                </div>
              </div>

              {/* Same muted strip background as the battery and forecast
                charts. */}
              <div className="rounded-inset bg-muted/30 p-4">
                <PriceBars
                  hours={todayHours}
                  average={summary.today.average}
                  nowFraction={now.date === today ? now.fraction : null}
                  block={blockForDate(block, today)}
                  scale={sharedScale}
                />
                {block && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Cheapest remaining window {blockLabel(block)} &middot; avg{" "}
                    {formatPrice(block.average_price)}
                  </p>
                )}
                {dayBlock &&
                  (!block || blockLabel(dayBlock) !== blockLabel(block)) && (
                    // The day's actual cheapest hours, named when they
                    // differ from what remains - one source with the
                    // advisory card.
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cheapest today {blockLabel(dayBlock)} &middot; avg{" "}
                      {formatPrice(dayBlock.average_price)}
                    </p>
                  )}
              </div>

              <div className="rounded-inset bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Tomorrow</span>
                  {summary.tomorrow.available && tomorrowHours.length > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      avg {formatPrice(summary.tomorrow.average)} &middot; min{" "}
                      {formatPrice(summary.tomorrow.min)} &middot; max{" "}
                      {formatPrice(summary.tomorrow.max)}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  {summary.tomorrow.available && tomorrowHours.length > 0 ? (
                    <PriceBars
                      hours={tomorrowHours}
                      average={summary.tomorrow.average}
                      nowFraction={null}
                      block={blockForDate(block, tomorrow)}
                      scale={sharedScale}
                    />
                  ) : (
                    // The unpublished state keeps the chart's exact
                    // height - the bars (h-36) plus the hour label row
                    // (mt-1 h-4) - so the panel never changes height the
                    // moment tomorrow's prices drop in.
                    <div className="flex h-41 items-center justify-center rounded-lg bg-card text-sm text-subtle-foreground">
                      Tomorrow&rsquo;s prices are not published yet
                    </div>
                  )}
                </div>
              </div>

              <PriceChartLegend />

              <AIContextBox {...priceContext} />
            </>
          )}
        </CardContent>
      </Card>
    </SkeletonReveal>
  );
}

export default PricesWidget;
