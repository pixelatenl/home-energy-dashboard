import { useEffect, useState } from "react"
import { getCurrentMeasurements } from "@/lib/api"

// The P1 meter's gross grid import power sensor: the same source the
// hub's "From grid" figure derives from (the summary's flow
// snapshot), read through the lightweight /api/current endpoint.
export const GRID_IMPORT_SENSOR =
  "sensor.connect_energiemeter_electricity_consumption"

// The live poll cadence: 20 seconds while the tab is visible,
// throttled while it is hidden, with an immediate catch-up on
// return.
const POLL_INTERVAL_MS = 20_000

// The server's flow snapshot treats a power reading older than an
// hour as stale; the live figures mirror that rule so they always
// match the hub's figure at the same moment, and round the same way.
const FRESH_WINDOW_MS = 60 * 60 * 1000

// The live gross grid draw, or null before the first data, after a
// failed poll, or when the latest reading is stale: no number is
// ever fabricated or zero-filled. Polled at a live cadence,
// throttled while the tab is hidden with an immediate catch-up on
// visibility return; shared by the stats hub's Live power card.
export function useLiveGridWatts(): number | null {
  const [drawW, setDrawW] = useState<number | null>(null)

  useEffect(() => {
    let inFlight = false
    const load = async () => {
      if (document.hidden || inFlight) {
        return
      }
      inFlight = true
      try {
        const rows = await getCurrentMeasurements()
        const row = rows.find(
          (entry) => entry.ha_entity_id === GRID_IMPORT_SENSOR
        )
        if (
          row === undefined ||
          row.value === null ||
          Date.now() - Date.parse(row.ts) > FRESH_WINDOW_MS
        ) {
          setDrawW(null)
        } else {
          setDrawW(Math.round(row.value))
        }
      } catch {
        // Fail-soft: the absence of a number, never a fabricated one.
        setDrawW(null)
      } finally {
        inFlight = false
      }
    }
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    const id = setInterval(() => void load(), POLL_INTERVAL_MS)
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
  }, [])

  return drawW
}
