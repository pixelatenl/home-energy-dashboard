import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import {
  fetchWeatherHourly,
  type BatteryFlowHour,
  type PvFlowHour,
  type WeatherHour,
} from "@/lib/api"
import { DISCHARGING_COLOR, SOLAR_COLOR } from "@/lib/flowDiagram"
import { useSummary } from "@/lib/useSummary"
import { useDataRefreshListener } from "@/lib/useDataRefresh"
import { amsterdamNow, todayInAmsterdam, localHourFractionOf } from "@/lib/time"

// The compact "today" charts, split out of the live energy flow hero
// into their own widget pair: actual hourly solar production against
// the forecast curve, and hourly battery charge versus discharge.
// Each leads with its day total so the curves read with their value,
// and both ride the same full-day time axis with a shared now
// marker. No axes or gridlines; the animated flow lines in the hero
// above carry the emotional weight, these carry the numbers. The
// charts' white lines and markers read on the frosted dark-glass
// cards like they read on the sky they used to sit on.

// Shared chart geometry: a wide, short viewBox stretched to the card
// width; strokes use non-scaling so the stretch does not distort them.
const TODAY_CHART_W = 240
const TODAY_CHART_H = 48

// Palette: the flow's solar yellow for actual production; the battery
// panel's green/amber pair for charge and discharge.
const CHARGING_COLOR = "hsl(140 70% 45%)"

// The now marker's x position for the full-day 0-24h axis.
function nowXOf(nowFraction: number): number {
  return (Math.min(Math.max(nowFraction, 0), 24) / 24) * TODAY_CHART_W
}

// The now marker's x position updates once a minute so the charts
// follow the clock; amsterdamNow resolves the local fraction of day.
function useNowFraction(): number {
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return amsterdamNow(nowTick).fraction
}

// The solar chart's legend: the produced line's yellow against the
// dashed forecast curve's white, with matching swatch shapes.
function TodaySolarLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
  )
}

// The battery chart's legend: the bar pair's green and amber.
function TodayBatteryLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
  )
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
}: {
  actual: PvFlowHour[]
  forecast: WeatherHour[] | null
  nowFraction: number
  producedKwh: number | null
}) {
  // kWh per local hour, both series on the same scale.
  const actualByHour = new Array<number>(24).fill(0)
  for (const hour of actual) {
    actualByHour[localHourFractionOf(hour.ts) | 0] += hour.kwh
  }
  const forecastByHour = new Array<number>(24).fill(0)
  for (const hour of forecast ?? []) {
    forecastByHour[Number(hour.hour.slice(11, 13))] = hour.estimated_pv_wh / 1000
  }
  const maxKwh = Math.max(
    ...actualByHour,
    ...forecastByHour,
    0.1
  )
  const y = (kwh: number) => TODAY_CHART_H - (kwh / maxKwh) * (TODAY_CHART_H - 4) - 2
  // Stepped area under the actual production line, closed at the base.
  const stepPoints: string[] = []
  for (let hour = 0; hour < 24; hour += 1) {
    const left = (hour / 24) * TODAY_CHART_W
    const right = ((hour + 1) / 24) * TODAY_CHART_W
    const top = y(actualByHour[hour])
    stepPoints.push(`${left},${top} ${right},${top}`)
  }
  const areaPoints = `0,${TODAY_CHART_H} ${stepPoints.join(" ")} ${TODAY_CHART_W},${TODAY_CHART_H}`
  // Forecast curve through the hour midpoints, dashed.
  const forecastPoints = forecastByHour
    .map((kwh, hour) => `${((hour + 0.5) / 24) * TODAY_CHART_W},${y(kwh)}`)
    .join(" ")
  const hasForecast = forecast !== null && forecast.length > 0
  const hasActual = actual.some((hour) => hour.kwh > 0)

  return (
    <Card>
      <CardContent>
        <p className="text-xs font-medium text-muted-foreground">Solar today</p>
        <p className="mt-1 text-sm font-semibold tabular-nums">
          {producedKwh === null ? "\u2014" : `${producedKwh.toFixed(1)} kWh`}{" "}
          produced
        </p>
        {!hasActual && !hasForecast ? (
          <p className="mt-2 text-xs text-muted-foreground">No data yet</p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${TODAY_CHART_W} ${TODAY_CHART_H}`}
              preserveAspectRatio="none"
              className="mt-1 h-20 w-full"
              role="img"
              aria-label="Hourly solar production today against the forecast"
            >
              <polygon points={areaPoints} fill={SOLAR_COLOR} opacity={0.25} />
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
  )
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
}: {
  flow: BatteryFlowHour[]
  nowFraction: number
  chargedKwh: number | null
  dischargedKwh: number | null
}) {
  const zeroY = TODAY_CHART_H / 2
  const slot = TODAY_CHART_W / 24
  const byHour = new Map<number, { in: number; out: number }>()
  for (const hour of flow) {
    const key = localHourFractionOf(hour.ts) | 0
    const entry = byHour.get(key) ?? { in: 0, out: 0 }
    entry.in += hour.in_kwh
    entry.out += hour.out_kwh
    byHour.set(key, entry)
  }
  const maxKwh = Math.max(
    ...[...byHour.values()].map((entry) => Math.max(entry.in, entry.out)),
    0.1
  )
  const scale = (TODAY_CHART_H / 2 - 2) / maxKwh
  const hasFlow = byHour.size > 0

  return (
    <Card>
      <CardContent>
        <p className="text-xs font-medium text-muted-foreground">Battery today</p>
        <p className="mt-1 text-sm font-semibold tabular-nums">
          {chargedKwh === null ? "\u2014" : `${chargedKwh.toFixed(1)} kWh`}{" "}
          charged &middot;{" "}
          {dischargedKwh === null
            ? "\u2014"
            : `${dischargedKwh.toFixed(1)} kWh`}{" "}
          discharged
        </p>
        {!hasFlow ? (
          <p className="mt-2 text-xs text-muted-foreground">No data yet</p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${TODAY_CHART_W} ${TODAY_CHART_H}`}
              preserveAspectRatio="none"
              className="mt-1 h-20 w-full"
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
  )
}

// The "today" charts widget: solar and battery side by side (stacked
// on narrow widths), one compact card each, riding the shared summary
// cycle and the weather forecast for the solar curve.
function TodayCharts() {
  const { summary } = useSummary()
  const nowFraction = useNowFraction()

  // The solar forecast curve for the compact solar chart: the hourly
  // weather endpoint's estimated PV per hour; null keeps the chart on
  // the actual production only. State is only updated after the
  // await, so this is safe to call from effects.
  const [forecastHours, setForecastHours] = useState<WeatherHour[] | null>(
    null
  )
  const loadForecast = useCallback(async () => {
    try {
      const result = await fetchWeatherHourly(todayInAmsterdam())
      setForecastHours(result.hours)
    } catch {
      setForecastHours(null)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void loadForecast()
  }, [loadForecast])

  // Re-fetch when the header refresh button fires.
  useDataRefreshListener(() => void loadForecast())

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TodaySolarChart
        actual={summary?.pv_flow_hourly ?? []}
        forecast={forecastHours}
        nowFraction={nowFraction}
        producedKwh={summary?.today.pv_kwh ?? null}
      />
      <TodayBatteryChart
        flow={summary?.battery_flow_hourly ?? []}
        nowFraction={nowFraction}
        chargedKwh={summary?.today.battery_charged_kwh ?? null}
        dischargedKwh={summary?.today.battery_discharged_kwh ?? null}
      />
    </div>
  )
}

export default TodayCharts
