import { useCallback, useEffect, useState } from "react"
import { fetchSummary, type SummaryData } from "@/lib/api"
import {
  useDataRefreshListener,
  useRefetchOnWake,
} from "@/lib/useDataRefresh"

// Fetches the summary and joins the 5-minute refresh cycle (the server
// caches the summary for 5 minutes, so this matches its cadence). The
// refetch runs for the lifetime of the tab - also immediately when the
// window regains focus or the network comes back online, so a kiosk
// tab catches up after throttled timers or a dropped connection. State
// is only updated after the await, so this is safe to call from effects.
export function useSummary(): {
  summary: SummaryData | null
  status: "loading" | "ok" | "error"
} {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")

  const load = useCallback(async () => {
    try {
      const data = await fetchSummary()
      setSummary(data)
      setStatus("ok")
    } catch {
      setStatus("error")
    }
  }, [])

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

  // Re-fetch immediately when the kiosk tab wakes or reconnects.
  useRefetchOnWake(load)

  return { summary, status }
}
