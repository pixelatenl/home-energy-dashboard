import { useCallback, useEffect, useState, type ComponentType, type MouseEvent } from "react"
import AIContextBox from "@/components/AIContextBox"
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
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  fetchWeatherContext,
  fetchWeatherDaily,
  fetchWeatherHourly,
  type WeatherCurrent,
  type WeatherDay,
  type WeatherHour,
} from "@/lib/api"
import { useAiContext } from "@/lib/useAiContext"
import { amsterdamNow, todayInAmsterdam } from "@/lib/time"

type IconComponent = ComponentType<{ className?: string }>

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
}

function solarScoreColor(score: number): string {
  if (score >= 70) return "#eab308" // mostly sunny
  if (score >= 40) return "#f97316" // mixed
  return "#64748b" // overcast
}

function ScoreRing({ score }: { score: number }) {
  const color = solarScoreColor(score)
  return (
    <div
      className="flex size-14 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${color} ${score}%, rgba(100,116,139,0.25) ${score}%)`,
      }}
      title={`Solar score ${score}/100`}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-card text-base font-semibold tabular-nums">
        {score}
      </div>
    </div>
  )
}

function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
  })
}

// Color swatches matching the chart elements in HourlyChart.
function ChartLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
        <span className="size-3 rounded-sm bg-[#94a3b8]/30" />
        Cloud cover
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-[#f59e0b]/80" />
        PV estimate (Wh)
      </span>
    </div>
  )
}

// Floating tooltip shown while hovering an hour slot of the chart.
function ChartTooltip({ hour, leftPercent }: { hour: WeatherHour; leftPercent: number }) {
  const Icon = WEATHER_ICONS[hour.weather_code] ?? Cloud
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
        Cloud {hour.cloud_cover}% &middot; Rain{" "}
        {hour.precipitation_probability}%
      </div>
      <div className="text-muted-foreground tabular-nums">
        PV {hour.estimated_pv_wh} Wh
      </div>
    </div>
  )
}

