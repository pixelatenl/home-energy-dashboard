// Grid renewables share (the "Energy sustainability" hub stat). The
// Zonneplan sustainability metric is the share of wind and solar
// supply in Dutch grid electricity per quarter-hour, read as raw
// permille from the same Zonneplan forecast attribute the price
// curve uses (shared haGetState cache, so no extra HA call). The raw
// ratio can exceed 1000 permille during renewables surplus; the
// Zonneplan app always displays it capped, so every served value is
// capped at 100 too - the uncapped permille rides the debug payload
// only. Fail-soft: without the forecast the stat falls back to the
// capped sensor value alone and the curve is omitted.

import { haGetState } from "./ha.mjs";
import { localDateKey, localHourKey, nextDateKey } from "./time.mjs";

// Our own interpretation of the app's color badge (Zonneplan
// publishes no thresholds): green at 75 and above, yellow between 40
// and 75, grey below 40. One place to recalibrate against app
// observations (first known point: green at 88).
const GREEN_MIN = 75;
const YELLOW_MIN = 40;
// The sub-caption movement threshold: only a swing of at least this
// many points against the current score earns a prediction, and a
// curve whose whole range stays under it reads as flat.
const MOVEMENT_MIN_POINTS = 15;

const DEFAULT_PRICE_ENTITY =
  "sensor.zonneplan_current_quarter_hourly_electricity_tariff";
const DEFAULT_TOMORROW_STATUS_ENTITY =
  "sensor.zonneplan_electricity_prices_tomorrow_status";
const DEFAULT_SCORE_ENTITY =
  "sensor.zonneplan_current_sustainability_score";

const round1 = (value) => Math.round(value * 10) / 10;

// The color state for a display score, our interpretation (shipped as
// a string so the frontend never re-derives it).
export function gridScoreState(score) {
  if (score === null) {
    return null;
  }
  if (score >= GREEN_MIN) {
    return "green";
  }
  if (score >= YELLOW_MIN) {
    return "yellow";
  }
  return "grey";
}

// The sub-caption fact, computed server-side and rendered verbatim by
// the frontend as the movement clause after its own "(now)" label:
// the largest upcoming drop or rise of at least MOVEMENT_MIN_POINTS
// against the current score, with the hour it lands; "flat all day"
// when the curve's range stays under the threshold; null when there
// is nothing honest to predict.
function buildSubCaption(currentScore, curve, todayKey) {
  if (currentScore === null || curve.length < 2) {
    return null;
  }
  const scores = curve.map((point) => point.score);
  const range = Math.max(...scores) - Math.min(...scores);
  if (range < MOVEMENT_MIN_POINTS) {
    return "flat all day";
  }
  let drop = null; // { delta, score, hour }
  let rise = null;
  for (const point of curve.slice(1)) {
    const fall = currentScore - point.score;
    if (fall >= MOVEMENT_MIN_POINTS && (drop === null || fall > drop.delta)) {
      drop = { delta: fall, score: point.score, hour: point.hour };
    }
    const climb = point.score - currentScore;
    if (climb >= MOVEMENT_MIN_POINTS && (rise === null || climb > rise.delta)) {
      rise = { delta: climb, score: point.score, hour: point.hour };
    }
  }
  let movement = null;
  if (drop !== null && (rise === null || drop.delta >= rise.delta)) {
    movement = { kind: "falls", ...drop };
  } else if (rise !== null) {
    movement = { kind: "rises", ...rise };
  }
  if (movement === null) {
    return null;
  }
  const daySuffix =
    movement.hour.slice(0, 10) === todayKey ? "" : " tomorrow";
  return `${movement.kind} to ${Math.round(movement.score)}% at ${movement.hour.slice(11, 13)}:00${daySuffix}`;
}

