import { useCallback, useEffect, useRef, useState } from "react"
import {
  fetchAppliances,
  type ApplianceAnchor,
  type ApplianceRange,
  type ApplianceSummary,
} from "@/lib/api"
import { useDataRefreshListener } from "@/lib/useDataRefresh"

// Fetches the appliance disaggregation for a range, optionally anchored
// to a concrete period window, and joins the 5-minute refresh cycle. A
// response that resolves after a range switch is discarded, so a slow
// 'today' response can never overwrite 'week'.
export function useAppliances(
  range: ApplianceRange,
  anchor?: ApplianceAnchor
): {
  data: ApplianceSummary | null
  status: "loading" | "ok" | "error"
} {
  const [data, setData] = useState<ApplianceSummary | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const value = await fetchAppliances(range, anchor)
      if (id === requestId.current) {
        setData(value)
        setStatus("ok")
      }
    } catch {
      if (id === requestId.current) {
        setStatus("error")
      }
    }
  }, [range, anchor])

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
