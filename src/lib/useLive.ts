import { useCallback, useEffect, useRef, useState } from "react"
import { fetchLiveSnapshot, type LiveSnapshot } from "@/lib/api"
import { useRefetchOnWake } from "@/lib/useDataRefresh"

// The live poll cadence, the one shared constant behind every
// /api/live consumer (the stats hub's Live power card now, the flow
// page next): 20 seconds while the tab is visible, paused while it is
// hidden, with an immediate catch-up on focus and on the network
// coming back online. The card's 4-second alternation is presentation
// only - the data cadence stays this poll, and nothing is ever
// interpolated between polls.
export const LIVE_POLL_INTERVAL_MS = 20_000

// A reading whose honest age passes this threshold renders with a
// subtle stale marker: the figure stays (it was measured), its age is
// shown, and nothing fresher is invented.
export const LIVE_STALE_AFTER_MS = 60_000

export interface LiveData {
  snapshot: LiveSnapshot | null
  status: "loading" | "ok" | "error"
}

// The honest age of a live field: the reading age the server reported,
// plus the time the snapshot has been sitting in the browser. Null
// when the field carries no value to age. Accepts any field shape with
// an ageSeconds (value fields and state fields alike). Pure apart from
// the default clock, so staleness is testable.
export function liveFieldAgeMs(
  snapshot: LiveSnapshot,
  field: { ageSeconds: number | null },
  nowMs: number = Date.now()
): number | null {
  if (field.ageSeconds === null) {
    return null
  }
  const arrivedAt = Date.parse(snapshot.fetchedAt)
  return field.ageSeconds * 1000 + Math.max(0, nowMs - arrivedAt)
}

// The live power snapshot from /api/live, or the last snapshot on a
// failed poll: fail-soft keeps the previous data and reports status
// "error" so the card can mark it stale - no value is ever invented
// or zero-filled. Polled at the shared live cadence, throttled while
// the tab is hidden with an immediate catch-up on return, focus and
// reconnect.
export function useLive(): LiveData {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const inFlightRef = useRef(false)

  const load = useCallback(async () => {
    // Throttled while the tab is hidden: the interval keeps ticking
    // but the poll pauses; the focus catch-up reloads on return.
    if (document.hidden || inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    try {
      const data = await fetchLiveSnapshot()
      setSnapshot(data)
      setStatus("ok")
    } catch {
      // Fail-soft: keep the last snapshot, mark the data stale by
      // status; never substitute an invented value.
      setStatus("error")
    } finally {
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    const id = setInterval(() => void load(), LIVE_POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (!document.hidden) {
        void load()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [load])

  // Immediate catch-up when the window regains focus or the network
  // comes back online - the kiosk moments that must not wait for the
  // next tick.
  useRefetchOnWake(load)

  return { snapshot, status }
}
