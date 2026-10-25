// Price curve merge layer: hourly electricity prices combining the
// TimescaleDB price table (source of truth for completed hours) with the
// Zonneplan quarter-hourly forecast from Home Assistant (current and future
// hours). The merged curve is cached for 10 minutes. No SQL lives here.

import { haGetState } from "./ha.mjs";
import { dbHourlyPrices } from "./queries.mjs";
import {
  localDateKey,
  localDayStartUtcMs,
  localHourKey,
  localHourLabel,
  nextDateKey,
} from "./time.mjs";

const CACHE_TTL_MS = 10 * 60 * 1000;
// Zonneplan forecast amounts are in units of 10^-7 EUR/kWh.
const HA_AMOUNT_DIVISOR = 10_000_000;
const DEFAULT_PRICE_ENTITY =
  "sensor.zonneplan_current_quarter_hourly_electricity_tariff";
const DEFAULT_TOMORROW_STATUS_ENTITY =
  "sensor.zonneplan_electricity_prices_tomorrow_status";
// The cheapest-block endpoint scans the whole available horizon; the
// Zonneplan forecast covers today and (later in the evening) tomorrow.
const HORIZON_DAYS = 2;

function roundPrice(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// The UTC hour bucket of an instant: its floor to the hour in ms. The
// merged curve is keyed by this bucket, not by the wall-clock hour:
// on a DST fall-back day UTC 00:00 (02:00 CEST) and UTC 01:00 (02:00
// CET) share the wall-clock key "T02", so a wall-clock key would
// silently overwrite one of the two tariffs and serve 24 hours.
function hourBucketMs(date) {
  return Math.floor(date.getTime() / 3_600_000) * 3_600_000;
}

const curveCache = new Map(); // days -> { fetchedAt, data }

// Last actual HA fetch observability for the debug panel: whether each
// entity fetch succeeded and when the forecast was last fetched
// successfully. Only updated on real fetches (cache misses), so it
// reports the true age of the served forecast.
const haFetchInfo = {
  priceEntityOk: null, // boolean | null (null: never fetched)
  statusEntityOk: null,
  lastSuccessAt: null, // Date | null
};

// GET /api/debug/time ha_fetch field: HA price fetch success and the age
// of the price forecast.
export function getHaFetchInfo() {
  const lastSuccessAt = haFetchInfo.lastSuccessAt;
  return {
    price_entity_ok: haFetchInfo.priceEntityOk,
    tomorrow_status_entity_ok: haFetchInfo.statusEntityOk,
    price_forecast_fetched_at:
      lastSuccessAt === null ? null : lastSuccessAt.toISOString(),
    price_forecast_age_min:
      lastSuccessAt === null
        ? null
        : Math.round((Date.now() - lastSuccessAt.getTime()) / 60_000),
  };
}

// Pure merge of the database rows and the HA quarter-hourly forecast
// into the hourly curve, keyed by the UTC hour bucket so the two
// 02:00 tariffs of a DST fall-back day stay distinct. `now` gates the
// completed database hours, `currentHourMs` the forecast's past
// blocks, and the date keys the window. Entries are sorted by ts and
// hold { key (UTC hour start ms), ts (Date), price, source }. Day
// filtering stays wall-clock based (localDateKey is date-derived and
// collision-free). Exported for tests.
export function mergePriceCurve({
  now,
  currentHourMs,
  todayKey,
  tomorrowKey,
  windowEndKey,
  dbRows,
  forecast,
}) {
  const byKey = new Map(); // UTC hour start ms -> entry

  // (a) Database rows, authoritative for completed hours only.
  for (const row of dbRows) {
    const ts = row.ts instanceof Date ? row.ts : new Date(row.ts);
    if (row.price_eur === null || ts.getTime() + 3_600_000 > now.getTime()) {
      continue; // not a completed hour yet, or no price
    }
    const key = hourBucketMs(ts);
    byKey.set(key, {
      key,
      ts: new Date(key),
      price: row.price_eur,
      source: "db",
    });
  }

  // (b) HA quarter-hourly forecast, averaged per hour, for the current
  // and future hours in the window.
  let haHasTomorrow = false;
  if (Array.isArray(forecast)) {
    const buckets = new Map(); // UTC hour start ms -> { sum, count }
    for (const block of forecast) {
      const amount = Number(block?.price_tax_included?.amount);
      const startDate = block?.start_date;
      if (!Number.isFinite(amount) || !startDate) {
        continue;
      }
      const start = new Date(startDate);
      if (Number.isNaN(start.getTime())) {
        continue;
      }
      const key = hourBucketMs(start);
      const datePart = localDateKey(new Date(key));
      if (datePart === tomorrowKey) {
        haHasTomorrow = true;
      }
      if (key < currentHourMs || datePart >= windowEndKey) {
        continue; // past block, or outside the requested window
      }
      const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
      bucket.sum += amount;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    for (const [key, bucket] of buckets) {
      byKey.set(key, {
        key,
        ts: new Date(key),
        price: bucket.sum / bucket.count / HA_AMOUNT_DIVISOR,
        source: "ha",
      });
    }
  }

  const entries = [...byKey.values()].sort(
    (a, b) => a.ts.getTime() - b.ts.getTime()
  );
  return { entries, haHasTomorrow };
}

// The price entry of the hour containing `nowMs`, by timestamp
// containment: unambiguous during the repeated wall-clock hour of a
// DST transition day, where two entries share the same local "02:00".
export function currentPriceEntry(entries, nowMs) {
  return (
    entries.find(
      (entry) =>
        nowMs >= entry.ts.getTime() &&
        nowMs < entry.ts.getTime() + 3_600_000
    ) ?? null
  );
}

// Merged hourly curve for a window of `days` calendar days starting today.
// Data shape: { entries, todayKey, tomorrowKey, currentHourMs,
// tomorrowAvailable, tomorrowStatusAvailable }
// where entries are sorted by ts and hold { key, ts (Date), price, source }.
async function loadCurve(days) {
  const hit = curveCache.get(days);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.data;
  }

  const now = new Date();
  const todayKey = localDateKey(now);
  // Calendar-safe day keys: adding 24 hours to a Date would land on the
  // same local date in the early hours of a 25-hour DST day.
  const tomorrowKey = nextDateKey(todayKey, 1);
  const windowStartMs = localDayStartUtcMs(todayKey);
  const windowEndKey = nextDateKey(todayKey, days);
  const windowEndMs = localDayStartUtcMs(windowEndKey);
  const currentHourMs = hourBucketMs(now);

  const [dbRows, haState, tomorrowState] = await Promise.all([
    dbHourlyPrices(windowStartMs, windowEndMs).catch(() => []),
    haGetState(process.env.ZONNEPLAN_PRICE_ENTITY ?? DEFAULT_PRICE_ENTITY),
    haGetState(
      process.env.ZONNEPLAN_PRICES_TOMORROW_STATUS_ENTITY ??
        DEFAULT_TOMORROW_STATUS_ENTITY
    ),
  ]);

  // Observability for the debug panel: which entity fetches succeeded,
  // and how old the served forecast is.
  haFetchInfo.priceEntityOk = haState !== null;
  haFetchInfo.statusEntityOk = tomorrowState !== null;
  if (haState !== null) {
    haFetchInfo.lastSuccessAt = new Date();
  }

  const { entries, haHasTomorrow } = mergePriceCurve({
    now,
    currentHourMs,
    todayKey,
    tomorrowKey,
    windowEndKey,
    dbRows,
    forecast: haState?.attributes?.forecast,
  });

  const statusAvailable =
    typeof tomorrowState?.state === "string" &&
    tomorrowState.state.toLowerCase() === "available";

  const data = {
    entries,
    todayKey,
    tomorrowKey,
    currentHourMs,
    tomorrowAvailable: statusAvailable || haHasTomorrow,
    // Whether the Zonneplan publication status entity itself confirms
    // that tomorrow's prices are published (independent of any forecast
    // rows): the AI context requires this confirmation.
    tomorrowStatusAvailable: statusAvailable,
  };
  curveCache.set(days, { fetchedAt: Date.now(), data });
  return data;
}

function dayStats(hours) {
  if (hours.length === 0) {
    return { average: null, min: null, max: null };
  }
  const prices = hours.map((hour) => hour.price_eur);
  const sum = prices.reduce((total, price) => total + (price ?? 0), 0);
  return {
    average: roundPrice(sum / prices.length),
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

// Cheapest run of `size` consecutive hourly buckets starting from
// `fromMs` (the current hour's start, or -Infinity to admit every
// entry), by average price. Returns null when the horizon has fewer
// than `size` contiguous hours.
function cheapestFromEntries(entries, fromMs, size) {
  const future = entries.filter((entry) => entry.ts.getTime() >= fromMs);
  let best = null;
  for (let i = 0; i + size <= future.length; i++) {
    const window = future.slice(i, i + size);
    let contiguous = true;
    for (let j = 1; j < window.length; j++) {
      if (window[j].ts.getTime() - window[j - 1].ts.getTime() !== 3_600_000) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) {
      continue;
    }
    const average =
      window.reduce((total, entry) => total + entry.price, 0) / size;
    if (!best || average < best.average) {
      best = {
        average,
        start: window[0].ts,
        end: new Date(window[size - 1].ts.getTime() + 3_600_000),
      };
    }
  }
  if (!best) {
    return null;
  }
  return {
    start: best.start.toISOString(),
    end: best.end.toISOString(),
    average_price: roundPrice(best.average),
  };
}

function toHourEntry(entry) {
  return { ts: entry.ts.toISOString(), price_eur: entry.price, source: entry.source };
}

// GET /api/prices response body.
export async function getPriceSummary(days) {
  const { entries, todayKey, tomorrowKey, currentHourMs, tomorrowAvailable } =
    await loadCurve(days);
  const todayEntries = entries.filter(
    (entry) => localDateKey(entry.ts) === todayKey
  );
  const tomorrowEntries = entries.filter(
    (entry) => localDateKey(entry.ts) === tomorrowKey
  );
  const todayHours = todayEntries.map(toHourEntry);
  const tomorrowHours = tomorrowEntries.map(toHourEntry);
  return {
    hours: entries.map(toHourEntry),
    today: dayStats(todayHours),
    tomorrow: {
      available: tomorrowAvailable,
      hours: tomorrowHours,
      ...dayStats(tomorrowHours),
    },
    cheapest_block: cheapestFromEntries(entries, currentHourMs, 3),
    // The day's actual cheapest window, whole-day (an empty key admits
    // every hour): the single source the advisory card and the prices
    // widget both consume, so the two surfaces can never disagree
    // about the day's cheapest hours.
    day_cheapest_block: cheapestFromEntries(todayEntries, "", 3),
  };
}

// GET /api/prices/cheapest response body: the block only, or null.
export async function getCheapestBlock(size) {
  const { entries, currentHourMs } = await loadCurve(HORIZON_DAYS);
  return cheapestFromEntries(entries, currentHourMs, size);
}

// Compact data for the AI price insight: current price, per-day stats with
// the peak hour, tomorrow availability, and the cheapest block. All values
// come from the cached merged curve.
export async function getPriceContextData() {
  const summary = await getPriceSummary(HORIZON_DAYS);
  const {
    entries,
    todayKey,
    tomorrowKey,
    currentHourMs,
    tomorrowStatusAvailable,
  } = await loadCurve(HORIZON_DAYS);
  // The current hour's entry by timestamp containment, so the repeated
  // wall-clock hour of a DST transition day cannot select the wrong
  // tariff.
  const currentEntry = currentPriceEntry(entries, currentHourMs);
  const todayEntries = entries.filter(
    (entry) => localDateKey(entry.ts) === todayKey
  );
  const tomorrowEntries = entries.filter(
    (entry) => localDateKey(entry.ts) === tomorrowKey
  );
  let peak = null;
  let low = null;
  for (const entry of todayEntries) {
    if (!peak || entry.price > peak.price) {
      peak = {
        hour: Number(localHourKey(entry.ts).slice(11, 13)),
        price: entry.price,
      };
    }
    if (!low || entry.price < low.price) {
      low = {
        hour: Number(localHourKey(entry.ts).slice(11, 13)),
        price: entry.price,
      };
    }
  }
  // Highest price among the remaining hours, for the AI context signature.
  const remainingEntries = entries.filter(
    (entry) => entry.key >= currentHourMs
  );
  const remainingMaxPrice =
    remainingEntries.length > 0
      ? Math.max(...remainingEntries.map((entry) => entry.price))
      : null;
  // The average price of today's remaining hours (now until local
  // midnight), for the evening price situation: a live reference the
  // advisory card states honestly once the today window no longer
  // commands.
  const remainingTodayEntries = todayEntries.filter(
    (entry) => entry.key >= currentHourMs
  );
  const remainingAverageEur =
    remainingTodayEntries.length > 0
      ? roundPrice(
          remainingTodayEntries.reduce(
            (total, entry) => total + entry.price,
            0
          ) / remainingTodayEntries.length
        )
      : null;
  // Peak hours above EMS_PRICE_PEAK_EUR (default 0.35 EUR/kWh), for the
  // decision insight: hours the model should steer away from. The
  // threshold is re-read per call so a change applies without a
  // restart; invalid or unset values fall back to the default.
  const peakThresholdRaw = Number.parseFloat(
    process.env.EMS_PRICE_PEAK_EUR ?? ""
  );
  const peakThreshold =
    Number.isFinite(peakThresholdRaw) && peakThresholdRaw > 0
      ? peakThresholdRaw
      : 0.35;
  const peakHourLabels = (rows) =>
    rows
      .filter((entry) => entry.price > peakThreshold)
      .map((entry) => localHourLabel(entry.ts));
  return {
    priceData: {
      current_price: currentEntry ? currentEntry.price : null,
      today: {
        average: summary.today.average,
        min: summary.today.min,
        max: summary.today.max,
        peak_hour: peak ? `${String(peak.hour).padStart(2, "0")}:00` : null,
        // The hour of today's lowest price, next to the peak hour, so
        // the advisory's price sentence can name the low with its own
        // timestamp - a computed field, never a model guess.
        low_hour: low ? `${String(low.hour).padStart(2, "0")}:00` : null,
      },
      tomorrow: {
        available: summary.tomorrow.available,
        average: summary.tomorrow.average,
        min: summary.tomorrow.min,
        max: summary.tomorrow.max,
      },
    },
    // Context integrity: tomorrow's prices may only be used in an AI
    // context once the publication status entity confirms availability
    // AND rows for tomorrow exist in the merged curve. Rows alone are
    // never trusted: Zonneplan publishes them around 18:00 and the
    // status entity is the confirmation.
    tomorrowPricesAvailable:
      tomorrowStatusAvailable === true && tomorrowEntries.length > 0,
    // Whether the merged curve also carries the day after tomorrow:
    // with the current Zonneplan feed it never does (the window is
    // today plus tomorrow), so the day-ahead advisory can label its
    // horizon honestly - cheapest day known so far.
    dayAfterPricesAvailable:
      entries.filter(
        (entry) => localDateKey(entry.ts) === nextDateKey(tomorrowKey, 1)
      ).length > 0,
    cheapestBlock: summary.cheapest_block,
    // Per-day cheapest windows and the remaining peak, for the insight
    // context signature.
    cheapestByDay: {
      today: cheapestFromEntries(todayEntries, currentKey, 3),
      tomorrow: cheapestFromEntries(tomorrowEntries, currentKey, 3),
    },
    // The day's actual cheapest window, whole-day (an empty key admits
    // every hour): the honest reference when the remaining window is a
    // late remnant and the card states the passed cheap hours.
    dayCheapestWindow: cheapestFromEntries(todayEntries, "", 3),
    remainingMaxPrice,
    // Today's remaining-hours average (now until local midnight).
    remainingAverageEur,
    // Peak hours per day for the decision insight context.
    peakHours: {
      today: peakHourLabels(todayEntries),
      tomorrow: peakHourLabels(tomorrowEntries),
    },
    peakThresholdEur: peakThreshold,
  };
}
