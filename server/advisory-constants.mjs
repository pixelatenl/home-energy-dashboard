// The advisory's price-spread thresholds, defined once so they can
// never be swapped. The distinction matters (C17): a window whose
// expected benefit sits between these two values is detectable but not
// worth acting on, so it may be stated as a plain fact but never with
// imperative wording.

// The minimum DETECTABLE spread: below it the day reads as flat and
// the guidance object is omitted entirely - there is nothing to say,
// not even a fact.
export const GUIDANCE_MIN_SPREAD_EUR = 0.03;

// The minimum BENEFIT WORTH ACTING ON: the expected per-kWh advantage
// a window must deliver against the day's average (the honest live
// reference from the actual price curve) before any imperative
// advisory voice is allowed - the practicality gate, and the C17
// evening-window gate. Never compare a window's benefit against the
// detectable spread to decide whether to command.
export const PRACTICAL_MIN_ADVANTAGE_EUR = 0.05;

// The recap solar achievement line fires at or above this percent of today's usage.
export const ACHIEVEMENT_MIN_SOLAR_SHARE_PCT =
  Number.parseInt(process.env.EMS_ACHIEVEMENT_MIN_SOLAR_SHARE_PCT ?? "", 10) ||
  40;

// The recap battery achievement line fires at or above this euro amount.
const ACHIEVEMENT_MIN_BATTERY_EARN_EUR_RAW = Number.parseFloat(
  process.env.EMS_ACHIEVEMENT_MIN_BATTERY_EARN_EUR ?? ""
);
export const ACHIEVEMENT_MIN_BATTERY_EARN_EUR =
  Number.isFinite(ACHIEVEMENT_MIN_BATTERY_EARN_EUR_RAW) &&
  ACHIEVEMENT_MIN_BATTERY_EARN_EUR_RAW > 0
    ? ACHIEVEMENT_MIN_BATTERY_EARN_EUR_RAW
    : 1.0;
