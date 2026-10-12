import { useEffect } from "react"

// Window event through which the header refresh button re-fetches every
// dashboard widget's data; each data hook or widget instance reloads on it.
export const DATA_REFRESH_EVENT = "dashboard-data-refresh"

export function triggerDataRefresh() {
  window.dispatchEvent(new Event(DATA_REFRESH_EVENT))
}

// Runs load whenever the global dashboard refresh event fires. The event
// object never reaches load, so hooks with optional arguments (like force)
// keep their defaults.
export function useDataRefreshListener(load: () => void) {
  useEffect(() => {
    const onRefresh = () => load()
    window.addEventListener(DATA_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(DATA_REFRESH_EVENT, onRefresh)
  }, [load])
}

// Refetches immediately when the window regains focus or the network
// connection comes back online: the two moments a long-lived kiosk tab
// must catch up after the browser throttled its timers or the
// connection dropped.
export function useRefetchOnWake(load: () => void) {
  useEffect(() => {
    const onWake = () => load()
    window.addEventListener("focus", onWake)
    window.addEventListener("online", onWake)
    return () => {
      window.removeEventListener("focus", onWake)
      window.removeEventListener("online", onWake)
    }
  }, [load])
}
