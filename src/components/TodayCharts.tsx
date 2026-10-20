import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import InfoTooltip from "@/components/InfoTooltip";
import SkeletonReveal from "@/components/SkeletonReveal";
import StatCardLink from "@/components/StatCardLink";
import StatCardSkeleton from "@/components/StatCardSkeleton";
import { BatteryCharging, Sun } from "lucide-react";
import {
  fetchWeatherHourly,
  type BatteryFlowHour,
  type PvFlowHour,
  type WeatherHour,
} from "@/lib/api";
import {
  CHARGING_COLOR,
  DISCHARGING_COLOR,
  SOLAR_COLOR,
} from "@/lib/flowDiagram";
import { HUB_LINKS } from "@/lib/hubLinks";
import { STAT_HEADLINE } from "@/lib/statCard";
import { useSummary } from "@/lib/useSummary";
import { useDataRefreshListener } from "@/lib/useDataRefresh";
import {
  amsterdamNow,
  todayInAmsterdam,
  localHourFractionOf,
} from "@/lib/time";

// The compact "today" chart cards of the stats hub: actual hourly
// solar production against the forecast curve, and hourly battery
// charge versus discharge. Each card is its own stats-hub cell -
// fetching its own summary slice, riding the shared full-day time
// axis with the now marker - and leads with its day total so the
// curves read with their value. No axes or gridlines; the animated
// flow lines on the live page carry the emotional weight, these
// carry the numbers.

// Shared chart geometry: a wide, short viewBox stretched to the card
// width; strokes use non-scaling so the stretch does not distort them.
const TODAY_CHART_W = 240;
const TODAY_CHART_H = 48;

// The two cards' tooltips: what each headline and curve reads.
const SOLAR_TODAY_TOOLTIP =
  "Actual solar production today: the headline is the day total so far, the curve the hourly output, with the dashed line the hourly forecast. Self usage is the share of today's solar the home consumed on site instead of feeding it into the grid.";
const BATTERY_TODAY_TOOLTIP =
  "Energy moved through the battery today: charged in green above the zero line, discharged in amber below, per hour. The headline is the day's charged total.";

// Palette: the flow's solar yellow for actual production; the
// battery's muted green/amber pair for charge and discharge (the
// flow diagram's shared battery palette).

// The now marker's x position for the full-day 0-24h axis.
function nowXOf(nowFraction: number): number {
  return (Math.min(Math.max(nowFraction, 0), 24) / 24) * TODAY_CHART_W;
}

// The live output sentence beneath the main stat value: "Now
// producing 2553 W" with the number emphasized, or the honest absence
// when nothing is producing (night, or the sensor unreachable).
function NowProducing({ watts }: { watts: number | null }) {
  if (watts === null || watts <= 0) {
    return <>No current solar production</>;
  }
  return (
    <>
      Now producing{" "}
      <span className="font-medium tabular-nums text-foreground">
        {watts} W
      </span>
    </>
  );
}

// The now marker's x position updates once a minute so the charts
// follow the clock; amsterdamNow resolves the local fraction of day.
function useNowFraction(): number {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return amsterdamNow(nowTick).fraction;
}

// The solar chart's legend: the produced line's yellow against the
// dashed forecast curve's white, with matching swatch shapes.
function TodaySolarLegend() {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-4 rounded-sm"
          style={{ backgroundColor: SOLAR_COLOR }}
        />
        Produced
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line
            x1="1"
            y1="4"
            x2="15"
            y2="4"
            stroke="white"
            strokeOpacity={0.55}
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        </svg>
        Forecast
      </span>
    </div>
  );
}

// The battery chart's legend: the bar pair's green and amber.
function TodayBatteryLegend() {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-4 rounded-sm"
          style={{ backgroundColor: CHARGING_COLOR, opacity: 0.7 }}
        />
        Charged
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-4 rounded-sm"
          style={{ backgroundColor: DISCHARGING_COLOR, opacity: 0.7 }}
        />
        Discharged
      </span>
    </div>
  );
}

