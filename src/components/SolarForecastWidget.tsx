import { useCallback, useEffect, useState } from "react"
import { Sun } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  fetchWeatherDaily,
  fetchWeatherHourly,
  type WeatherDay,
  type WeatherHour,
} from "@/lib/api"
import { useSummary } from "@/lib/useSummary"
import { amsterdamNow, todayInAmsterdam } from "@/lib/time"
import {
  useDataRefreshListener,
  useRefetchOnWake,
} from "@/lib/useDataRefresh"

// The hub's compact solar presence: today's expected production, the
// progress of actual production toward it, the live output and the
// solar score, all from the existing weather endpoints. The full
// WeatherForecast widget moves to the Solar tab in a later phase.

// Local hour fraction (8.5 for "2026-10-13T08:30") of a local-time ISO
// string, the format the daily sunrise/sunset and hourly labels use.
function localHourFraction(iso: string): number {
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60
}

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

// Ahead, on track or behind: produced so far versus the expected
// fraction at the current time; null while the expectation is too
// small to judge (night, or the first sliver of daylight).
type OnTrack = "ahead" | "on-track" | "behind" | null

const ON_TRACK_STYLES: Record<Exclude<OnTrack, null>, string> = {
  ahead: "border-emerald-600/30 text-emerald-600 dark:text-emerald-400",
  "on-track": "border-sky-600/30 text-sky-600 dark:text-sky-400",
  behind: "border-amber-600/30 text-amber-600 dark:text-amber-400",
}

const ON_TRACK_LABELS: Record<Exclude<OnTrack, null>, string> = {
  ahead: "Ahead",
  "on-track": "On track",
  behind: "Behind",
}

function OnTrackBadge({ onTrack }: { onTrack: OnTrack }) {
  if (onTrack === null) {
    return null
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ON_TRACK_STYLES[onTrack]}`}
    >
      {ON_TRACK_LABELS[onTrack]}
    </span>
  )
}

// Live output in watts from the live energy flow snapshot.
function LiveWatts({ watts }: { watts: number | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      Now producing{" "}
      <span className="font-medium tabular-nums text-foreground">
        {watts === null ? "\u2014" : `${watts} W`}
      </span>
    </p>
  )
}

function SolarForecastWidget() {
  const { summary } = useSummary()
  const [daily, setDaily] = useState<WeatherDay | null>(null)
  const [hourly, setHourly] = useState<WeatherHour[] | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">(
    "loading"
  )
  // Ticks once a minute so the on-track indicator and progress bar
  // follow the clock, like the full forecast widget's Now marker.
  const [nowTick, setNowTick] = useState(() => Date.now())

  // The daily forecast carries today's estimate, score, daylight
  // window and actual production; the hourly curve refines the
  // expected-so-far fraction. The hourly endpoint 400s for dates
  // without forecast data, which reads here as "no hourly curve" and
  // falls back to the daylight scaling below. State is only updated
  // after the await, so this is safe to call from effects.
  const load = useCallback(async (refresh: boolean) => {
    if (refresh) {
      setDaily(null)
      setHourly(null)
      setStatus("loading")
    }
    const dateKey = todayInAmsterdam()
    try {
      const [days, hourlyResult] = await Promise.all([
        fetchWeatherDaily(1),
        fetchWeatherHourly(dateKey).catch(() => null),
      ])
      setDaily(days.find((day) => day.date === dateKey) ?? null)
      setHourly(hourlyResult?.hours ?? null)
      setStatus("ok")
    } catch {
      setDaily(null)
      setHourly(null)
      setStatus("error")
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load(false)
  }, [load])

  const refresh = useCallback(() => void load(true), [load])
  useDataRefreshListener(refresh)
  useRefetchOnWake(refresh)

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const now = amsterdamNow(nowTick)

  // Produced so far today. The daily row carries it with a null before
  // the first production; the summary serves the same figure straight
  // from the PV counter, so it also covers the no-forecast state.
  const producedKwh =
    daily?.actual_today_kwh !== undefined && daily.actual_today_kwh !== null
      ? daily.actual_today_kwh
      : (summary?.today.pv_kwh ?? null)

  // Expected-so-far, the reference for the on-track indicator. The
  // hourly curve counts every elapsed hour fully and prorates the
  // current one by the minute.
  let expectedSoFarKwh: number | null = null
  if (daily && now.date === daily.date) {
    if (hourly !== null && hourly.length > 0) {
      const hour = Math.floor(now.fraction)
      const minutePart = now.fraction - hour
      let wh = 0
      for (const row of hourly) {
        const rowHour = Number(row.hour.slice(11, 13))
        if (rowHour < hour) {
          wh += row.estimated_pv_wh
        } else if (rowHour === hour) {
          wh += row.estimated_pv_wh * minutePart
        }
      }
      expectedSoFarKwh = wh / 1000
    } else if (daily.sunrise && daily.sunset) {
      // Simplification: without the hourly curve the daily estimate is
      // spread evenly across the sunrise-to-sunset window. Real
      // production follows a bell curve peaking at solar noon, so this
      // underestimates the expected fraction around midday and
      // overestimates it near the edges; it only applies when the
      // hourly endpoint has no data.
      const start = localHourFraction(daily.sunrise)
      const end = localHourFraction(daily.sunset)
      const progress = Math.min(
        Math.max((now.fraction - start) / (end - start), 0),
        1
      )
      expectedSoFarKwh = daily.estimated_kwh * progress
    }
  }

  // Ahead by 10% or more, behind by 10% or more, on track in between;
  // no verdict while the expected-so-far is under 0.1 kWh (night, or
  // the first minutes of daylight).
  let onTrack: OnTrack = null
  if (expectedSoFarKwh !== null && expectedSoFarKwh >= 0.1) {
    const ratio = (producedKwh ?? 0) / expectedSoFarKwh
    onTrack = ratio >= 1.1 ? "ahead" : ratio <= 0.9 ? "behind" : "on-track"
  }

  const progressPct =
    daily !== null && daily.estimated_kwh > 0
      ? Math.min(
          Math.round(((producedKwh ?? 0) / daily.estimated_kwh) * 100),
          100
        )
      : 0

  if (status === "loading") {
    return (
      <div
        className="min-h-48 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }

  // No forecast data: produced so far and the live output stay honest;
  // no target, progress or verdict is fabricated.
  if (daily === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="size-5" aria-hidden="true" />
            Solar forecast
          </CardTitle>
          <CardDescription>Expected production today</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">No forecast data</p>
          <p className="font-heading text-3xl font-medium tabular-nums">
            {formatKwh(producedKwh)}
          </p>
          <p className="text-xs text-muted-foreground">
            produced so far today
          </p>
          <LiveWatts watts={summary?.flow.pv_w ?? null} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sun className="size-5" aria-hidden="true" />
          Solar forecast
        </CardTitle>
        <CardDescription>Expected PV production for today</CardDescription>
        <CardAction>
          <Badge variant="outline" className="tabular-nums">
            Solar score {daily.solar_score}/100
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-heading text-3xl font-medium tabular-nums">
          {daily.estimated_kwh.toFixed(1)} kWh
        </p>
        {/* Actual production so far toward the full-day expectation;
            the same amber as the full forecast widget's day bar. */}
        <div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-[#f59e0b]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatKwh(producedKwh)} so far ({progressPct}% of expected)
            </span>
            <OnTrackBadge onTrack={onTrack} />
          </div>
        </div>
        <LiveWatts watts={summary?.flow.pv_w ?? null} />
      </CardContent>
    </Card>
  )
}

export default SolarForecastWidget
