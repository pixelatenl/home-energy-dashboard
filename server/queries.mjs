// All SQL for the local data server lives in this file only, so migrating to
// the permanent backend is a copy operation.
//
// Assumed schema (adjust column names here if the database differs):
//   entity(id, ha_entity_id, domain, unit, is_counter)
//   energy_daily(entity_id, bucket, kwh)          -- continuous aggregate
//   energy_hourly(entity_id, bucket, kwh)         -- continuous aggregate
//   measurement_hourly(entity_id, bucket, avg_value, max_value, min_value)
//   measurement(entity_id, ts, value, state)       -- hypertable
//   price(ts, price_eur, tariff?)                  -- tariff column optional
//
// Every query is parameterized; user input is never interpolated into SQL.

import { pool } from "./db.mjs";
import {
  localDateKey,
  localDayStartUtcMs,
  mondayDateKey,
} from "./time.mjs";

export async function listEntities() {
  const { rows } = await pool.query(
    `SELECT id, ha_entity_id, domain, unit, is_counter
       FROM entity
      ORDER BY id`
  );
  return rows;
}

export async function dailyTotals(days) {
  const { rows } = await pool.query(
    `SELECT e.id,
            e.ha_entity_id,
            e.domain,
            d.bucket AS day,
            d.kwh
       FROM energy_daily d
       JOIN entity e ON e.id = d.entity_id
      WHERE d.bucket >= date_trunc('day', now()) - make_interval(days => $1)
      ORDER BY d.bucket, e.id`,
    [days]
  );
  return rows;
}

export async function hourlyTotals(hours) {
  const { rows } = await pool.query(
    `SELECT e.id,
            e.ha_entity_id,
            e.domain,
            h.bucket AS hour,
            h.kwh
       FROM energy_hourly h
       JOIN entity e ON e.id = h.entity_id
      WHERE h.bucket >= date_trunc('hour', now()) - make_interval(hours => $1)
      ORDER BY h.bucket, e.id`,
    [hours]
  );
  return rows;
}

export async function hourlySeries(hours) {
  const { rows } = await pool.query(
    `SELECT e.id,
            e.ha_entity_id,
            e.domain,
            e.unit,
            h.bucket AS hour,
            h.avg_value,
            h.max_value
       FROM measurement_hourly h
       JOIN entity e ON e.id = h.entity_id
      WHERE h.bucket >= date_trunc('hour', now()) - make_interval(hours => $1)
      ORDER BY h.bucket, e.id`,
    [hours]
  );
  return rows;
}

export async function currentMeasurements() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (m.entity_id)
            m.entity_id AS id,
            e.ha_entity_id,
            e.domain,
            m.ts,
            m.value,
            m.state,
            e.unit
       FROM measurement m
       JOIN entity e ON e.id = m.entity_id
      ORDER BY m.entity_id, m.ts DESC`
  );
  return rows;
}

// Hourly price rows in [from, to), for the price curve merge in prices.mjs.
// The database is the source of truth for completed hours only; the merge
// layer decides which rows are used.
export async function dbHourlyPrices(fromMs, toMs) {
  const { rows } = await pool.query(
    `SELECT ts, price_eur
       FROM price
      WHERE ts >= $1::timestamptz AND ts < $2::timestamptz
      ORDER BY ts`,
    [new Date(fromMs), new Date(toMs)]
  );
  return rows;
}

// --- Dashboard summary statistics ---

const round2 = (value) => Math.round(value * 100) / 100;

// Verified energy counters in energy_delta, resolved by ha_entity_id; the
// numeric entity IDs are never hardcoded. Import and export are
// daily-resetting counters summed within the local-day window; PV and the
// battery are lifetime counters whose increments sum identically.
const COUNTER_ENTITIES = {
  import: "sensor.zonneplan_electricity_consumption_today",
  export: "sensor.zonneplan_electricity_returned_today",
  pv: "sensor.zonneplan_one_optimized_yield_total",
  batteryCharging:
    "sensor.anker_solix_solarbank_max_ac_009_battery_charging_energy",
  batteryDischarging:
    "sensor.anker_solix_solarbank_max_ac_009_battery_discharge_energy",
};

let entityMapCache = null; // { fetchedAt, map }
const ENTITY_MAP_TTL_MS = 10 * 60 * 1000;

// Maps the counter roles to entity IDs by ha_entity_id.
async function resolveEntityMap() {
  if (entityMapCache && Date.now() - entityMapCache.fetchedAt < ENTITY_MAP_TTL_MS) {
    return entityMapCache.map;
  }
  const { rows } = await pool.query(
    `SELECT id, ha_entity_id
       FROM entity
      WHERE ha_entity_id = ANY($1::text[])`,
    [Object.values(COUNTER_ENTITIES)]
  );
  const idByName = new Map(rows.map((row) => [row.ha_entity_id, row.id]));
  const map = {};
  for (const [role, name] of Object.entries(COUNTER_ENTITIES)) {
    map[role] = idByName.get(name) ?? null;
  }
  entityMapCache = { fetchedAt: Date.now(), map };
  return map;
}

// The entity IDs that actually have rows in energy_delta, for the
// pv_available and battery_available flags.
async function counterEntitiesWithData(ids) {
  if (ids.length === 0) {
    return new Set();
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT entity_id
       FROM energy_delta
      WHERE entity_id = ANY($1::smallint[])`,
    [ids]
  );
  return new Set(rows.map((row) => row.entity_id));
}