// Hourly strip: temperature curve over cloud-cover shading, with a PV
// estimate bar per hour. Hovering a slot shows a tooltip with its values.
function HourlyChart({ hours }: { hours: WeatherHour[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  // Ticks once a minute so the "Now" marker stays in place.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const width = 960
  const height = 150
  // Empty band at the top of the chart so the "Now" label has breathing
  // room above the data.
  const topBand = 18
  const slot = width / hours.length
  const temperatures = hours.map((hour) => hour.temperature)
  const minTemp = Math.min(...temperatures)
  const tempSpan = Math.max(Math.max(...temperatures) - minTemp, 1)
  const maxPv = Math.max(...hours.map((hour) => hour.estimated_pv_wh), 1)
  const x = (index: number) => (index + 0.5) * slot
  const yTemp = (temperature: number) =>
    topBand + 8 + (1 - (temperature - minTemp) / tempSpan) * 66
  const pvBase = height - 10
  const pvMaxHeight = 42
  const points = hours
    .map((hour, index) => `${x(index)},${yTemp(hour.temperature)}`)
    .join(" ")
  // Temperature scale ticks: data min, mid and max, positioned to match
  // the curve band.
  const ticks = [minTemp + tempSpan, minTemp + tempSpan / 2, minTemp]
  // "Now" marker: drawn only when the charted day is the current
  // Europe/Amsterdam day and the local time is inside the shown window.
  const now = amsterdamNow(nowTick)
  const chartDate = hours[0]?.hour.slice(0, 10)
  const firstHour = hours.length > 0 ? Number(hours[0].hour.slice(11, 13)) : 0
  const lastHour =
    hours.length > 0
      ? Number(hours[hours.length - 1].hour.slice(11, 13))
      : 0
  const showNow =
    chartDate === now.date &&
    now.fraction >= firstHour &&
    now.fraction <= lastHour + 1
  const nowX =
    ((now.fraction - firstHour) / Math.max(hours.length, 1)) * width

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const index = Math.floor(
      ((event.clientX - rect.left) / rect.width) * hours.length
    )
    setHoveredIndex(
      index >= 0 && index < hours.length ? index : null
    )
  }

  // Horizontal anchor for the tooltip, clamped so it stays inside the chart.
  const tooltipLeftPercent = hoveredIndex === null
    ? 0
    : Math.min(
        Math.max(((hoveredIndex + 0.5) / hours.length) * 100, 10),
        90
      )

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative h-36 w-8 shrink-0">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute right-0 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
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
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="h-36 w-full"
            role="img"
            aria-label="Hourly temperature, cloud cover and PV estimate"
          >
            {hours.map((hour, index) => {
              const pvHeight = (hour.estimated_pv_wh / maxPv) * pvMaxHeight
              return (
                <g key={hour.hour}>
                  <rect
                    x={index * slot}
                    y={topBand}
                    width={slot}
                    height={height - topBand}
                    fill="#94a3b8"
                    opacity={(hour.cloud_cover / 100) * 0.3}
                  />
                  <rect
                    x={x(index) - slot * 0.3}
                    y={pvBase - pvHeight}
                    width={slot * 0.6}
                    height={pvHeight}
                    rx={2}
                    fill="#f59e0b"
                    opacity={0.8}
                  />
                </g>
              )
            })}
            {ticks.map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={width}
                y1={yTemp(tick)}
                y2={yTemp(tick)}
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
              className="pointer-events-none absolute top-0 -translate-x-1/2 text-[10px] text-muted-foreground"
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
      </div>
      <div className="ml-10 mt-1 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span className="flex items-center gap-1">
          <Sunrise className="size-3" aria-hidden="true" />
          {hours[0]?.hour.slice(11, 13)}
        </span>
        {hours
          .filter(
            (_, index) =>
              index % 3 === 0 &&
              index !== 0 &&
              index !== hours.length - 1
          )
          .map((hour) => (
            <span key={hour.hour}>{hour.hour.slice(11, 13)}</span>
          ))}
        <span className="flex items-center gap-1">
          {hours[hours.length - 1]?.hour.slice(11, 13)}
          <Sunset className="size-3" aria-hidden="true" />
        </span>
      </div>
      <ChartLegend />
    </div>
  )
}

const STRIP_HEIGHT = "h-64"
const DAY_CARD_HEIGHT = "min-h-48"

function DayCard({
  day,
  selected,
  onSelect,
}: {
  day: WeatherDay
  selected: boolean
  onSelect: (date: string) => void
}) {
  const Icon = WEATHER_ICONS[day.weather_code] ?? Cloud
  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-pressed={selected}
      className={`flex w-full flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors hover:bg-muted/50 ${DAY_CARD_HEIGHT} ${
        selected ? "border-primary ring-2 ring-ring/50" : "border-border"
      }`}
    >
      <span className="text-sm font-medium">
        {day.date === todayInAmsterdam() ? "Today" : weekdayName(day.date)}
      </span>
      <Icon className="size-6" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {Math.round(day.temp_max)} / {Math.round(day.temp_min)} &deg;C
      </span>
      <ScoreRing score={day.solar_score} />
      <span className="text-xs text-muted-foreground tabular-nums">
        {day.estimated_kwh} kWh
      </span>
    </button>
  )
}

// Clips hourly rows to the daylight window (sunrise to sunset, inclusive of
// both edge hours) taken from the daily entry for that date. Falls back to
// the full day when sunrise/sunset are missing or the window matches no
// hours, rather than showing an empty chart.
function clipToDaylight(
  hours: WeatherHour[],
  day: WeatherDay | null
): WeatherHour[] {
  if (!day?.sunrise || !day?.sunset || hours.length === 0) {
    return hours
  }
  // Hour strings and sunrise/sunset are local-time ISO, so a prefix
  // comparison on "YYYY-MM-DDTHH" is a valid window test.
  const start = day.sunrise.slice(0, 13)
  const end = day.sunset.slice(0, 13)
  const clipped = hours.filter(
    (hour) =>
      hour.hour.slice(0, 13) >= start && hour.hour.slice(0, 13) <= end
  )
  return clipped.length > 0 ? clipped : hours
}

// The current hour's slot shows the "current" analysis values instead of
// the hourly forecast value for that hour; only applies to today's chart.
function withCurrentConditions(
  hours: WeatherHour[],
  current: WeatherCurrent | null,
  dateKey: string | null
): WeatherHour[] {
  if (!current || !dateKey || hours.length === 0) {
    return hours
  }
  if (dateKey !== todayInAmsterdam()) {
    return hours
  }
  const hour = Math.floor(amsterdamNow(Date.now()).fraction)
  return hours.map((row) =>
    Number(row.hour.slice(11, 13)) === hour
      ? {
          ...row,
          temperature: current.temperature ?? row.temperature,
          weather_code: current.weather_code ?? row.weather_code,
          cloud_cover: current.cloud_cover ?? row.cloud_cover,
        }
      : row
  )
}

