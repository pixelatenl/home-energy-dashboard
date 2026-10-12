import { useCallback, useEffect, useRef, useState } from "react"
import { fetchHeatGas, type GasUsageData } from "@/lib/api"
import type { PeriodKind } from "@/lib/period"
import { useDataRefreshListener } from "@/lib/useDataRefresh"

// Fetches the gas usage and cost for a period anchor and joins the
// 5-minute refresh cycle. A response that resolves after a period
// switch is discarded, so a slow day response can never overwrite a
// week.
export function useHeatGas(period: PeriodKind, date: string): {
  data: GasUsageData | null
  status: "loading" | "ok" | "error"
} {
  const [data, setData] = useState<GasUsageData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const value = await fetchHeatGas(period, date)
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
