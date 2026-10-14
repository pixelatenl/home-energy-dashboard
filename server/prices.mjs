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

// Merged hourly curve for a window of `days` calendar days starting today.
// Data shape: { entries, todayKey, tomorrowKey, currentKey, tomorrowAvailable,
// tomorrowStatusAvailable }
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
  const currentKey = localHourKey(now);

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

  const byKey = new Map(); // hourKey -> entry

  // (a) Database rows, authoritative for completed hours only.
  for (const row of dbRows) {
    const ts = row.ts instanceof Date ? row.ts : new Date(row.ts);
    if (row.price_eur === null || ts.getTime() + 3_600_000 > now.getTime()) {
      continue; // not a completed hour yet, or no price
    }
    byKey.set(localHourKey(ts), {
      key: localHourKey(ts),
      ts,
      price: row.price_eur,
      source: "db",
    });
  }

  // (b) HA quarter-hourly forecast, averaged per hour, for the current and
  // future hours in the window.
  let haHasTomorrow = false;
  const forecast = haState?.attributes?.forecast;
  if (Array.isArray(forecast)) {
    const buckets = new Map(); // hourKey -> { sum, count }
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
      const key = localHourKey(start);
      if (key.slice(0, 10) === tomorrowKey) {
        haHasTomorrow = true;
      }
      if (key < currentKey || key.slice(0, 10) >= windowEndKey) {
        continue; // past block, or outside the requested window
      }
      const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
      bucket.sum += amount;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    for (const [key, bucket] of buckets) {
      const datePart = key.slice(0, 10);
      const hourPart = Number(key.slice(11, 13));
      const ts = new Date(localDayStartUtcMs(datePart) + hourPart * 3_600_000);
      byKey.set(key, {
        key,
        ts,
        price: bucket.sum / bucket.count / HA_AMOUNT_DIVISOR,
        source: "ha",
      });
    }
  }

  const entries = [...byKey.values()].sort(
    (a, b) => a.ts.getTime() - b.ts.getTime()
  );
  const statusAvailable =
    typeof tomorrowState?.state === "string" &&
    tomorrowState.state.toLowerCase() === "available";

  const data = {
    entries,
    todayKey,
    tomorrowKey,
    currentKey,
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

// Cheapest run of `size` consecutive hourly buckets starting from the
// current hour, by average price. Returns null when the horizon has fewer
// than `size` contiguous hours.
function cheapestFromEntries(entries, currentKey, size) {
  const future = entries.filter((entry) => entry.key >= currentKey);
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
  const { entries, todayKey, tomorrowKey, currentKey, tomorrowAvailable } =
    await loadCurve(days);
  const todayEntries = entries.filter(
    (entry) => entry.key.slice(0, 10) === todayKey
  );
  const tomorrowEntries = entries.filter(
    (entry) => entry.key.slice(0, 10) === tomorrowKey
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
    cheapest_block: cheapestFromEntries(entries, currentKey, 3),
    // The day's actual cheapest window, whole-day (an empty key admits
    // every hour): the single source the advisory card and the prices
    // widget both consume, so the two surfaces can never disagree
    // about the day's cheapest hours.
    day_cheapest_block: cheapestFromEntries(todayEntries, "", 3),
  };
}

// GET /api/prices/cheapest response body: the block only, or null.
export async function getCheapestBlock(size) {
  const { entries, currentKey } = await loadCurve(HORIZON_DAYS);
  return cheapestFromEntries(entries, currentKey, size);
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
    currentKey,
    tomorrowStatusAvailable,
  } = await loadCurve(HORIZON_DAYS);
  const currentEntry =
    entries.find((entry) => entry.key === currentKey) ?? null;
  const todayEntries = entries.filter(
    (entry) => entry.key.slice(0, 10) === todayKey
  );
  const tomorrowEntries = entries.filter(
    (entry) => entry.key.slice(0, 10) === tomorrowKey
  );
  let peak = null;
  for (const entry of todayEntries) {
    if (!peak || entry.price > peak.price) {
      peak = { hour: Number(entry.key.slice(11, 13)), price: entry.price };
    }
  }
  // Highest price among the remaining hours, for the AI context signature.
  const remainingEntries = entries.filter((entry) => entry.key >= currentKey);
  const remainingMaxPrice =
    remainingEntries.length > 0
      ? Math.max(...remainingEntries.map((entry) => entry.price))
      : null;
  // The average price of today's remaining hours (now until local
  // midnight), for the evening price situation: a live reference the
  // advisory card states honestly once the today window no longer
  // commands.
  const remainingTodayEntries = todayEntries.filter(
    (entry) => entry.key >= currentKey
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
      .map((entry) => `${entry.key.slice(11, 13)}:00`);
  return {
    priceData: {
      current_price: currentEntry ? currentEntry.price : null,
      today: {
        average: summary.today.average,
        min: summary.today.min,
        max: summary.today.max,
        peak_hour: peak ? `${String(peak.hour).padStart(2, "0")}:00` : null,
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
        (entry) => entry.key.slice(0, 10) === nextDateKey(tomorrowKey, 1)
      ).length > 0,
    cheapestBlock: summary.cheapest_block,
    // Per-day cheapest windows and the remaining peak, for the AI insight
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
