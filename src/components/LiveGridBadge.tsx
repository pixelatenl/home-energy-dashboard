import { useEffect, useState } from "react"
import { getCurrentMeasurements } from "@/lib/api"
import {
  formatGridWatts,
  gridPulsePeriodS,
  gridPulseStep,
} from "@/lib/gridPulse"

// The P1 meter's gross grid import power sensor: the same source the
// hub's "From grid" figure derives from (the summary's flow
// snapshot), read here through the lightweight /api/current endpoint
// so the top bar can poll it at its own live cadence.
const GRID_IMPORT_SENSOR = "sensor.connect_energiemeter_electricity_consumption"

// The badge's own poll cadence: 20 seconds while the tab is visible,
// throttled while it is hidden.
const POLL_INTERVAL_MS = 20_000

// The server's flow snapshot treats a power reading older than an
// hour as stale; the badge mirrors that rule so its number always
// matches the hub's figure at the same moment, and rounds the same
// way.
const FRESH_WINDOW_MS = 60 * 60 * 1000

// The live grid draw, or null before the first data, after a failed
// poll, or when the latest reading is stale: no number is ever
// fabricated or zero-filled.
function gridImportW(rows: { ha_entity_id: string; ts: string; value: number | null }[]): number | null {
  const row = rows.find((entry) => entry.ha_entity_id === GRID_IMPORT_SENSOR)
  if (row === undefined || row.value === null) {
    return null
  }
  if (Date.now() - Date.parse(row.ts) > FRESH_WINDOW_MS) {
    return null
  }
  return Math.round(row.value)
}

// The top bar's quiet live grid indicator: the current gross grid
// draw next to the page title, rendered as muted header furniture -
// no card chrome, no background, no accent color - with a small glyph
// whose slow opacity-and-scale breath carries the pulse. Below the
// shared deadband the glyph rests fully opaque; above it, the pulse
// steps breathe progressively faster with the draw, never blinking.
// Without data the whole badge is simply absent: it degrades
// silently, with no stale number and no pulse.
function LiveGridBadge() {
  const [drawW, setDrawW] = useState<number | null>(null)

  useEffect(() => {
    let inFlight = false
    const load = async () => {
      // Throttled while the tab is hidden; the next visible tick
      // catches up immediately.
      if (document.hidden || inFlight) {
        return
      }
      inFlight = true
      try {
        const rows = await getCurrentMeasurements()
        setDrawW(gridImportW(rows))
      } catch {
        // Fail-soft: keep the previous state's absence of a number
        // rather than fabricating one.
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

  if (drawW === null) {
    return null
  }

  const step = gridPulseStep(drawW)
  const periodS = gridPulsePeriodS(step)

  return (
    // A quiet outline chip: no fill, no blur, just a soft line - the
    // pill reads at a second glance while the pulse carries the
    // signal. It rides at the head of the header's right cluster,
    // before the page's own actions.
    <div className="flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-xs font-medium text-muted-foreground tabular-nums">
      <span>Live usage</span>
      <span
        className={`size-2 rounded-full bg-muted-foreground ${
          periodS !== null ? "grid-pulse" : ""
        }`}
        style={periodS !== null ? { animationDuration: `${periodS.toFixed(2)}s` } : undefined}
        aria-hidden="true"
      />
      <span>{formatGridWatts(drawW)}</span>
    </div>
  )
}

export default LiveGridBadge
