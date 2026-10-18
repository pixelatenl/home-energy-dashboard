import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type TouchEvent,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";
import SkeletonReveal from "@/components/SkeletonReveal";
import AIContextBox from "@/components/AIContextBox";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Sunrise,
  Sunset,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchWeatherContext,
  fetchWeatherDaily,
  fetchWeatherHourly,
  type WeatherCurrent,
  type WeatherDay,
  type WeatherHour,
} from "@/lib/api";
import { useAiContext } from "@/lib/useAiContext";
import { useDataRefreshListener } from "@/lib/useDataRefresh";
import { amsterdamNow, todayInAmsterdam } from "@/lib/time";

type IconComponent = ComponentType<{ className?: string }>;

// WMO weather interpretation codes mapped to lucide icons.
const WEATHER_ICONS: Record<number, IconComponent> = {
  0: Sun,
  1: CloudSun,
  2: CloudSun,
  3: Cloud,
  45: CloudFog,
  48: CloudFog,
  51: CloudDrizzle,
  53: CloudDrizzle,
  55: CloudDrizzle,
  56: CloudDrizzle,
  57: CloudDrizzle,
  61: CloudRain,
  63: CloudRain,
  65: CloudRain,
  66: CloudRain,
  67: CloudRain,
  71: CloudSnow,
  73: CloudSnow,
  75: CloudSnow,
  77: CloudSnow,
  80: CloudRain,
  81: CloudRain,
  82: CloudRain,
  85: CloudSnow,
  86: CloudSnow,
  95: CloudLightning,
  96: CloudLightning,
  99: CloudLightning,
};

// The score ring's band color: muted, warm-leaning tones from the
// app's shared data-viz palette - muted gold for mostly sunny,
// terracotta for mixed, warm gray for overcast - instead of bright
// signal colors.
function solarScoreColor(score: number): string {
  if (score >= 70) return "hsl(45 45% 42%)"; // mostly sunny
  if (score >= 40) return "hsl(28 40% 42%)"; // mixed
  return "#6b6157"; // overcast
}

function ScoreRing({ score }: { score: number }) {
  const color = solarScoreColor(score);
  return (
    <div
      className="flex size-14 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${color} ${score}%, rgba(138,127,112,0.25) ${score}%)`,
      }}
      title={`Solar score ${score}/100`}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-card text-base font-semibold tabular-nums">
        {score}
      </div>
    </div>
  );
}

function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
  });
}

// Rounds a positive value up to a readable one-or-two significant digit
// number for the Wh axis: 1173 -> 1500, 620 -> 750, 340 -> 400.
function niceCeil(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  const step = steps.find((s) => normalized <= s + 1e-9) ?? 10;
  return step * magnitude;
}

// Color swatches matching the chart elements in HourlyChart.
function ChartLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle-foreground">
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line
            x1="1"
            y1="4"
            x2="15"
            y2="4"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
        Temperature
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-[#8a7f70]/30" />
        Cloud cover
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-[hsl(38_45%_42%)]" />
        PV estimate (Wh)
      </span>
    </div>
  );
}

// Floating tooltip shown while hovering an hour slot of the chart.
function ChartTooltip({
  hour,
  leftPercent,
}: {
  hour: WeatherHour;
  leftPercent: number;
}) {
  const Icon = WEATHER_ICONS[hour.weather_code] ?? Cloud;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-28 -translate-x-1/2 rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
      style={{ left: `${leftPercent}%` }}
    >
      <div className="flex items-center gap-1.5 font-medium tabular-nums">
        <Icon className="size-3.5 shrink-0" />
        {hour.hour.slice(11, 16)} &middot; {hour.temperature.toFixed(1)}
        &deg;C
      </div>
      <div className="text-muted-foreground tabular-nums">
        Cloud {hour.cloud_cover}% &middot; Rain {hour.precipitation_probability}
        %
      </div>
      <div className="text-muted-foreground tabular-nums">
        PV {hour.estimated_pv_wh} Wh
      </div>
    </div>
  );
}

