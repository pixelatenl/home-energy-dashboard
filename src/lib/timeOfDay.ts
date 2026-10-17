import { useEffect, useState } from "react"
import { fetchWeatherDaily } from "@/lib/api"
import { todayInAmsterdam } from "@/lib/time"

// Time-of-day phase logic for the live energy flow widget's sky
// background (see src/components/TimeOfDayBackground.tsx). Two phases
// only: day runs from the actual sunrise to the actual sunset (from the
// weather API, seasonal defaults until it loads or when it fails),
// night is everything else. The phase is recomputed every minute.

export type TimeOfDayPhase = "day" | "night"

// Fixed seasonal sunrise/sunset defaults for the Netherlands.
const SEASONAL_DEFAULTS: { sunrise: string; sunset: string }[] = [
  { sunrise: "08:45", sunset: "16:50" }, // January
  { sunrise: "08:05", sunset: "17:45" },
  { sunrise: "07:05", sunset: "18:40" },
  { sunrise: "06:45", sunset: "20:25" },
  { sunrise: "05:50", sunset: "21:15" },
  { sunrise: "05:20", sunset: "22:00" },
  { sunrise: "05:35", sunset: "21:55" },
  { sunrise: "06:25", sunset: "20:50" },
  { sunrise: "07:15", sunset: "19:45" },
  { sunrise: "08:05", sunset: "18:40" },
  { sunrise: "07:55", sunset: "16:45" },
  { sunrise: "08:50", sunset: "16:35" }, // December
]

// The month's default sunrise/sunset ("HH:MM") for a date key - the
// same Netherlands approximation the sky phase logic falls back on.
// Exported so the solar day chart's daylight window can approximate
// dates outside the daily forecast's range (past days).
export function seasonalSunTimes(dateKey: string): {
  sunrise: string
  sunset: string
} {
  const month = Number(dateKey.slice(5, 7)) - 1
  return SEASONAL_DEFAULTS[Math.min(Math.max(month, 0), 11)]
}

export function phaseFor(
  nowMs: number,
  sunriseMs: number,
  sunsetMs: number
): TimeOfDayPhase {
  return nowMs >= sunriseMs && nowMs < sunsetMs ? "day" : "night"
}

// Representative sun-arc position when a phase is forced via the hash.
const FORCED_SUN_PROGRESS: Record<TimeOfDayPhase, number | null> = {
  day: 0.5,
  night: null,
}

// Testing affordance in the app's hash idiom: "#flow-phase=day" (or
// "night") forces that sky so both can be inspected without waiting
// for the clock.
function forcedPhase(): TimeOfDayPhase | null {
  const match = window.location.hash.match(/flow-phase=(day|night)/)
  return match ? (match[1] as TimeOfDayPhase) : null
}

// The current phase, recomputed every minute, plus the sun's progress
// across the day arc (null at night). Sunrise and sunset come from the
// weather API's daily forecast, guarded against a stale day row;
// seasonal defaults apply until it loads or when it fails.
export function useTimeOfDayPhase(): {
  phase: TimeOfDayPhase
  sunProgress: number | null
  onDark: boolean
} {
  const [sunTimes, setSunTimes] = useState<{
    sunriseMs: number
    sunsetMs: number
  } | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const days = await fetchWeatherDaily(1)
        const today = days[0]
        if (
          !cancelled &&
          today?.date === todayInAmsterdam() &&
          today.sunrise &&
          today.sunset
        ) {
          setSunTimes({
            sunriseMs: Date.parse(today.sunrise),
            sunsetMs: Date.parse(today.sunset),
          })
        }
      } catch {
        // Seasonal defaults stay in force.
      }
    }
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    const weatherId = setInterval(() => void load(), 30 * 60_000)
    return () => {
      cancelled = true
      clearInterval(weatherId)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const now = new Date(nowMs)
  const defaults = SEASONAL_DEFAULTS[now.getMonth()]
  const localMs = (hhmm: string) =>
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(hhmm.slice(0, 2)),
      Number(hhmm.slice(3))
    ).getTime()
  const sunriseMs = sunTimes?.sunriseMs ?? localMs(defaults.sunrise)
  const sunsetMs = sunTimes?.sunsetMs ?? localMs(defaults.sunset)

  const forced = forcedPhase()
  const phase = forced ?? phaseFor(nowMs, sunriseMs, sunsetMs)
  const sunProgress =
    forced !== null
      ? FORCED_SUN_PROGRESS[forced]
      : Math.min(
          Math.max((nowMs - sunriseMs) / (sunsetMs - sunriseMs), 0),
          1
        )
  return { phase, sunProgress, onDark: phase === "night" }
}
