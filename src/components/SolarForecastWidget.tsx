import { useCallback, useEffect, useState } from "react";
import { Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import InfoTooltip from "@/components/InfoTooltip";
import SkeletonReveal from "@/components/SkeletonReveal";
import StatCardLink from "@/components/StatCardLink";
import StatCardSkeleton from "@/components/StatCardSkeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchWeatherDaily,
  fetchWeatherHourly,
  type WeatherDay,
  type WeatherHour,
} from "@/lib/api";
import { HUB_LINKS } from "@/lib/hubLinks";
import { STAT_HEADLINE } from "@/lib/statCard";
import { useSummary } from "@/lib/useSummary";
import { amsterdamNow, todayInAmsterdam } from "@/lib/time";
import { useDataRefreshListener, useRefetchOnWake } from "@/lib/useDataRefresh";

// The hub's compact solar presence: today's expected production as
// the lead, the live output in the description, the progress of
// actual production toward it and the solar score, all from the
// existing weather endpoints. The full WeatherForecast widget moves
// to the Solar tab in a later phase.

// The card's tooltip: what the estimate and the bar mean.
const FORECAST_TOOLTIP =
  "Today's expected solar production from the hourly forecast model. The bar fills with the actual production so far and the caption compares it with the expected total; the Solar score grades the day's forecast conditions from 0 to 100.";

// Local hour fraction (8.5 for "2026-10-13T08:30") of a local-time ISO
// string, the format the daily sunrise/sunset and hourly labels use.
function localHourFraction(iso: string): number {
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
}

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`;
}

// Ahead, on track or behind: produced so far versus the expected
// fraction at the current time; null while the expectation is too
// small to judge (night, or the first sliver of daylight).
type OnTrack = "ahead" | "on-track" | "behind" | null;

const ON_TRACK_STYLES: Record<Exclude<OnTrack, null>, string> = {
  ahead: "border-emerald-600/30 text-emerald-600 dark:text-emerald-400",
  // On track is the neutral, unremarkable state: the glass
  // furniture's translucent white rather than a colored callout.
  "on-track": "border-white/25 bg-white/15 text-chip-foreground",
  behind: "border-amber-600/30 text-amber-600 dark:text-amber-400",
};

const ON_TRACK_LABELS: Record<Exclude<OnTrack, null>, string> = {
  ahead: "Ahead",
  "on-track": "On track",
  behind: "Behind",
};

function OnTrackBadge({ onTrack }: { onTrack: OnTrack }) {
  // No badge while ahead of the forecast: running ahead needs no
  // callout; only on track and behind are worth a glance.
  if (onTrack === null || onTrack === "ahead") {
    return null;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ON_TRACK_STYLES[onTrack]}`}
    >
      {ON_TRACK_LABELS[onTrack]}
    </span>
  );
}

