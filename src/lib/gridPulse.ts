// The live grid badge's pulse mapping: the current grid draw maps to
// a discrete pulse step, the step to the pulse period, and the draw
// to its human label. Pure, so the badge's behavior is testable
// without the network.

// Below the shared 25 W deadband there is no pulse at all: a
// household drawing nothing from the grid looks calm, not animated.
export const GRID_PULSE_DEADBAND_W = 25
// One pulse step per STEP_W band of draw.
export const GRID_PULSE_STEP_W = 500
// The pulse never gets faster than the max step's period, however
// high the draw climbs.
export const GRID_PULSE_MAX_STEP = 6

// The slowest pulse period (the first step above the deadband) and
// the fastest (the max step).
const PERIOD_SLOWEST_S = 4
const PERIOD_FASTEST_S = 0.8

// The pulse step of a grid draw: 0 below the deadband (no animation,
// the glyph rests fully opaque), then one step per STEP_W band -
// capped at the max step. The first pulse step starts at the
// deadband, so every draw above it pulses; the steps stay discrete,
// never interpolated.
export function gridPulseStep(drawW: number): number {
  if (drawW <= GRID_PULSE_DEADBAND_W) {
    return 0
  }
  return Math.min(
    GRID_PULSE_MAX_STEP,
    Math.max(1, Math.floor(drawW / GRID_PULSE_STEP_W))
  )
}

// The pulse period of a step, one single linear mapping: the first
// step breathes once every slowest period, decreasing linearly to
// the max step's fastest period. Step 0 has no animation at all.
export function gridPulsePeriodS(step: number): number | null {
  if (step <= 0) {
    return null
  }
  const span = PERIOD_SLOWEST_S - PERIOD_FASTEST_S
  return PERIOD_SLOWEST_S - (span * (step - 1)) / (GRID_PULSE_MAX_STEP - 1)
}

// The human label of a grid draw: watts below 1000, kilowatts with
// one decimal from 1000 up - the same figure the hub's grid stat
// shows, formatted for a second glance.
export function formatGridWatts(drawW: number): string {
  if (drawW < 1000) {
    return `${Math.round(drawW)} W`
  }
  return `${(drawW / 1000).toFixed(1)} kW`
}
