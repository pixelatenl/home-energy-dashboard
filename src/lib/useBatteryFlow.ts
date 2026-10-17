import { useCallback, useEffect, useRef, useState } from "react"
import {
  fetchBatteryFlow,
  type BatteryFlowData,
} from "@/lib/api"
import type { PeriodKind } from "@/lib/period"
import { useDataRefreshListener } from "@/lib/useDataRefresh"

export interface BatteryFlowAnchor {
  period: PeriodKind
  date: string
}

// Fetches the period-anchored battery flow and joins the refresh
// cycles, in the solar production hook's idiom: the previous data
// stays on screen while a new period loads, a response that resolves
// after a period switch is discarded, and the header refresh button
// re-fetches immediately.
export function useBatteryFlow(anchor: BatteryFlowAnchor): {
  data: BatteryFlowData | null
  status: "loading" | "ok" | "error"
} {
  const [data, setData] = useState<BatteryFlowData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const value = await fetchBatteryFlow(anchor.period, anchor.date)
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