// Hourly strip: temperature curve over cloud-cover shading, with a PV
// estimate bar per hour. Hovering (desktop) or tapping (mobile) a slot
// shows a tooltip with its values.
// A bar with rounded top corners only and a flat base, the solar
// production chart's bar idiom, so the forecast's PV bars match its
// geometry. The radius clamps to the bar's width and height, so a
// short bar never over-rounds.
function pvBarPath(
  x: number,
  width: number,
  top: number,
  base: number,
): string {
  const r = Math.min(5, width / 2, base - top);
  return `M ${x} ${base} V ${top + r} A ${r} ${r} 0 0 1 ${x + r} ${top} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${top + r} V ${base} Z`;
}

function HourlyChart({ hours }: { hours: WeatherHour[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // Suppresses the synthetic mouse events browsers fire after a touch, so
  // the tap toggle is not immediately undone.
  const lastTouchAt = useRef(0);
  // Ticks once a minute so the "Now" marker stays in place.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const width = 960;
  const height = 150;
  // Empty band at the top of the chart so the "Now" label has breathing
  // room above the data.
  const topBand = 18;
  const slot = width / hours.length;
  const temperatures = hours.map((hour) => hour.temperature);
  const minTemp = Math.min(...temperatures);
  const maxTemp = Math.max(...temperatures);
  const maxPv = Math.max(...hours.map((hour) => hour.estimated_pv_wh), 1);
  const x = (index: number) => (index + 0.5) * slot;
  // Temperature axis domain: a low floor (0 degrees, or daily minimum
  // minus 8 when temperatures are near or below zero, so the line is
  // never pinned to the bottom of the chart) and a ceiling slightly
  // above the daily maximum.
  const tempFloor = minTemp < 1 ? minTemp - 8 : 0;
  const tempCeil = Math.max(maxTemp + 2, tempFloor + 1);
  // Shared plot band for both series: the Wh maximum sits at the same
  // height as the temperature maximum, and both scales use the same
  // number of steps (three), so their tick positions and the dashed
  // gridlines coincide - one gridline set serves both axes.
  const bandTop = 34;
  const pvBase = height - 10;
  const bandRange = pvBase - bandTop;
  const yTemp = (temperature: number) =>
    bandTop +
    (1 - (temperature - tempFloor) / (tempCeil - tempFloor)) * bandRange;
  const pvMaxWh = niceCeil(maxPv);
  const pvY = (value: number) => pvBase - (value / pvMaxWh) * bandRange;
  const pvTicks = [
    { value: pvMaxWh, label: pvMaxWh },
    { value: pvMaxWh / 2, label: pvMaxWh / 2 },
    { value: 0, label: 0 },
  ];
  // Gridlines at the shared step positions; they carry both axes' ticks.
  const gridlines = [bandTop, bandTop + bandRange / 2, pvBase];
  const points = hours
    .map((hour, index) => `${x(index)},${yTemp(hour.temperature)}`)
    .join(" ");
  // Temperature scale ticks: the domain ceiling, midpoint and floor,
  // positioned to match the curve band.
  const ticks = [tempCeil, (tempFloor + tempCeil) / 2, tempFloor];
  // "Now" marker: drawn only when the charted day is the current
  // Europe/Amsterdam day and the local time is inside the shown window.
  const now = amsterdamNow(nowTick);
  const chartDate = hours[0]?.hour.slice(0, 10);
  const firstHour = hours.length > 0 ? Number(hours[0].hour.slice(11, 13)) : 0;
  const lastHour =
    hours.length > 0 ? Number(hours[hours.length - 1].hour.slice(11, 13)) : 0;
  const showNow =
    chartDate === now.date &&
    now.fraction >= firstHour &&
    now.fraction <= lastHour + 1;
  const nowX = ((now.fraction - firstHour) / Math.max(hours.length, 1)) * width;

  const indexFromClientX = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const index = Math.floor(
      ((clientX - rect.left) / rect.width) * hours.length,
    );
    return index >= 0 && index < hours.length ? index : null;
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastTouchAt.current < 500) {
      return; // synthetic mouse event after a touch
    }
    setHoveredIndex(indexFromClientX(event.clientX, event.currentTarget));
  };

  // Tap to inspect an hour; tapping the same hour again dismisses the
  // tooltip. touchstart only, so scrolling past the chart stays smooth.
  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    lastTouchAt.current = Date.now();
    const index = indexFromClientX(touch.clientX, event.currentTarget);
    if (index !== null && index === hoveredIndex) {
      setHoveredIndex(null);
      return;
    }
    setHoveredIndex(index);
  };

  // Horizontal anchor for the tooltip, clamped so it stays inside the chart.
  const tooltipLeftPercent =
    hoveredIndex === null
      ? 0
      : Math.min(Math.max(((hoveredIndex + 0.5) / hours.length) * 100, 10), 90);

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative h-36 w-8 shrink-0">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-xs text-subtle-foreground tabular-nums"
              style={{ top: `${(yTemp(tick) / height) * 100}%` }}
            >
              {Math.round(tick)}&deg;
            </span>
          ))}
        </div>
        <div
          className="relative h-36 w-full"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredIndex(null)}
          onTouchStart={handleTouchStart}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="h-36 w-full"
            role="img"
            aria-label="Hourly temperature, cloud cover and PV estimate"
          >
            {hours.map((hour, index) => {
              const pvHeight = (hour.estimated_pv_wh / pvMaxWh) * bandRange;
              return (
                <g key={hour.hour}>
                  <rect
                    x={index * slot}
                    y={topBand}
                    width={slot}
                    height={height - topBand}
                    fill="#8a7f70"
                    opacity={(hour.cloud_cover / 100) * 0.3}
                  />
                  {/* The PV bar, the production chart's idiom: rounded
                      top corners only, flat at the base, never a
                      zero-height bar. */}
                  {pvHeight > 0 && (
                    <path
                      d={pvBarPath(
                        x(index) - slot * 0.3,
                        slot * 0.6,
                        pvBase - pvHeight,
                        pvBase,
                      )}
                      fill="hsl(38 45% 42%)"
                    />
                  )}
                </g>
              );
            })}
            {/* One gridline set, at the shared step positions of both
                the temperature (left) and Wh (right) scales. */}
            {gridlines.map((y) => (
              <line
                key={y}
                x1={0}
                x2={width}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.2}
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {showNow && (
              <line
                x1={nowX}
                x2={nowX}
                y1={topBand}
                y2={height}
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {hoveredIndex !== null && (
              <rect
                x={hoveredIndex * slot}
                y={topBand}
                width={slot}
                height={height - topBand}
                fill="currentColor"
                opacity={0.08}
              />
            )}
            <polyline
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {showNow && (
            <span
              className="pointer-events-none absolute top-0 -translate-x-1/2 text-[10px] text-subtle-foreground"
              style={{
                left: `${((now.fraction - firstHour) / Math.max(hours.length, 1)) * 100}%`,
              }}
            >
              Now
            </span>
          )}
          {hoveredIndex !== null && (
            <ChartTooltip
              hour={hours[hoveredIndex]}
              leftPercent={tooltipLeftPercent}
            />
          )}
        </div>
        {/* Right axis: PV estimate scale in Wh, visually quiet - three
            ticks (0, half, max) plus a small unit label. */}
        <div className="relative h-36 w-8 shrink-0">
          <span className="absolute left-0 top-0 text-[10px] text-subtle-foreground">
            Wh
          </span>
          {pvTicks.map((tick) => (
            <span
              key={tick.value}
              className="absolute left-0 -translate-y-1/2 text-xs text-subtle-foreground tabular-nums"
              style={{ top: `${(pvY(tick.value) / height) * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      {/* The hour row, aligned with the bars: every hour label centers
          exactly on its hour's bar (the slot centers), with the
          sunrise and sunset icons at the plot's edges - hidden on
          narrow widths, where the first and last labels would
          collide with them. The mx-10 padding matches the chart
          row's two w-8 + gap-2 gutters, so the row spans the plot
          width exactly. */}
      <div className="relative mx-10 mt-1 h-4 text-xs text-subtle-foreground tabular-nums">
        <Sunrise
          className="absolute left-0 top-0 hidden size-4 sm:block"
          aria-hidden="true"
        />
        <Sunset
          className="absolute right-0 top-0 hidden size-4 sm:block"
          aria-hidden="true"
        />
        {hours.map((hour, index) => (
          <span
            key={hour.hour}
            className="absolute top-0 -translate-x-1/2"
            style={{
              left: `${((index + 0.5) / hours.length) * 100}%`,
            }}
          >
            {hour.hour.slice(11, 13)}
          </span>
        ))}
      </div>
      <ChartLegend />
    </div>
  );
}

const STRIP_HEIGHT = "h-64";
const DAY_CARD_HEIGHT = "min-h-48";

function DayCard({
  day,
  selected,
  onSelect,
}: {
  day: WeatherDay;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const Icon = WEATHER_ICONS[day.weather_code] ?? Cloud;
  const isToday = day.date === todayInAmsterdam();
  // Cumulative actual production so far against the full-day forecast;
  // the share is capped at 100 percent. Hidden before any production
  // today. Today shows a compact actual/estimate notation on one line so
  // its card keeps the same height as the other day cards (the full
  // sentence is in the hover tooltip).
  const actual = isToday ? (day.actual_today_kwh ?? null) : null;
  const share =
    actual !== null && day.estimated_kwh > 0
      ? Math.min(100, Math.round((actual / day.estimated_kwh) * 100))
      : 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-pressed={selected}
      className={`flex w-full flex-col items-center gap-1.5 rounded-inset border p-3 text-center transition-colors ${
        selected
          ? "border-transparent bg-muted/60 shadow-sm"
          : "border-transparent hover:bg-muted/50"
      } ${DAY_CARD_HEIGHT}`}
    >
      <span className="text-sm font-medium">
        {isToday ? "Today" : weekdayName(day.date)}
      </span>
      <Icon className="size-6" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {Math.round(day.temp_max)} / {Math.round(day.temp_min)} &deg;C
      </span>
      <ScoreRing score={day.solar_score} />
      <span
        className="whitespace-nowrap text-xs text-muted-foreground tabular-nums"
        title={
          actual !== null
            ? `${actual.toFixed(1)} kWh so far (${share}%) of the ${day.estimated_kwh} kWh estimated`
            : undefined
        }
      >
        {actual !== null
          ? `${actual.toFixed(1)}/${day.estimated_kwh} kWh`
          : `${day.estimated_kwh} kWh`}
      </span>
      {actual !== null && (
        <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-[hsl(38_45%_42%)]"
            style={{ width: `${share}%` }}
          />
        </span>
      )}
    </button>
  );
}

// Clips hourly rows to the daylight window (sunrise to sunset, inclusive of
// both edge hours) taken from the daily entry for that date. Falls back to
// the full day when sunrise/sunset are missing or the window matches no
// hours, rather than showing an empty chart.
function clipToDaylight(
  hours: WeatherHour[],
  day: WeatherDay | null,
): WeatherHour[] {
  if (!day?.sunrise || !day?.sunset || hours.length === 0) {
    return hours;
  }
  // Hour strings and sunrise/sunset are local-time ISO, so a prefix
  // comparison on "YYYY-MM-DDTHH" is a valid window test.
  const start = day.sunrise.slice(0, 13);
  const end = day.sunset.slice(0, 13);
  const clipped = hours.filter(
    (hour) => hour.hour.slice(0, 13) >= start && hour.hour.slice(0, 13) <= end,
  );
  return clipped.length > 0 ? clipped : hours;
}

// The current hour's slot shows the "current" analysis values instead of
// the hourly forecast value for that hour; only applies to today's chart.
function withCurrentConditions(
  hours: WeatherHour[],
  current: WeatherCurrent | null,
  dateKey: string | null,
): WeatherHour[] {
  if (!current || !dateKey || hours.length === 0) {
    return hours;
  }
  if (dateKey !== todayInAmsterdam()) {
    return hours;
  }
  const hour = Math.floor(amsterdamNow(Date.now()).fraction);
  return hours.map((row) =>
    Number(row.hour.slice(11, 13)) === hour
      ? {
          ...row,
          temperature: current.temperature ?? row.temperature,
          weather_code: current.weather_code ?? row.weather_code,
          cloud_cover: current.cloud_cover ?? row.cloud_cover,
        }
      : row,
  );
}

// The hourly data on screen. The date the hours belong to travels
// with them, so the strip's title and chart always describe the same
// day - even while a switch to another day is still in flight.
type HourlyData = {
  date: string;
  hours: WeatherHour[];
  current: WeatherCurrent | null;
};

function WeatherForecast() {
  const weatherContext = useAiContext(fetchWeatherContext);
  const [daily, setDaily] = useState<WeatherDay[] | null>(null);
  // Mirrors the loaded days for loadDaily's catch without a state
  // dependency; see the comment on loadDaily.
  const dailyRef = useRef<WeatherDay[] | null>(null);
  const [dailyStatus, setDailyStatus] = useState<"loading" | "ok" | "error">(
    "loading",
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyData | null>(null);
  const [hourlyStatus, setHourlyStatus] = useState<
    "idle" | "loading" | "error"
  >("loading");
  // Increments only for loads that earn a skeleton reveal - the
  // strip's first load and every error retry. A day switch is not one:
  // the chart swaps in place once the hours land, with no loading
  // state in between.
  const [hourlySession, setHourlySession] = useState(0);
  // The hours already fetched per date, so switching back to a viewed
  // day is instant - and the server answers the hourly endpoint from
  // its own forecast cache, so a first view of a day is near-instant
  // too. Cleared on a refresh, which asks for fresh data everywhere.
  const hourlyCache = useRef(
    new Map<string, { hours: WeatherHour[]; current: WeatherCurrent | null }>(),
  );
  // Guards against stale responses when days are clicked in quick
  // succession: only the latest request may apply its result.
  const hourlyRequest = useRef(0);

  // Loads the hourly strip for a date: from the cache when viewed
  // before, from the API otherwise. A day switch keeps the current
  // chart on screen until the new hours land, then swaps them in -
  // no skeleton, no blank. A failure swaps in the error treatment
  // with its retry. State is only updated after the await (or from
  // the cache, synchronously), so this is safe to call from effects.
  const loadHourly = useCallback(async (date: string) => {
    const cached = hourlyCache.current.get(date);
    if (cached) {
      hourlyRequest.current += 1;
      setHourlyData({ date, hours: cached.hours, current: cached.current });
      setHourlyStatus("idle");
      return;
    }
    const request = ++hourlyRequest.current;
    try {
      const result = await fetchWeatherHourly(date);
      if (request !== hourlyRequest.current) {
        return;
      }
      hourlyCache.current.set(date, {
        hours: result.hours,
        current: result.current,
      });
      setHourlyData({ date, hours: result.hours, current: result.current });
      setHourlyStatus("idle");
    } catch {
      if (request !== hourlyRequest.current) {
        return;
      }
      setHourlyStatus("error");
    }
  }, []);

  // Fetches the daily forecast and selects the first day. State is only
  // updated after the await, so this is safe to call from effects.
  const loadDaily = useCallback(
    async (refresh: boolean) => {
      // A refresh keeps the current forecast on screen and updates
      // in place once the response lands; only the initial load
      // shows the skeleton, and a failed refresh leaves the previous
      // forecast standing.
      try {
        const days = await fetchWeatherDaily(5);
        dailyRef.current = days;
        setDaily(days);
        setDailyStatus("ok");
        if (refresh) {
          // A refresh asks for fresh data everywhere, so the hourly
          // cache goes with it; the strip updates in place as the
          // new hours land, never through a skeleton.
          hourlyCache.current.clear();
        }
        if (days.length > 0) {
          setSelectedDate(days[0].date);
          void loadHourly(days[0].date);
        }
      } catch {
        if (!refresh || dailyRef.current === null) {
          setDailyStatus("error");
        }
      }
    },
    [loadHourly],
  );

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void loadDaily(false);
  }, [loadDaily]);

  // Re-fetch immediately when the header refresh button fires. This resets
  // to the first day, like the retry button does.
  const refreshDaily = useCallback(() => void loadDaily(true), [loadDaily]);
  useDataRefreshListener(refreshDaily);

  const selectDay = useCallback(
    (date: string) => {
      setSelectedDate(date);
      void loadHourly(date);
    },
    [loadHourly],
  );

  // The strip only has value during daylight: clip the fetched hours to the
  // sunrise-sunset window of the day they belong to.
  const visibleHours =
    hourlyData !== null
      ? clipToDaylight(
          hourlyData.hours,
          daily?.find((day) => day.date === hourlyData.date) ?? null,
        )
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-title-foreground">
          <Sun className="size-6" aria-hidden="true" />5 day solar forecast
        </CardTitle>
        <CardDescription>
          Solar score and estimated PV yield for the coming days
        </CardDescription>
        {hourlyData && (
          <CardAction>
            <Badge variant="outline" className="text-chip-foreground tabular-nums">
              PV{" "}
              {(
                hourlyData.hours.reduce(
                  (sum, hour) => sum + hour.estimated_pv_wh,
                  0,
                ) / 1000
              ).toFixed(1)}{" "}
              kWh estimated
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The daily grid's reveal through the shared wrapper: the
            skeleton grid owns the flow until the reveal, then the
            two cross-fade in one cell - the manual phase handling
            here stacked both grids when the (cached) forecast
            answered faster than the floor. An error is not loading:
            the honest message fades in like content. */}
        <SkeletonReveal
          loading={dailyStatus === "loading"}
          skeleton={
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton
                  key={index}
                  className={`rounded-inset ${DAY_CARD_HEIGHT}`}
                />
              ))}
            </div>
          }
        >
          {dailyStatus === "error" ? (
            <div
              className={`flex items-center justify-between rounded-inset border border-destructive/30 px-4 ${DAY_CARD_HEIGHT}`}
            >
              <p className="text-sm text-destructive">
                Could not load the weather forecast.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadDaily(true)}
              >
                Retry
              </Button>
            </div>
          ) : daily ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {daily.map((day) => (
                <DayCard
                  key={day.date}
                  day={day}
                  selected={day.date === selectedDate}
                  onSelect={selectDay}
                />
              ))}
            </div>
          ) : null}
        </SkeletonReveal>

        {selectedDate && (
          <div className={`rounded-inset bg-muted/30 p-4 ${STRIP_HEIGHT}`}>
            {/* One skeleton session per first load and error retry
                (keyed by the session counter): the keyed instance
                mounts with loading already true, so the floor and
                the cross-fade arm for those alone. A day switch keeps
                the key and the reveal phase - the chart stays up and
                the new hours swap in place. The strip keeps its
                fixed height throughout. */}
            <SkeletonReveal
              key={hourlySession}
              className="h-full"
              loading={hourlyStatus === "loading"}
              skeleton={
                <Skeleton
                  variant="block"
                  className="h-full w-full rounded-lg"
                />
              }
            >
              {hourlyStatus === "error" && (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <p className="text-sm text-destructive">
                    Could not load the hourly forecast.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setHourlySession((value) => value + 1);
                      setHourlyStatus("loading");
                      void loadHourly(selectedDate);
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {visibleHours && visibleHours.length > 0 && hourlyData && (
                <div className="flex h-full flex-col gap-2">
                  <div className="text-sm">
                    <span className="font-medium">
                      {hourlyData.date === todayInAmsterdam()
                        ? "Today"
                        : new Date(
                            `${hourlyData.date}T12:00:00`,
                          ).toLocaleDateString("en-GB", {
                            weekday: "long",
                            day: "numeric",
                            month: "short",
                          })}
                    </span>
                  </div>
                  <HourlyChart
                    hours={withCurrentConditions(
                      visibleHours,
                      hourlyData.current,
                      hourlyData.date,
                    )}
                  />
                </div>
              )}
            </SkeletonReveal>
          </div>
        )}

        <AIContextBox {...weatherContext} />
      </CardContent>
    </Card>
  );
}

export default WeatherForecast;
