// The live power card's speed mapping: the current grid draw maps to
// a discrete pulse step, the step to the pulse period, and the draw
// to its human label. Pure, so the card's behavior is testable
// without the network.

// Below the shared 25 W deadband the draw sits at step 0: not a
// rest, but a very slow creep - the circle always shows life while
// anything flows, however little. Zero draw is the one calm state,
// and the card renders it as an empty ring without an arc.
export const GRID_PULSE_DEADBAND_W = 25
// One pulse step per STEP_W band of draw.
export const GRID_PULSE_STEP_W = 500
// The pulse never gets faster than the max step's period, however
// high the draw climbs.
export const GRID_PULSE_MAX_STEP = 6

// The step 0 creep period, the slowest of all.
const PERIOD_CREEP_S = 8
// The slowest regular pulse period (the first step above the
// deadband) and the fastest (the max step).
const PERIOD_SLOWEST_S = 4
const PERIOD_FASTEST_S = 0.8

// The pulse step of a grid draw: 0 below the deadband (the slow
// creep), then one step per STEP_W band - capped at the max step.
// The first pulse step starts at the deadband, so every draw above
// it pulses; the steps stay discrete, never interpolated.
export function gridPulseStep(drawW: number): number {
  if (drawW <= GRID_PULSE_DEADBAND_W) {
    return 0
  }
  return Math.min(
    GRID_PULSE_MAX_STEP,
    Math.max(1, Math.floor(drawW / GRID_PULSE_STEP_W))
  )
}

// The pulse period of a step, one single linear mapping: step 0
// creeps once every creep period, the first regular step breathes
// once every slowest period, decreasing linearly to the max step's
// fastest period.
export function gridPulsePeriodS(step: number): number {
  if (step <= 0) {
    return PERIOD_CREEP_S
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