function SolarForecastWidget() {
  const { summary } = useSummary();
  const [daily, setDaily] = useState<WeatherDay | null>(null);
  const [hourly, setHourly] = useState<WeatherHour[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  // Ticks once a minute so the on-track indicator and progress bar
  // follow the clock, like the full forecast widget's Now marker.
  const [nowTick, setNowTick] = useState(() => Date.now());

  // The daily forecast carries today's estimate, score, daylight
  // window and actual production; the hourly curve refines the
  // expected-so-far fraction. The hourly endpoint 400s for dates
  // without forecast data, which reads here as "no hourly curve" and
  // falls back to the daylight scaling below. State is only updated
  // after the await, so this is safe to call from effects.
  const load = useCallback(async (refresh: boolean) => {
    if (refresh) {
      // A refresh keeps the current content on screen; the data
      // updates in place once the response lands, and a failure
      // leaves the previous forecast standing. Only the initial
      // load shows the skeleton.
    }
    const dateKey = todayInAmsterdam();
    try {
      const [days, hourlyResult] = await Promise.all([
        fetchWeatherDaily(1),
        fetchWeatherHourly(dateKey).catch(() => null),
      ]);
      setDaily(days.find((day) => day.date === dateKey) ?? null);
      setHourly(hourlyResult?.hours ?? null);
      setStatus("ok");
    } catch {
      // On a refresh the previous content stays; only a failed
      // first load reads as an error.
      if (!refresh) {
        setDaily(null);
        setHourly(null);
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load(false);
  }, [load]);

  const refresh = useCallback(() => void load(true), [load]);
  useDataRefreshListener(refresh);
  useRefetchOnWake(refresh);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const now = amsterdamNow(nowTick);

  // Produced so far today. The daily row carries it with a null before
  // the first production; the summary serves the same figure straight
  // from the PV counter, so it also covers the no-forecast state.
  const producedKwh =
    daily?.actual_today_kwh !== undefined && daily.actual_today_kwh !== null
      ? daily.actual_today_kwh
      : (summary?.today.pv_kwh ?? null);

  // Expected-so-far, the reference for the on-track indicator. The
  // hourly curve counts every elapsed hour fully and prorates the
  // current one by the minute.
  let expectedSoFarKwh: number | null = null;
  if (daily && now.date === daily.date) {
    if (hourly !== null && hourly.length > 0) {
      const hour = Math.floor(now.fraction);
      const minutePart = now.fraction - hour;
      let wh = 0;
      for (const row of hourly) {
        const rowHour = Number(row.hour.slice(11, 13));
        if (rowHour < hour) {
          wh += row.estimated_pv_wh;
        } else if (rowHour === hour) {
          wh += row.estimated_pv_wh * minutePart;
        }
      }
      expectedSoFarKwh = wh / 1000;
    } else if (daily.sunrise && daily.sunset) {
      // Simplification: without the hourly curve the daily estimate is
      // spread evenly across the sunrise-to-sunset window. Real
      // production follows a bell curve peaking at solar noon, so this
      // underestimates the expected fraction around midday and
      // overestimates it near the edges; it only applies when the
      // hourly endpoint has no data.
      const start = localHourFraction(daily.sunrise);
      const end = localHourFraction(daily.sunset);
      const progress = Math.min(
        Math.max((now.fraction - start) / (end - start), 0),
        1,
      );
      expectedSoFarKwh = daily.estimated_kwh * progress;
    }
  }

  // Ahead by 10% or more, behind by 10% or more, on track in between;
  // no verdict while the expected-so-far is under 0.1 kWh (night, or
  // the first minutes of daylight).
  let onTrack: OnTrack = null;
  if (expectedSoFarKwh !== null && expectedSoFarKwh >= 0.1) {
    const ratio = (producedKwh ?? 0) / expectedSoFarKwh;
    onTrack = ratio >= 1.1 ? "ahead" : ratio <= 0.9 ? "behind" : "on-track";
  }

  // The skeleton mirrors the forecast composition: title, headline,
  // sub-line, the progress bar and its caption. Only the first load
  // shows it; a refresh keeps the content and updates in place.
  const loading = status === "loading";
  // The skeleton mirrors the forecast card's exact geometry: title,
  // headline and sub-line, one Card gap, then the progress bar zone
  // with its caption - so the row height never shifts.
  const skeleton = (
    <StatCardSkeleton stack belowHeadline={<Skeleton className="h-4 w-1/2" />}>
      <div className="pt-4">
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="mt-1.5 h-4 w-1/2" />
      </div>
    </StatCardSkeleton>
  );

  // No forecast data: the live output and produced so far stay
  // honest; no target, progress or verdict is fabricated.
  if (daily === null) {
    return (
      <SkeletonReveal loading={loading} skeleton={skeleton}>
        <Card className="relative transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
          {/* The whole card opens today in the Solar tab. */}
          <StatCardLink
            to={HUB_LINKS.solarForecast}
            label="Solar forecast: open today in the Solar tab"
          />
          <div className="absolute right-3 top-3 z-20">
            <InfoTooltip text={FORECAST_TOOLTIP} />
          </div>
          {/* The clear zone is unconditional: reserved in the no-data
            state too, so the header geometry never changes when the
            forecast chip appears. */}
          <CardHeader className="pr-9">
            <CardTitle className="flex items-center gap-2 text-title-foreground">
              <Sun className="size-6" aria-hidden="true" />
              Solar forecast
            </CardTitle>
            <p className={`font-heading font-medium ${STAT_HEADLINE}`}>
              {formatKwh(producedKwh)}
            </p>
            <p className="text-sm text-muted-foreground">No forecast data</p>
            <p className="text-xs text-muted-foreground">
              produced so far today
            </p>
          </CardHeader>
        </Card>
      </SkeletonReveal>
    );
  }

  // The day bar.s scale: the forecast level, or the production past it
  // when the day overdelivers, so the bar grows past its own target
  // instead of clipping at 100 percent. Amber fills up to the forecast
  // line, green is everything produced beyond it. The caption
  // percentage stays honest and can read above 100.
  const producedValue = producedKwh ?? 0;
  const barScale = Math.max(producedValue, daily.estimated_kwh, 0.001);
  const forecastPct = (daily.estimated_kwh / barScale) * 100;
  const producedPct = (producedValue / barScale) * 100;
  const overPct = Math.max(0, producedPct - forecastPct);
  const progressPct =
    daily.estimated_kwh > 0
      ? Math.round((producedValue / daily.estimated_kwh) * 100)
      : 0;
  // The forecast mark only earns its place once the day beats its
  // forecast by more than 10 percent; smaller exceedances would leave
  // a mark squeezed against the bar's end, too tight to read.
  const showForecastMark =
    daily.estimated_kwh > 0 && producedValue > daily.estimated_kwh * 1.1;

  return (
    <SkeletonReveal loading={loading} skeleton={skeleton}>
      <Card className="relative transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens today in the Solar tab. */}
        <StatCardLink
          to={HUB_LINKS.solarForecast}
          label="Solar forecast: open today in the Solar tab"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={FORECAST_TOOLTIP} />
        </div>
        <CardHeader className="pr-9">
          {/* The title row: the header's pr-9 reserves the corner's
            fixed clear zone (the tooltip icon plus its padding) at
            every width, so the chip can never slide under the
            absolutely positioned icon - it flows in the remaining
            space, and only when the cell is too narrow to share the
            row does it wrap below the title. */}
          <div className="flex flex-wrap items-center justify-between gap-1">
            <CardTitle className="flex items-center gap-2 text-title-foreground">
              <Sun className="size-6" aria-hidden="true" />
              Solar forecast
            </CardTitle>
            {/* The same glass treatment as the On-track pill: a neutral
              translucent white chip rather than a colored callout. */}
            <Badge
              variant="outline"
              className="border-white/25 bg-white/15 text-chip-foreground tabular-nums"
            >
              Solar score {daily.solar_score}/100
            </Badge>
          </div>
          <p className={`font-heading font-medium ${STAT_HEADLINE}`}>
            {daily.estimated_kwh.toFixed(1)} kWh
          </p>
          <p className="text-xs text-muted-foreground">
            Expected solar production today
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Actual production so far toward the full-day expectation:
            the same amber as the full forecast widget's day bar, with
            the green portion past the forecast level marking the day
            overdelivering its own forecast. Once the exceedance passes
            10 percent, the prices chart's "Now" idiom appears: a
            dashed vertical line at the forecast level, labeled
            "Forecasted" above the bar. The line sits outside the bar's
            clipped container and reaches a little past its top and
            bottom, so it reads as a marker crossing the bar, not a
            scratch inside it. */}
          <div className="relative pt-4">
            {showForecastMark && (
              <span
                className="absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap text-[10px] text-subtle-foreground"
                style={{ left: `${forecastPct}%` }}
              >
                Forecasted
              </span>
            )}
            <div className="relative h-2 overflow-hidden rounded-full bg-muted">
              {/* The produced fill and the beyond-forecast segment ride the
                muted battery/solar amber and green of the app's data-viz
                palette, matching the prices and treemap panels. */}
              <div
                className="absolute inset-y-0 left-0 bg-[hsl(38_45%_42%)]"
                style={{ width: `${Math.min(producedPct, forecastPct)}%` }}
              />
              {overPct > 0 && (
                <div
                  className="absolute inset-y-0 bg-[hsl(140_40%_38%)]"
                  style={{ left: `${forecastPct}%`, width: `${overPct}%` }}
                />
              )}
            </div>
            {/* The dashed forecast marker outside the bar's clipped
              container: from just below the "Forecasted" label to a
              few pixels past the bar's bottom (the bar occupies 16 to
              24 px inside this pt-4 wrapper, the line 14 to 30). */}
            {showForecastMark && (
              <div
                className="absolute top-3.5 h-4 w-0 -translate-x-1/2 border-l border-dashed border-foreground/50"
                style={{ left: `${forecastPct}%` }}
              />
            )}
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatKwh(producedKwh)} so far ({progressPct}% of expected)
              </span>
              <OnTrackBadge onTrack={onTrack} />
            </div>
          </div>
        </CardContent>
      </Card>
    </SkeletonReveal>
  );
}

export default SolarForecastWidget;
