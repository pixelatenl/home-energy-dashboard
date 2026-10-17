// GET /api/solar/production data: PV production per interval with
// the avoided grid cost, for a date-anchored period window.
//
// Data source rules (strict):
// - Production is kWh deltas of the PV energy counter
//   sensor.zonneplan_one_optimized_yield_total, read through the
//   existing continuous aggregates: energy_hourly for the hourly
//   resolution, energy_daily for the daily one. The power
//   measurement series is never integrated into energy, and the
//   Anker solar_power / total_solar_generation sensors are never
//   read: those are battery internals, not PV production.
// - Avoided cost (the field is avoidedCost, never earnings) values
//   every produced kWh at the grid price of the hour it was
//   produced - a deliberate simplification; the self-consumption
//   split comes later. It is computed bottom-up per interval, never
//   as a period total times an average price. Hourly intervals take
//   their own hour's price row from the price table (EUR/kWh incl.
//   VAT) with the gas convention's last-known-price fallback; a
//   daily interval's cost is the bottom-up sum over its hours' kWh
//   times those hours' prices. An interval without any known price
//   costs null (never 0) and flags hasUnknownPrice; null intervals
//   are excluded from totals.avoidedCostEur but their kWh still
//   counts in totals.kwh. Prices exist only from SOLAR_DATA_START
//   onward.
//
// Known caveats: energy_daily buckets are UTC-aligned until the DB2
// local-day migration lands (expected before 26 Oct), so day and
// month totals may deviate slightly from local calendar days; the
// PV counter updates roughly every 15 minutes, so hourly
// attribution can look stepped while daily totals are correct.

import { pool } from "./db.mjs";
import { dbHourlyPrices } from "./queries.mjs";
import { localDateKey, localDayStartUtcMs } from "./time.mjs";

// The PV production counter's entity name; the numeric ID is always
// resolved from the entity table, never hardcoded. The first day any
// production (or price) data exists for, so the frontend can render
// honest empty states for earlier periods.
const PV_ENTITY = "sensor.zonneplan_one_optimized_yield_total";
export const SOLAR_DATA_START = "2026-10-10";

const round2 = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;

// The PV energy counter's numeric entity ID, by ha_entity_id. Null
// when the counter has not been registered.
async function pvEntityId() {
  const { rows } = await pool.query(
    `SELECT id FROM entity WHERE ha_entity_id = $1`,
    [PV_ENTITY]
  );
  return rows[0]?.id ?? null;
}

// Hourly PV kWh buckets in [from, to) from the energy_hourly
// continuous aggregate.
async function pvHourly(entityId, fromMs, toMs) {
  const { rows } = await pool.query(
    `SELECT h.bucket, h.kwh
       FROM energy_hourly h
      WHERE h.entity_id = $1::smallint
        AND h.bucket >= $2::timestamptz
        AND h.bucket < $3::timestamptz
      ORDER BY h.bucket`,
    [entityId, new Date(fromMs), new Date(toMs)]
  );
  return rows;
}

// Daily PV kWh buckets in [from, to) from the energy_daily
// continuous aggregate. Buckets are UTC-aligned days (see the
// caveat above).
async function pvDaily(entityId, fromMs, toMs) {
  const { rows } = await pool.query(
    `SELECT h.bucket, h.kwh
       FROM energy_daily h
      WHERE h.entity_id = $1::smallint
        AND h.bucket >= $2::timestamptz
        AND h.bucket < $3::timestamptz
      ORDER BY h.bucket`,
    [entityId, new Date(fromMs), new Date(toMs)]
  );
  return rows;
}

// The applicable electricity price for an interval starting at tsMs:
// that hour's own price row, else the most recent earlier one (the
// gas convention's last-known-price fallback). Null when no price
// row exists at all. Pure; priceRows must be ts-ascending.
export function applicablePrice(priceRows, tsMs) {
  let price = null;
  for (const row of priceRows) {
    if (row.ts.getTime() > tsMs) {
      break;
    }
    price = Number(row.price_eur);
  }
  return price;
}