// "Solar today": the day's production total as the headline figure,
// then the actual hourly production (from the summary's
// pv_flow_hourly) as a stepped subtle area in the flow's solar
// yellow, with the hourly forecast curve (estimated_pv_wh) as a
// dashed overlay.
function TodaySolarChart({
  actual,
  forecast,
  nowFraction,
  producedKwh,
  selfConsumptionPct,
  pvW,
  loading,
}: {
  actual: PvFlowHour[];
  forecast: WeatherHour[] | null;
  nowFraction: number;
  producedKwh: number | null;
  // The share of today's solar the home used on site, moved here
  // from the home usage stat card; carried in the header's chip.
  selfConsumptionPct: number | null;
  // The live PV output in watts, the value's sub-line.
  pvW: number | null;
  // True while the first summary load has not landed yet.
  loading: boolean;
}) {
  // kWh per local hour, both series on the same scale.
  const actualByHour = new Array<number>(24).fill(0);
  for (const hour of actual) {
    actualByHour[localHourFractionOf(hour.ts) | 0] += hour.kwh;
  }
  const forecastByHour = new Array<number>(24).fill(0);
  for (const hour of forecast ?? []) {
    forecastByHour[Number(hour.hour.slice(11, 13))] =
      hour.estimated_pv_wh / 1000;
  }
  const maxKwh = Math.max(...actualByHour, ...forecastByHour, 0.1);
  const y = (kwh: number) =>
    TODAY_CHART_H - (kwh / maxKwh) * (TODAY_CHART_H - 4) - 2;
  // Stepped area under the actual production line, closed at the base.
  const stepPoints: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const left = (hour / 24) * TODAY_CHART_W;
    const right = ((hour + 1) / 24) * TODAY_CHART_W;
    const top = y(actualByHour[hour]);
    stepPoints.push(`${left},${top} ${right},${top}`);
  }
  const areaPoints = `0,${TODAY_CHART_H} ${stepPoints.join(" ")} ${TODAY_CHART_W},${TODAY_CHART_H}`;
  // Forecast curve through the hour midpoints, dashed.
  const forecastPoints = forecastByHour
    .map((kwh, hour) => `${((hour + 0.5) / 24) * TODAY_CHART_W},${y(kwh)}`)
    .join(" ");
  const hasForecast = forecast !== null && forecast.length > 0;
  const hasActual = actual.some((hour) => hour.kwh > 0);

  // The skeleton mirrors the chart card's exact geometry: title,
  // headline, sub-line, one Card gap, then the chart block and the
  // legend row - so the row height never shifts when data lands.
  const skeleton = (
    <StatCardSkeleton stack belowHeadline={<Skeleton className="h-4 w-1/3" />}>
      <div>
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="mt-1.5 h-4 w-1/3" />
      </div>
    </StatCardSkeleton>
  );

  return (
    <SkeletonReveal loading={loading} skeleton={skeleton}>
      <Card className="relative min-h-24 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens today in the Solar tab. */}
        <StatCardLink
          to={HUB_LINKS.solarToday}
          label="Solar today: open today in the Solar tab"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={SOLAR_TODAY_TOOLTIP} />
        </div>
        {/* The Solar forecast's header structure: the title row with
          the self-usage chip, the big value and sub-line beneath. The
          header reserves the corner's fixed clear zone (pr-9, the
          tooltip icon plus its padding) at every width, so the chip
          can never slide under the absolutely positioned icon: it
          flows in the remaining space, and only when the cell is too
          narrow to share the row does it wrap below the title. */}
        <CardHeader className="pr-9">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <CardTitle className="flex items-center gap-1.5 text-title-foreground">
              <Sun className="size-5 shrink-0" aria-hidden="true" />
              Solar today
            </CardTitle>
            <Badge
              variant="outline"
              className="border-white/25 bg-white/15 text-chip-foreground tabular-nums"
            >
              Self usage:{" "}
              {selfConsumptionPct === null
                ? "\u2014"
                : `${Math.round(selfConsumptionPct)}%`}
            </Badge>
          </div>
          <CardTitle
            className={`${STAT_HEADLINE} ${
              producedKwh === null ? "text-muted-foreground" : ""
            }`}
          >
            {producedKwh === null ? "\u2014" : `${producedKwh.toFixed(1)} kWh`}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            <NowProducing watts={pvW} />
          </p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          {!hasActual && !hasForecast ? (
            <p className="mt-2 text-xs text-muted-foreground">No data yet</p>
          ) : (
            <>
              <svg
                viewBox={`0 0 ${TODAY_CHART_W} ${TODAY_CHART_H}`}
                preserveAspectRatio="none"
                className="h-16 w-full"
                role="img"
                aria-label="Hourly solar production today against the forecast"
              >
                <polygon
                  points={areaPoints}
                  fill={SOLAR_COLOR}
                  opacity={0.25}
                />
                <polyline
                  points={stepPoints.join(" ")}
                  fill="none"
                  stroke={SOLAR_COLOR}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
                {hasForecast && (
                  <polyline
                    points={forecastPoints}
                    fill="none"
                    stroke="white"
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <line
                  x1={nowXOf(nowFraction)}
                  x2={nowXOf(nowFraction)}
                  y1={0}
                  y2={TODAY_CHART_H}
                  stroke="white"
                  strokeOpacity={0.5}
                  strokeDasharray="2 3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <TodaySolarLegend />
            </>
          )}
        </CardContent>
      </Card>
    </SkeletonReveal>
  );
}

// "Battery today": the day's charged and discharged totals as the
// headline figure, then the hourly charge as green bars up from the
// zero line and discharge as amber bars down, in the battery panel's
// colors, on the same full-day axis.
function TodayBatteryChart({
  flow,
  nowFraction,
  chargedKwh,
  dischargedKwh,
  loading,
}: {
  flow: BatteryFlowHour[];
  nowFraction: number;
  chargedKwh: number | null;
  dischargedKwh: number | null;
  // True while the first summary load has not landed yet.
  loading: boolean;
}) {
  const zeroY = TODAY_CHART_H / 2;
  const slot = TODAY_CHART_W / 24;
  const byHour = new Map<number, { in: number; out: number }>();
  for (const hour of flow) {
    const key = localHourFractionOf(hour.ts) | 0;
    const entry = byHour.get(key) ?? { in: 0, out: 0 };
    entry.in += hour.in_kwh;
    entry.out += hour.out_kwh;
    byHour.set(key, entry);
  }
  const maxKwh = Math.max(
    ...[...byHour.values()].map((entry) => Math.max(entry.in, entry.out)),
    0.1,
  );
  const scale = (TODAY_CHART_H / 2 - 2) / maxKwh;
  const hasFlow = byHour.size > 0;

  // The same chart-card skeleton as the solar card's.
  const skeleton = (
    <StatCardSkeleton stack belowHeadline={<Skeleton className="h-4 w-1/3" />}>
      <div>
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="mt-1.5 h-4 w-1/3" />
      </div>
    </StatCardSkeleton>
  );

  return (
    <SkeletonReveal loading={loading} skeleton={skeleton}>
      <Card className="relative min-h-24 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens today in the Battery tab. */}
        <StatCardLink
          to={HUB_LINKS.batteryToday}
          label="Battery today: open today in the Battery tab"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={BATTERY_TODAY_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch">
          <CardTitle className="flex items-center gap-1.5 text-title-foreground">
            <BatteryCharging className="size-5 shrink-0" aria-hidden="true" />
            Battery today
          </CardTitle>
          <CardTitle
            className={`${STAT_HEADLINE} ${
              chargedKwh === null ? "text-muted-foreground" : ""
            }`}
          >
            {chargedKwh === null ? "\u2014" : `${chargedKwh.toFixed(1)} kWh`}
          </CardTitle>
          <p className="text-xs text-muted-foreground tabular-nums">
            charged &middot;{" "}
            {dischargedKwh === null
              ? "\u2014"
              : `${dischargedKwh.toFixed(1)} kWh`}{" "}
            discharged
          </p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          {!hasFlow ? (
            <p className="mt-2 text-xs text-muted-foreground">No data yet</p>
          ) : (
            <>
              <svg
                viewBox={`0 0 ${TODAY_CHART_W} ${TODAY_CHART_H}`}
                preserveAspectRatio="none"
                className="h-16 w-full"
                role="img"
                aria-label="Hourly battery charge and discharge today"
              >
                <line
                  x1={0}
                  x2={TODAY_CHART_W}
                  y1={zeroY}
                  y2={zeroY}
                  stroke="white"
                  strokeOpacity={0.3}
                  vectorEffect="non-scaling-stroke"
                />
                {[...byHour.entries()].map(([hour, entry]) => (
                  <g key={hour}>
                    {entry.in > 0 && (
                      <rect
                        x={hour * slot + slot * 0.2}
                        y={zeroY - entry.in * scale}
                        width={slot * 0.6}
                        height={entry.in * scale}
                        fill={CHARGING_COLOR}
                        opacity={0.7}
                      />
                    )}
                    {entry.out > 0 && (
                      <rect
                        x={hour * slot + slot * 0.2}
                        y={zeroY}
                        width={slot * 0.6}
                        height={entry.out * scale}
                        fill={DISCHARGING_COLOR}
                        opacity={0.7}
                      />
                    )}
                  </g>
                ))}
                <line
                  x1={nowXOf(nowFraction)}
                  x2={nowXOf(nowFraction)}
                  y1={0}
                  y2={TODAY_CHART_H}
                  stroke="white"
                  strokeOpacity={0.5}
                  strokeDasharray="2 3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <TodayBatteryLegend />
            </>
          )}
        </CardContent>
      </Card>
    </SkeletonReveal>
  );
}

// The "today" charts widget: solar and battery side by side (stacked
// on narrow widths), one compact card each, riding the shared summary
// cycle and the weather forecast for the solar curve.
// The solar card: its own summary slice plus the hourly weather
// forecast's estimated PV, refreshed with the panel cycle and the
// header refresh button.
export function TodaySolarCard() {
  const { summary, status } = useSummary();
  const nowFraction = useNowFraction();

  // The solar forecast curve for the compact solar chart: the hourly
  // weather endpoint's estimated PV per hour; null keeps the chart on
  // the actual production only. State is only updated after the
  // await, so this is safe to call from effects.
  const [forecastHours, setForecastHours] = useState<WeatherHour[] | null>(
    null,
  );
  const loadForecast = useCallback(async () => {
    try {
      const result = await fetchWeatherHourly(todayInAmsterdam());
      setForecastHours(result.hours);
    } catch {
      setForecastHours(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void loadForecast();
  }, [loadForecast]);

  // Re-fetch when the header refresh button fires.
  useDataRefreshListener(() => void loadForecast());

  return (
    <TodaySolarChart
      actual={summary?.pv_flow_hourly ?? []}
      forecast={forecastHours}
      nowFraction={nowFraction}
      producedKwh={summary?.today.pv_kwh ?? null}
      selfConsumptionPct={summary?.today.self_consumption_pct ?? null}
      pvW={summary?.flow.pv_w ?? null}
      loading={status === "loading" && summary === null}
    />
  );
}

// The battery card: its own summary slice, no forecast needed.
export function TodayBatteryCard() {
  const { summary, status } = useSummary();
  const nowFraction = useNowFraction();
  return (
    <TodayBatteryChart
      flow={summary?.battery_flow_hourly ?? []}
      nowFraction={nowFraction}
      chargedKwh={summary?.today.battery_charged_kwh ?? null}
      dischargedKwh={summary?.today.battery_discharged_kwh ?? null}
      loading={status === "loading" && summary === null}
    />
  );
}
