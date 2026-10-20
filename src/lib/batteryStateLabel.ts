// The display-layer mapping from the server-computed battery state to its
// user-facing label. The state itself stays a code-level value everywhere -
// API payloads, data layer, debug panel; only this module spells it out.
// Idle gets the household message: the Anker runs Smart Mode, so an idle
// battery is one that evaluated the window and deliberately chose to wait,
// not a dumb device at rest. The wording is SOC-neutral on purpose - no
// thresholds, no variants. Unknown stays an honest unknown; it never
// becomes the message.

export const BATTERY_IDLE_MESSAGE = "Awaiting its moment";

export function batteryStateLabel(
  state: string | null | undefined
): string {
  switch (state) {
    case "charging":
      return "Charging";
    case "discharging":
      return "Discharging";
    case "idle":
      return BATTERY_IDLE_MESSAGE;
    default:
      // "unavailable", null, missing or unrecognized values all read as an
      // honest unknown - never a fabricated state.
      return "unknown";
  }
}