// Range metrics from the verified energy_delta counters: sum(delta_kwh)
// per entity within the range, bucketed per hour so cost can join the
// price table. Hours without a price row count toward kWh but not toward
// cost. Total usage subtracts the energy stored in the battery; the
// battery net term is clamped at zero only when both battery entities are
// missing, otherwise the true net is used (it may be negative on
// discharge-heavy days).
export async function getRangeMetrics(startMs, endMs) {
  const map = await resolveEntityMap();
  const metrics = {
    import_kwh: 0,
    export_kwh: 0,
    pv_kwh: null,
    total_usage_kwh: 0,
    cost_eur: 0,
    battery_charged_kwh: null,
    battery_discharged_kwh: null,
  };
  const ids = Object.values(map).filter((id) => Number.isFinite(id));
  if (ids.length === 0) {
    return metrics;
  }
  const { rows } = await pool.query(
    `SELECT time_bucket('1 hour', ts) AS bucket, entity_id, sum(delta_kwh) AS kwh
       FROM energy_delta
      WHERE entity_id = ANY($1::smallint[])
        AND ts >= $2::timestamptz AND ts < $3::timestamptz
      GROUP BY bucket, entity_id`,
    [ids, new Date(startMs), new Date(endMs)]
  );
  const importByHour = new Map(); // bucket start (ms) -> kWh
  let importKwh = 0;
  let exportKwh = 0;
  let pvKwh = 0;
  let chargedKwh = 0;
  let dischargedKwh = 0;
  for (const row of rows) {
    const kwh = row.kwh ?? 0;
    if (map.import !== null && row.entity_id === map.import) {
      importKwh += kwh;
      importByHour.set(
        row.bucket.getTime(),
        (importByHour.get(row.bucket.getTime()) ?? 0) + kwh
      );
    } else if (map.export !== null && row.entity_id === map.export) {
      exportKwh += kwh;
    } else if (map.pv !== null && row.entity_id === map.pv) {
      pvKwh += kwh;
    } else if (
      map.batteryCharging !== null &&
      row.entity_id === map.batteryCharging
    ) {
      chargedKwh += kwh;
    } else if (
      map.batteryDischarging !== null &&
      row.entity_id === map.batteryDischarging
    ) {
      dischargedKwh += kwh;
    }
  }
  const prices = await dbHourlyPrices(startMs, endMs);
  for (const price of prices) {
    if (price.price_eur === null) {
      continue;
    }
    const hourKwh = importByHour.get(price.ts.getTime());
    if (hourKwh !== undefined) {
      metrics.cost_eur += hourKwh * price.price_eur;
    }
  }
  metrics.import_kwh = round2(importKwh);
  metrics.export_kwh = round2(exportKwh);
  if (map.pv !== null) {
    metrics.pv_kwh = round2(pvKwh);
    const bothBatteryMissing =
      map.batteryCharging === null && map.batteryDischarging === null;
    const batteryNet = bothBatteryMissing ? 0 : chargedKwh - dischargedKwh;
    if (map.batteryCharging !== null) {
      metrics.battery_charged_kwh = round2(chargedKwh);
    }
    if (map.batteryDischarging !== null) {
      metrics.battery_discharged_kwh = round2(dischargedKwh);
    }
    // Household consumption including self-consumed solar, minus energy
    // stored in the battery; noise cannot push it below zero.
    metrics.total_usage_kwh = round2(
      Math.max(0, importKwh + pvKwh - exportKwh - batteryNet)
    );
  } else {
    // No PV entity: total usage falls back to grid import.
    metrics.total_usage_kwh = metrics.import_kwh;
  }
  metrics.cost_eur = round2(metrics.cost_eur);
  return metrics;
}

let summaryCache = null; // { fetchedAt, data }
const SUMMARY_CACHE_MS = 5 * 60 * 1000;

// Dashboard summary for today (local midnight to now), this week (Monday
// 00:00 to now) and this month (first day of month 00:00 to now), all in
// Europe/Amsterdam local time, cached for 5 minutes. Ranges cover
// available data only. The availability flags reflect whether the counter
// entities have rows in energy_delta.
export async function getSummary() {
  if (summaryCache && Date.now() - summaryCache.fetchedAt < SUMMARY_CACHE_MS) {
    return summaryCache.data;
  }
  const map = await resolveEntityMap();
  const now = new Date();
  const endMs = now.getTime();
  const todayKey = localDateKey(now);
  const [today, week, month, dataEntities] = await Promise.all([
    getRangeMetrics(localDayStartUtcMs(todayKey), endMs),
    getRangeMetrics(localDayStartUtcMs(mondayDateKey(now)), endMs),
    getRangeMetrics(localDayStartUtcMs(`${todayKey.slice(0, 7)}-01`), endMs),
    counterEntitiesWithData(Object.values(map).filter((id) => Number.isFinite(id))),
  ]);
  const data = {
    today,
    week,
    month,
    pv_available: map.pv !== null && dataEntities.has(map.pv),
    battery_available:
      map.batteryCharging !== null &&
      map.batteryDischarging !== null &&
      dataEntities.has(map.batteryCharging) &&
      dataEntities.has(map.batteryDischarging),
  };
  summaryCache = { fetchedAt: Date.now(), data };
  return data;
}
