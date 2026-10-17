import { useCallback, useEffect, useRef, useState } from "react"
import {
  fetchSolarProduction,
  fetchWeatherHourly,
  type SolarProductionData,
  type WeatherHour,
} from "@/lib/api"
import type { PeriodKind } from "@/lib/period"
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
