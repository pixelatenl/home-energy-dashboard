import { useCallback, useEffect, useState } from "react"
import { fetchSummary, type SummaryData } from "@/lib/api"

// Fetches the summary and joins the 5-minute refresh cycle (the server
// caches the summary for 5 minutes, so this matches its cadence). State is
// only updated after the await, so this is safe to call from effects.
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

  return { summary, status }
}
