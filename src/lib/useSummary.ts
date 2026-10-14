import { useCallback, useEffect, useRef, useState } from "react"
import { fetchSummary, type SummaryData } from "@/lib/api"
import {
  useDataRefreshListener,
  useRefetchOnWake,
} from "@/lib/useDataRefresh"

// The normal cadence: the server caches the summary for 5 minutes, so
// the poll matches it. The reasoning catch-up: while the latest payload
// reports a regenerating insight (state "reasoning"), poll every 30
// seconds - at most 5 consecutive quick polls - so a fresh insight
// lands within roughly a minute instead of waiting for the next
// 5-minute tick.
const POLL_INTERVAL_MS = 5 * 60_000
const REASONING_POLL_MS = 30_000
const MAX_REASONING_POLLS = 5

// Fetches the summary and drives the polling cadence from the latest
// payload: the 5-minute cycle (also immediately when the window
// regains focus or the network comes back online, so a kiosk tab
// catches up after throttled timers or a dropped connection), and the
// 30-second quick-poll chain while the insight regenerates. The two
// cadences never run in parallel; when a quick poll resolves the
// reasoning state, the 5-minute interval restarts from zero. State is
// only updated after the await, so this is safe to call from effects.
export function useSummary(): {
  summary: SummaryData | null
  status: "loading" | "ok" | "error"
} {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const quickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quickCountRef = useRef(0)

  const load = useCallback(async () => {
    try {
      const data = await fetchSummary()
      setSummary(data)
      setStatus("ok")
    } catch {
      setStatus("error")
    }
  }, [])

  const startInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
    }
    intervalRef.current = setInterval(() => void load(), POLL_INTERVAL_MS)
  }, [load])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    startInterval()
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (quickTimerRef.current !== null) {
        clearTimeout(quickTimerRef.current)
        quickTimerRef.current = null
      }
    }
  }, [load, startInterval])

  // While the latest payload reports a regenerating insight, suspend
  // the 5-minute interval and quick-poll every 30 seconds. When the
  // state resolves - fresh, error, or the quick-poll budget spent
  // while the regeneration still runs - the 5-minute cycle resumes
  // from zero.
  useEffect(() => {
    if (summary?.insight?.state !== "reasoning") {
      quickCountRef.current = 0
      if (quickTimerRef.current !== null) {
        clearTimeout(quickTimerRef.current)
        quickTimerRef.current = null
      }
      if (intervalRef.current === null) {
        startInterval()
      }
      return
    }
    if (quickTimerRef.current !== null) {
      return
    }
    if (quickCountRef.current >= MAX_REASONING_POLLS) {
      if (intervalRef.current === null) {
        startInterval()
      }
      return
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    quickTimerRef.current = setTimeout(() => {
      quickTimerRef.current = null
      quickCountRef.current += 1
      void load()
    }, REASONING_POLL_MS)
  }, [summary, load, startInterval])

  // Re-fetch immediately when the header refresh button fires.
  useDataRefreshListener(load)

  // Re-fetch immediately when the kiosk tab wakes or reconnects.
  useRefetchOnWake(load)

  return { summary, status }
}
