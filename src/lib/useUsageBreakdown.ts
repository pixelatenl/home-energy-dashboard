import { useCallback, useEffect, useRef, useState } from "react"
import {
  fetchUsageBreakdown,
  type UsageBreakdown,
} from "@/lib/api"
import type { PeriodKind } from "@/lib/period"
import { useDataRefreshListener } from "@/lib/useDataRefresh"

export interface UsageBreakdownAnchor {
  period: PeriodKind
  date: string
}

// Fetches the usage category breakdown for the anchored period and
// joins the refresh cycles. The previous data stays on screen while a
// new period loads (stale-while-revalidate), so switching periods
// animates the treemap from one period into the next instead of
// blanking it; only the very first load shows the skeleton. A
// response that resolves after a period switch is discarded, so a
// slow day response can never overwrite the week.
export function useUsageBreakdown(
  anchor: UsageBreakdownAnchor
): {
  data: UsageBreakdown | null
  status: "loading" | "ok" | "error"
} {
  const [data, setData] = useState<UsageBreakdown | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const value = await fetchUsageBreakdown(anchor.period, anchor.date)
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

  // Re-fetch immediately when the header refresh button fires.
  useDataRefreshListener(load)

  return { data, status }
}