// Pure builder from the three HA states, so the conversion, capping,
// curve and sub-caption rules are testable without HA. Returns the
// full object; getGridScore strips the debug-only fields for the
// summary payload.
export function buildGridScore(
  tariffState,
  scoreState,
  tomorrowState,
  now = new Date()
) {
  const forecast = Array.isArray(tariffState?.attributes?.forecast)
    ? tariffState.attributes.forecast
    : [];
  const todayKey = localDateKey(now);
  const tomorrowKey = nextDateKey(todayKey, 1);
  const windowEndKey = nextDateKey(todayKey, 2);
  const currentKey = localHourKey(now);

  // Per-hour buckets from the current hour onwards through the end of
  // tomorrow (whatever the forecast actually provides, never
  // extrapolated), capped per block like the app displays it; raw
  // sums kept for the debug permille.
  const buckets = new Map(); // hourKey -> { sum, rawSum, count }
  let rawCurrentPermille = null;
  let currentSource = null;
  let currentScore = null;
  let haHasTomorrow = false;

  for (const block of forecast) {
    const permille = Number(block?.sustainability_score?.permille);
    const startDate = block?.start_date;
    if (!Number.isFinite(permille) || !startDate) {
      continue;
    }
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      continue;
    }
    // The current value comes from the forecast block containing now
    // (the app's own data), not the HA sensor. Requires a valid
    // end_date, so a block without one can never falsely contain now.
    if (currentScore === null) {
      const end = block?.end_date ? new Date(block.end_date) : null;
      if (
        end !== null &&
        !Number.isNaN(end.getTime()) &&
        start.getTime() <= now.getTime() &&
        now.getTime() < end.getTime()
      ) {
        rawCurrentPermille = permille;
        currentScore = round1(Math.min(permille, 1000) / 10);
        currentSource = "forecast";
      }
    }
    const key = localHourKey(start);
    if (key.slice(0, 10) === tomorrowKey) {
      haHasTomorrow = true;
    }
    if (key < currentKey || key.slice(0, 10) >= windowEndKey) {
      continue; // past block, or outside today plus tomorrow
    }
    const bucket = buckets.get(key) ?? { sum: 0, rawSum: 0, count: 0 };
    bucket.sum += Math.min(permille, 1000);
    bucket.rawSum += permille;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  // No block contained now: the current hour's own average stands in.
  if (currentScore === null && buckets.has(currentKey)) {
    const bucket = buckets.get(currentKey);
    currentScore = round1(bucket.sum / bucket.count / 10);
    rawCurrentPermille = round1(bucket.rawSum / bucket.count);
    currentSource = "forecast";
  }

  const curve = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([hour, bucket]) => ({
      hour,
      score: round1(bucket.sum / bucket.count / 10),
    }));

  // The tomorrow availability gate reused from the tomorrow prices
  // logic: the publication status entity confirms it, or rows for
  // tomorrow actually exist - never a guess.
  const statusAvailable =
    typeof tomorrowState?.state === "string" &&
    tomorrowState.state.toLowerCase() === "available";
  const tomorrowAvailable =
    curve.length > 0 && (statusAvailable || haHasTomorrow);

  // Fail-soft: without any forecast value the stat falls back to the
  // capped sensor score alone; the curve stays omitted (no zeros).
  if (currentScore === null) {
    const sensor = Number.parseFloat(scoreState?.state);
    if (Number.isFinite(sensor)) {
      currentScore = round1(Math.min(Math.max(sensor, 0), 100));
      currentSource = "sensor";
    }
  }

  return {
    current: currentScore,
    state: gridScoreState(currentScore),
    curve,
    horizon_hours: curve.length,
    tomorrow_available: tomorrowAvailable,
    sub: buildSubCaption(currentScore, curve, todayKey),
    // Debug-only fields, stripped from the summary payload.
    raw_current_permille: rawCurrentPermille,
    current_source: currentScore === null ? null : currentSource,
    thresholds: { green_min: GREEN_MIN, yellow_min: YELLOW_MIN },
  };
}

// The summary payload's grid_score object: display fields only.
export async function getGridScore() {
  const full = await getGridScoreFull();
  const {
    raw_current_permille: _raw,
    current_source: _source,
    thresholds: _thresholds,
    ...display
  } = full;
  return display;
}

// The debug payload's grid_score object: the display fields plus the
// raw uncapped permille, the current value's source and the state
// thresholds, so the curve can be verified against the raw HA
// forecast.
export async function getGridScoreDebug() {
  return getGridScoreFull();
}

async function getGridScoreFull() {
  const [tariffState, scoreState, tomorrowState] = await Promise.all([
    haGetState(process.env.ZONNEPLAN_PRICE_ENTITY ?? DEFAULT_PRICE_ENTITY),
    haGetState(process.env.ZONNEPLAN_SCORE_ENTITY ?? DEFAULT_SCORE_ENTITY),
    haGetState(
      process.env.ZONNEPLAN_PRICES_TOMORROW_STATUS_ENTITY ??
        DEFAULT_TOMORROW_STATUS_ENTITY
    ),
  ]);
  return buildGridScore(tariffState, scoreState, tomorrowState);
}