// Hourly intervals priced bottom-up: each bucket's kWh at its own
// hour's price. Pure.
export function hourlyProductionIntervals(hourRows, priceRows) {
  return hourRows.map((row) => {
    const tsMs = row.bucket.getTime();
    const kwh = Number(row.kwh ?? 0);
    const price = applicablePrice(priceRows, tsMs);
    return {
      tsMs,
      kwh,
      costEur: price === null ? null : kwh * price,
    };
  });
}

// Daily intervals: kWh from the energy_daily buckets, cost as the
// bottom-up sum over the day's own hourly buckets of kWh times that
// hour's price - never the day total times one price. A day whose
// producing hours include one without any known price costs null,
// as does a producing day whose hourly buckets are missing entirely
// (aggregate lag). Pure.
export function dailyProductionIntervals(dailyRows, hourRows, priceRows) {
  const hoursByUtcDay = new Map();
  for (const row of hourRows) {
    const tsMs = row.bucket.getTime();
    const dayKey = new Date(tsMs).toISOString().slice(0, 10);
    const hours = hoursByUtcDay.get(dayKey) ?? [];
    hours.push({ tsMs, kwh: Number(row.kwh ?? 0) });
    hoursByUtcDay.set(dayKey, hours);
  }
  return dailyRows.map((row) => {
    const tsMs = row.bucket.getTime();
    const kwh = Number(row.kwh ?? 0);
    const hours = hoursByUtcDay.get(new Date(tsMs).toISOString().slice(0, 10)) ?? [];
    let cost = 0;
    let unknown = kwh > 0 && hours.length === 0;
    for (const hour of hours) {
      if (hour.kwh <= 0) {
        continue;
      }
      const price = applicablePrice(priceRows, hour.tsMs);
      if (price === null) {
        unknown = true;
      } else {
        cost += hour.kwh * price;
      }
    }
    return {
      tsMs,
      kwh,
      costEur: unknown ? null : cost,
    };
  });
}

// The response body from the priced intervals: the series with
// exact-rounding figures, the totals (null intervals excluded from
// the cost, never from the kWh), and the peak interval. Pure.
export function assembleProduction(intervals) {
  const series = intervals.map((interval) => ({
    ts: new Date(interval.tsMs).toISOString(),
    kwh: round3(interval.kwh),
    avoidedCostEur:
      interval.costEur === null ? null : round2(interval.costEur),
  }));
  let totalKwh = 0;
  let totalCost = 0;
  let hasUnknownPrice = false;
  let peak = null;
  for (const point of series) {
    totalKwh += point.kwh;
    if (point.avoidedCostEur === null) {
      hasUnknownPrice = true;
    } else {
      totalCost += point.avoidedCostEur;
    }
    if (peak === null || point.kwh > peak.kwh) {
      peak = { ts: point.ts, kwh: point.kwh };
    }
  }
  return {
    series,
    totals: {
      kwh: round3(totalKwh),
      avoidedCostEur: round2(totalCost),
      hasUnknownPrice,
    },
    peak,
  };
}

// GET /api/solar/production data for [fromMs, toMs): PV production
// with the avoided grid cost, at the given resolution ("hourly" or
// "daily"). Windows that end before the data start carry an empty
// series rather than an error, so the frontend can render its
// honest empty state.
export async function getSolarProduction(fromMs, toMs, resolution) {
  if (localDateKey(new Date(toMs - 1)) < SOLAR_DATA_START) {
    return assembleProduction([]);
  }
  const entityId = await pvEntityId();
  if (entityId === null) {
    return assembleProduction([]);
  }
  // Every price row from the data start: intervals early in the
  // window fall back to the last known price before them.
  const priceRows = await dbHourlyPrices(
    localDayStartUtcMs(SOLAR_DATA_START),
    toMs
  );
  const hourRows = await pvHourly(entityId, fromMs, toMs);
  const intervals =
    resolution === "hourly"
      ? hourlyProductionIntervals(hourRows, priceRows)
      : dailyProductionIntervals(
          await pvDaily(entityId, fromMs, toMs),
          hourRows,
          priceRows
        );
  return assembleProduction(intervals);
}
