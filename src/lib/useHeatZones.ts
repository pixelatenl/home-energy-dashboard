import { useCallback, useEffect, useRef, useState } from "react"
import { fetchHeatZones, type HeatZonesData } from "@/lib/api"
import type { PeriodKind } from "@/lib/period"
import { useDataRefreshListener } from "@/lib/useDataRefresh"

// Fetches the heat zone timeline for a period anchor and joins the
// 5-minute refresh cycle. A response that resolves after a period
// switch is discarded, so a slow day response can never overwrite a
// week.
export function useHeatZones(period: PeriodKind, date: string): {
  data: HeatZonesData | null
  status: "loading" | "ok" | "error"
} {
  const [data, setData] = useState<HeatZonesData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const value = await fetchHeatZones(period, date)
      if (id === requestId.current) {
        setData(value)
        setStatus("ok")
      }
    } catch {
      if (id === requestId.current) {
        setStatus("error")
      }
    }
  }, [period, date])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => {
    const id = setInterval(() => void load(), 5 * 60_000)
    return () => clearInterval(id)
  }, [load])

  // Re-fetch immediately when the header refresh button fires.
  useDataRefreshListener(load)

  return { data, status }
}