function WeatherForecast() {
  const weatherContext = useAiContext(fetchWeatherContext)
  const [daily, setDaily] = useState<WeatherDay[] | null>(null)
  const [dailyStatus, setDailyStatus] = useState<"loading" | "ok" | "error">(
    "loading"
  )
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [hourly, setHourly] = useState<WeatherHour[] | null>(null)
  const [currentWeather, setCurrentWeather] = useState<WeatherCurrent | null>(
    null
  )
  const [hourlyStatus, setHourlyStatus] = useState<
    "idle" | "loading" | "error"
  >("idle")

  const loadHourly = useCallback(async (date: string) => {
    setHourly(null)
    setCurrentWeather(null)
    setHourlyStatus("loading")
    try {
      const result = await fetchWeatherHourly(date)
      setHourly(result.hours)
      setCurrentWeather(result.current)
      setHourlyStatus("idle")
    } catch {
      setHourlyStatus("error")
    }
  }, [])

  // Fetches the daily forecast and selects the first day. State is only
  // updated after the await, so this is safe to call from effects.
  const loadDaily = useCallback(
    async (refresh: boolean) => {
      if (refresh) {
        setDaily(null)
        setDailyStatus("loading")
      }
      try {
        const days = await fetchWeatherDaily(5)
        setDaily(days)
        setDailyStatus("ok")
        if (days.length > 0) {
          setSelectedDate(days[0].date)
          void loadHourly(days[0].date)
        }
      } catch {
        setDailyStatus("error")
      }
    },
    [loadHourly]
  )

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void loadDaily(false)
  }, [loadDaily])

  const selectDay = useCallback(
    (date: string) => {
      setSelectedDate(date)
      void loadHourly(date)
    },
    [loadHourly]
  )

  // The strip only has value during daylight: clip the fetched hours to the
  // sunrise-sunset window of the selected day.
  const visibleHours =
    hourly && selectedDate
      ? clipToDaylight(
          hourly,
          daily?.find((day) => day.date === selectedDate) ?? null
        )
      : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sun className="size-5" aria-hidden="true" />
              5 day solar forecast
            </CardTitle>
            <CardDescription>
              Solar score and estimated PV yield for the coming days
            </CardDescription>
          </div>
          {hourly && selectedDate && (
            <Badge variant="outline" className="tabular-nums">
              PV{" "}
              {(
                hourly.reduce(
                  (sum, hour) => sum + hour.estimated_pv_wh,
                  0
                ) / 1000
              ).toFixed(1)}{" "}
              kWh estimated
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {dailyStatus === "error" && (
          <div
            className={`flex items-center justify-between rounded-xl border border-destructive/30 px-4 ${DAY_CARD_HEIGHT}`}
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
        )}
        {dailyStatus === "loading" && (
          <div className={`animate-pulse rounded-xl bg-muted ${DAY_CARD_HEIGHT}`} />
        )}
        {daily && (
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
        )}

        {selectedDate && (
          <div className={`rounded-xl bg-muted/30 p-4 ${STRIP_HEIGHT}`}>
            {hourlyStatus === "loading" && (
              <div className="h-full w-full animate-pulse rounded-lg bg-muted" />
            )}
            {hourlyStatus === "error" && (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <p className="text-sm text-destructive">
                  Could not load the hourly forecast.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadHourly(selectedDate)}
                >
                  Retry
                </Button>
              </div>
            )}
            {visibleHours && visibleHours.length > 0 && (
              <div className="flex h-full flex-col gap-2">
                <div className="text-sm">
                  <span className="font-medium">
                    {selectedDate === todayInAmsterdam()
                      ? "Today"
                      : new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
                          "en-GB",
                          { weekday: "long", day: "numeric", month: "short" }
                        )}
                  </span>
                </div>
                <HourlyChart
                  hours={withCurrentConditions(
                    visibleHours,
                    currentWeather,
                    selectedDate
                  )}
                />
              </div>
            )}
          </div>
        )}

        <AIContextBox {...weatherContext} />
      </CardContent>
    </Card>
  )
}

export default WeatherForecast
