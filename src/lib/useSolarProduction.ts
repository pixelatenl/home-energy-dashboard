import { useCallback, useEffect, useRef, useState } from "react"
import {
  fetchSolarProduction,
  fetchWeatherDaily,
  fetchWeatherHourly,
  type SolarProductionData,
  type WeatherHour,
} from "@/lib/api"
import type { PeriodKind } from "@/lib/period"
import type { DaylightWindow } from "@/lib/solarChart"
import { seasonalSunTimes } from "@/lib/timeOfDay"
import { useDataRefreshListener } from "@/lib/useDataRefresh"

export interface SolarProductionAnchor {
  period: PeriodKind
  date: string
}

// Fetches the solar production series for the anchored period and
// joins the refresh cycles, in the usage breakdown's idiom: the
// previous data stays on screen while a new period loads, a
// response that resolves after a period switch is discarded, and
// the header refresh button re-fetches immediately.
export function useSolarProduction(anchor: SolarProductionAnchor): {
  data: SolarProductionData | null
  status: "loading" | "ok" | "error"
} {
  const [data, setData] = useState<SolarProductionData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const value = await fetchSolarProduction(anchor.period, anchor.date)
      if (id === requestId.current) {
        setData(value)
        setStatus("ok")
      }
    } catch {
      if (id === requestId.current) {
        setStatus("error")
      }
    }
  }, [anchor])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => {
    const id = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(id)
  }, [load])

  useDataRefreshListener(load)

  return { data, status }
}

// The hourly weather forecast for today, as the day view's dashed
// forecast overlay. Fetches only when enabled - the current day in
// day view - so stepping to a previous day fires no weather request
// at all. The hours' estimated PV (Wh) become kWh curve points.
export function useTodayPvForecast(enabled: boolean): WeatherHour[] | null {
  const [hours, setHours] = useState<WeatherHour[] | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const result = await fetchWeatherHourly()
      if (id === requestId.current) {
        setHours(result.hours)
      }
    } catch {
      if (id === requestId.current) {
        setHours(null)
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      return
    }
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [enabled, load])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const id = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(id)
  }, [enabled, load])

  return enabled ? hours : null
}

// The day view's daylight window - sunrise to sunset, both hours
// inclusive - read from the weather daily forecast's row for that
// date, with the seasonal Netherlands defaults (the sky phase
// logic's fallback) approximating dates the forecast does not
// cover, so past days keep the daylight scale too. A failed fetch
// keeps the full 24-hour axis via a null window until it retries.
// Fetches only when enabled: a day period.

// The sunrise/sunset hour from either the forecast's local ISO
// string ("2026-10-17T07:45...") or the seasonal "HH:MM" form.
function sunHourOf(value: string): number {
  return Number(value.includes("T") ? value.slice(11, 13) : value.slice(0, 2))
}

export function useDaylightWindow(
  enabled: boolean,
  dateKey: string
): DaylightWindow | null {
  const [dayWindow, setDayWindow] = useState<DaylightWindow | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const days = await fetchWeatherDaily(5)
      if (id !== requestId.current) {
        return
      }
      const day = days.find((entry) => entry.date === dateKey)
      const sun =
        day?.sunrise && day?.sunset
          ? { sunrise: day.sunrise, sunset: day.sunset }
          : seasonalSunTimes(dateKey)
      const startHour = sunHourOf(sun.sunrise)
      const endHour = sunHourOf(sun.sunset)
      // Both edge hours inclusive; an invalid range reads as no
      // window rather than an empty axis.
      setDayWindow(
        Number.isInteger(startHour) &&
          Number.isInteger(endHour) &&
          startHour >= 0 &&
          endHour <= 23 &&
          endHour > startHour
          ? { startHour, endHour }
          : null
      )
    } catch {
      if (id === requestId.current) {
        setDayWindow(null)
      }
    }
  }, [dateKey])

  useEffect(() => {
    if (!enabled) {
      return
    }
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [enabled, load])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const id = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(id)
  }, [enabled, load])

  useDataRefreshListener(() => void load())

  return enabled ? dayWindow : null
}
