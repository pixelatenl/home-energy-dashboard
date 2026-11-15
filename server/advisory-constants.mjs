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

// The solar score bands, defined once here so the advisory core and the
// weather context box can never disagree about a score. The score itself
// is 0 to 100 against the theoretical best day of the year (weather.mjs:
// around 90 is a sunny July day, 30 to 40 a good October day). Plain
// constants, no ENV override: one meaning for every consumer.
export const LOW_SOLAR_SCORE = 20;
export const GOOD_SOLAR_SCORE = 60;

// The band label for a solar score: below LOW_SOLAR_SCORE is "little
// sun", from LOW_SOLAR_SCORE up to and including GOOD_SOLAR_SCORE is
// "moderate", above GOOD_SOLAR_SCORE is "good". A non-finite score reads
// as 0 (weather.mjs never serves NaN), so it lands in the little-sun
// band rather than escaping every band.
export function solarScoreBand(score) {
  const value = Number.isFinite(score) ? score : 0;
  if (value < LOW_SOLAR_SCORE) return "little sun";
  if (value <= GOOD_SOLAR_SCORE) return "moderate";
  return "good";
}
