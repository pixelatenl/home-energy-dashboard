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
import { getGridScore } from "./gridscore.mjs";
import { haGetState } from "./ha.mjs";
import {
  localDateKey,
  localHourIndex,
  localHourKey,
  localIsoWithOffset,
  localDayStartUtcMs,
  mondayDateKey,
  nextDateKey,
  resolvedTimezone,
} from "./time.mjs";

export async function listEntities() {
  const { rows } = await pool.query(
    `SELECT id, ha_entity_id, domain, unit, is_counter
       FROM entity
      ORDER BY id`
  );
  return rows;
}

// energy_daily buckets are local calendar days (Europe/Amsterdam):
// each bucket starts at local midnight. The window is the last `days`
// local days before today, so the boundary is the local-midnight
// instant - never a UTC day truncation or a naive date literal, both
// of which would compare as UTC midnight and miss the buckets.
export async function dailyTotals(days) {
  const startMs = localDayStartUtcMs(
    nextDateKey(localDateKey(new Date()), -days)
  );
  const { rows } = await pool.query(
    `SELECT e.id,
            e.ha_entity_id,
            e.domain,
            d.bucket AS day,
            d.kwh
       FROM energy_daily d
       JOIN entity e ON e.id = d.entity_id
      WHERE d.bucket >= $1::timestamptz
      ORDER BY d.bucket, e.id`,
    [new Date(startMs)]
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

// Instantaneous battery sensors in the measurement table, resolved the
// same way.
const BATTERY_MEASUREMENT_ENTITIES = {
  batterySoc: "sensor.anker_solix_solarbank_max_ac_009_soc",
  batteryChargingPower:
    "sensor.anker_solix_solarbank_max_ac_009_battery_charging_power",
  batteryDischargingPower:
    "sensor.anker_solix_solarbank_max_ac_009_battery_discharging_power",
};

// Instantaneous power sensors for the live energy flow diagram.
const FLOW_MEASUREMENT_ENTITIES = {
  pvPower: "sensor.zonneplan_one_optimized_last_measured_value",
  gridImportPower: "sensor.connect_energiemeter_electricity_consumption",
  gridExportPower: "sensor.connect_energiemeter_electricity_production",
  batterySolarInPower:
    "sensor.anker_solix_solarbank_max_ac_009_battery_solar_power",
};

// Live flow fields and the entity role backing each.
const FLOW_FIELDS = {
  pv_w: "pvPower",
  grid_import_w: "gridImportPower",
  grid_export_w: "gridExportPower",
  battery_solar_in_w: "batterySolarInPower",
  battery_charge_w: "batteryChargingPower",
  battery_discharge_w: "batteryDischargingPower",
};

// Roles backed by energy_delta rows.
const COUNTER_ROLES = [
  "import",
  "export",
  "pv",
  "batteryCharging",
  "batteryDischarging",
];

const ROLE_NAMES = {
  ...COUNTER_ENTITIES,
  ...BATTERY_MEASUREMENT_ENTITIES,
  ...FLOW_MEASUREMENT_ENTITIES,
};

let entityMapCache = null; // { fetchedAt, map }
const ENTITY_MAP_TTL_MS = 10 * 60 * 1000;

// Maps the counter and battery roles to entity IDs by ha_entity_id.
async function resolveEntityMap() {
  if (entityMapCache && Date.now() - entityMapCache.fetchedAt < ENTITY_MAP_TTL_MS) {
    return entityMapCache.map;
  }
  const { rows } = await pool.query(
    `SELECT id, ha_entity_id
       FROM entity
      WHERE ha_entity_id = ANY($1::text[])`,
    [Object.values(ROLE_NAMES)]
  );
  const idByName = new Map(rows.map((row) => [row.ha_entity_id, row.id]));
  const map = {};
  for (const [role, name] of Object.entries(ROLE_NAMES)) {
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

// Hourly-priced grid figures: the import energy and the export
// energy in each priced hour, each times that hour's price. Hours
// without a price row count toward kWh but not toward cost or
// credit. Pure: hour maps (bucket start ms -> kWh) and price rows in,
// import cost and export credit out.
export function pricedGridFigures(importByHour, exportByHour, priceRows) {
  let importCost = 0;
  let exportCredit = 0;
  for (const price of priceRows) {
    if (price.price_eur === null) {
      continue;
    }
    const hour = price.ts.getTime();
    importCost += (importByHour.get(hour) ?? 0) * Number(price.price_eur);
    exportCredit += (exportByHour.get(hour) ?? 0) * Number(price.price_eur);
  }
  return { importCost, exportCredit };
}

// Range metrics from the verified energy_delta counters: sum(delta_kwh)
// per entity within the range, bucketed per hour so cost can join the
// price table. Hours without a price row count toward kWh but not
// toward cost. The hourly-priced figures cover both grid directions:
// import cost (cost_eur) and export credit (export_credit_eur).
// Total home consumption (docs/spec.md section 1) is the explicit
// five-counter form: grid import + PV yield + battery discharge -
// grid export - battery charge. The charge term is a sink (energy
// leaving the home circuit into the battery is not consumption);
// battery discharge to the grid nets out against grid export. The two
// battery terms are zeroed only when both battery entities are
// missing; with either present the true values are used.
export async function getRangeMetrics(startMs, endMs) {
  const map = await resolveEntityMap();
  const metrics = {
    import_kwh: 0,
    export_kwh: 0,
    pv_kwh: null,
    self_consumption_pct: null,
    total_usage_kwh: 0,
    cost_eur: 0,
    export_credit_eur: 0,
    battery_charged_kwh: null,
    battery_discharged_kwh: null,
  };
  const ids = COUNTER_ROLES.map((role) => map[role]).filter((id) =>
    Number.isFinite(id)
  );
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
  const exportByHour = new Map(); // bucket start (ms) -> kWh
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
      exportByHour.set(
        row.bucket.getTime(),
        (exportByHour.get(row.bucket.getTime()) ?? 0) + kwh
      );
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
  const priced = pricedGridFigures(importByHour, exportByHour, prices);
  metrics.cost_eur = priced.importCost;
  metrics.export_credit_eur = priced.exportCredit;
  metrics.import_kwh = round2(importKwh);
  metrics.export_kwh = round2(exportKwh);
  if (map.pv !== null) {
    metrics.pv_kwh = round2(pvKwh);
    // Share of the range's production used on site: what was neither
    // exported. Null while production is zero (e.g. before sunrise).
    if (pvKwh > 0) {
      metrics.self_consumption_pct =
        Math.round(((pvKwh - exportKwh) / pvKwh) * 1000) / 10;
    }
    const bothBatteryMissing =
      map.batteryCharging === null && map.batteryDischarging === null;
    // The two battery terms of the consumption formula, each zeroed
    // only when both battery entities are missing (a lone counter
    // keeps its true value).
    const batteryCharge = bothBatteryMissing ? 0 : chargedKwh;
    const batteryDischarge = bothBatteryMissing ? 0 : dischargedKwh;
    if (map.batteryCharging !== null) {
      metrics.battery_charged_kwh = round2(chargedKwh);
    }
    if (map.batteryDischarging !== null) {
      metrics.battery_discharged_kwh = round2(dischargedKwh);
    }
    // Total home consumption: grid import + PV yield + battery
    // discharge - grid export - battery charge. Energy that charged
    // the battery is not consumption on the charging day; it counts
    // on the day the battery discharges it. Discharge to the grid
    // nets out against the export term. Noise cannot push it below
    // zero.
    metrics.total_usage_kwh = round2(
      Math.max(
        0,
        importKwh + pvKwh + batteryDischarge - exportKwh - batteryCharge
      )
    );
  } else {
    // No PV entity: total usage falls back to grid import.
    metrics.total_usage_kwh = metrics.import_kwh;
  }
  metrics.cost_eur = round2(metrics.cost_eur);
  metrics.export_credit_eur = round2(metrics.export_credit_eur);
  return metrics;
}

// --- Solar forecast accuracy and persistence ---

// Actual PV production so far today, from the same aggregation the summary
// uses for its pv-today figure: the PV energy counter's energy_delta sum
// within the local-day window. Null before any production today.
export async function getPvTodayKwh() {
  const map = await resolveEntityMap();
  if (map.pv === null) {
    return null;
  }
  const startMs = localDayStartUtcMs(localDateKey(new Date()));
  const { rows } = await pool.query(
    `SELECT sum(delta_kwh) AS kwh
       FROM energy_delta
      WHERE entity_id = $1
        AND ts >= $2::timestamptz
        AND ts < $3::timestamptz`,
    [map.pv, new Date(startMs), new Date()]
  );
  const kwh = rows[0]?.kwh;
  return kwh === null || kwh === undefined ? null : round2(kwh);
}

// The solar_forecast_daily table accumulates one forecast value per date so
// the future solar page can compare forecasts against actual yields;
// actual production for any date is already recoverable from energy_delta.
// Created on first use.
let solarForecastTableReady = null;
function ensureSolarForecastTable() {
  if (solarForecastTableReady === null) {
    solarForecastTableReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS solar_forecast_daily (
           date date PRIMARY KEY,
           forecast_kwh double precision NOT NULL,
           created_at timestamptz NOT NULL DEFAULT now(),
           updated_at timestamptz NOT NULL DEFAULT now()
         )`
      )
      .then(() => {});
  }
  return solarForecastTableReady;
}

// One row per date, append-only per date with an updated_at column: the
// forecast value is refreshed whenever it changes, never deleted.
export async function upsertSolarForecastDaily(dateKey, forecastKwh) {
  await ensureSolarForecastTable();
  await pool.query(
    `INSERT INTO solar_forecast_daily (date, forecast_kwh)
     VALUES ($1, $2)
     ON CONFLICT (date) DO UPDATE
       SET forecast_kwh = EXCLUDED.forecast_kwh,
           updated_at = now()`,
    [dateKey, forecastKwh]
  );
}

// --- Time diagnostics for the API debug panel ---

// Everything needed to compare the server clock, the timezone it runs in
// and the local Amsterdam buckets it computes, against raw stored rows.
// Stored timestamps stay UTC; only the local_* fields convert.
export async function getDebugTimeData() {
  const now = new Date();
  const currentHourStartMs =
    localDayStartUtcMs(localDateKey(now)) + localHourIndex(now) * 3_600_000;
  const [measurementRows, deltaRows, priceRows] = await Promise.all([
    pool
      .query(
        `SELECT m.entity_id, e.ha_entity_id, m.ts, m.value, m.state
           FROM measurement m
           JOIN entity e ON e.id = m.entity_id
          ORDER BY m.ts DESC
          LIMIT 1`
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT d.entity_id, e.ha_entity_id, d.ts, d.delta_kwh
           FROM energy_delta d
           JOIN entity e ON e.id = d.entity_id
          ORDER BY d.ts DESC
          LIMIT 1`
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT ts, price_eur
           FROM price
          WHERE ts <= $1::timestamptz
          ORDER BY ts DESC
          LIMIT 1`,
        [now]
      )
      .catch(() => ({ rows: [] })),
  ]);
  return {
    // Server now, in UTC and with the Amsterdam offset, plus the timezone
    // the process resolved to and the raw TZ variable if set.
    server_now_utc: now.toISOString(),
    server_now_local: localIsoWithOffset(now),
    tz_env: process.env.TZ ?? null,
    resolved_timezone: resolvedTimezone(),
    // The local date and hour the server currently computes.
    local_date: localDateKey(now),
    local_hour: localHourKey(now),
    current_hour_start_utc: new Date(currentHourStartMs).toISOString(),
    // The price row the server considers current right now.
    current_price_row: priceRows.rows[0] ?? null,
    // One raw row per fact table, for comparing stored and displayed time.
    latest_measurement: measurementRows.rows[0] ?? null,
    latest_energy_delta: deltaRows.rows[0] ?? null,
  };
}

// Battery snapshot: the latest SOC percent, the net power (latest charging
// power minus latest discharging power, valid only while both rows are
// less than an hour old), the age of the most recent power row, today's
// hourly charge/discharge flow, and today's SOC series.
async function getBatterySnapshot(map, startMs, endMs) {
  const snapshot = {
    socPct: null,
    powerW: null,
    powerAgeMin: null,
    flowHourly: [],
    socSeries: [],
  };
  try {
    if (map.batterySoc !== null) {
      const { rows } = await pool.query(
        `SELECT value
           FROM measurement
          WHERE entity_id = $1
          ORDER BY ts DESC LIMIT 1`,
        [map.batterySoc]
      );
      if (rows.length > 0) {
        snapshot.socPct = Math.round(rows[0].value);
      }
    }
    // Latest row of each power series, with its age.
    const powerIds = [map.batteryChargingPower, map.batteryDischargingPower]
      .filter((id) => Number.isFinite(id))
      .filter((id) => id !== null);
    if (powerIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (entity_id) entity_id, ts, value
           FROM measurement
          WHERE entity_id = ANY($1::smallint[])
          ORDER BY entity_id, ts DESC`,
        [powerIds]
      );
      const latest = new Map(rows.map((row) => [row.entity_id, row]));
      const charging = latest.get(map.batteryChargingPower) ?? null;
      const discharging = latest.get(map.batteryDischargingPower) ?? null;
      const newestTs = Math.max(
        charging?.ts.getTime() ?? -Infinity,
        discharging?.ts.getTime() ?? -Infinity
      );
      if (newestTs !== -Infinity) {
        snapshot.powerAgeMin = Math.round((Date.now() - newestTs) / 60_000);
      }
      // Net power: latest charging power minus latest discharging power.
      // A series whose latest row is more than an hour old reads as 0 W:
      // the sensors stop updating around zero load, so a stale series is an
      // idle one - a fresh reading on the other series still counts.
      const isFresh = (row) =>
        row !== null && Date.now() - row.ts.getTime() <= 60 * 60 * 1000;
      const chargingW = isFresh(charging) ? charging.value : 0;
      const dischargingW = isFresh(discharging) ? discharging.value : 0;
      snapshot.powerW = Math.round(chargingW - dischargingW);
    }
    // Today's hourly charge/discharge flow from the energy counters; hours
    // without rows are omitted.
    const flowIds = [map.batteryCharging, map.batteryDischarging]
      .filter((id) => Number.isFinite(id))
      .filter((id) => id !== null);
    if (flowIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT time_bucket('1 hour', ts) AS bucket, entity_id, sum(delta_kwh) AS kwh
           FROM energy_delta
          WHERE entity_id = ANY($1::smallint[])
            AND ts >= $2::timestamptz AND ts < $3::timestamptz
          GROUP BY bucket, entity_id`,
        [flowIds, new Date(startMs), new Date(endMs)]
      );
      const byHour = new Map(); // bucket start (ms) -> entry
      for (const row of rows) {
        const key = row.bucket.getTime();
        const entry =
          byHour.get(key) ??
          { ts: row.bucket.toISOString(), in_kwh: 0, out_kwh: 0 };
        if (map.batteryCharging !== null && row.entity_id === map.batteryCharging) {
          entry.in_kwh += row.kwh ?? 0;
        } else if (
          map.batteryDischarging !== null &&
          row.entity_id === map.batteryDischarging
        ) {
          entry.out_kwh += row.kwh ?? 0;
        }
        byHour.set(key, entry);
      }
      snapshot.flowHourly = [...byHour.values()]
        .map((entry) => ({
          ts: entry.ts,
          in_kwh: Math.round(entry.in_kwh * 1000) / 1000,
          out_kwh: Math.round(entry.out_kwh * 1000) / 1000,
        }))
        .sort((a, b) => a.ts.localeCompare(b.ts));
    }
    // Today's SOC series.
    if (map.batterySoc !== null) {
      const { rows } = await pool.query(
        `SELECT ts, value
           FROM measurement
          WHERE entity_id = $1
            AND ts >= $2::timestamptz AND ts < $3::timestamptz
          ORDER BY ts ASC`,
        [map.batterySoc, new Date(startMs), new Date(endMs)]
      );
      snapshot.socSeries = rows.map((row) => ({
        ts: row.ts.toISOString(),
        soc_pct: Math.round(row.value),
      }));
    }
  } catch {
    // Keep nulls; the summary still serves without the snapshot.
  }
  return snapshot;
}

// Today's hourly PV production for the live hero's compact solar chart:
// one bucket per hour with PV energy_delta sum in the local-day window,
// mirroring the battery snapshot's flowHourly.
async function getPvFlowHourly(map, startMs, endMs) {
  if (map.pv === null) {
    return [];
  }
  const { rows } = await pool.query(
    `SELECT time_bucket('1 hour', ts) AS bucket, sum(delta_kwh) AS kwh
       FROM energy_delta
      WHERE entity_id = $1
        AND ts >= $2::timestamptz AND ts < $3::timestamptz
      GROUP BY bucket
      ORDER BY bucket`,
    [map.pv, new Date(startMs), new Date(endMs)]
  );
  return rows.map((row) => ({
    ts: row.bucket.toISOString(),
    kwh: Math.round(row.kwh * 1000) / 1000,
  }));
}

// Live energy flow: the latest value of each power series in the
// measurement table, only while its most recent row is less than one hour
// old; otherwise null.
async function getFlowSnapshot(map) {
  const flow = {
    pv_w: null,
    grid_import_w: null,
    grid_export_w: null,
    battery_solar_in_w: null,
    battery_charge_w: null,
    battery_discharge_w: null,
  };
  const roleByField = Object.fromEntries(
    Object.entries(FLOW_FIELDS).map(([field, role]) => [field, map[role]])
  );
  const ids = Object.values(roleByField).filter(
    (id) => Number.isFinite(id) && id !== null
  );
  if (ids.length === 0) {
    return flow;
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (entity_id) entity_id, ts, value
       FROM measurement
      WHERE entity_id = ANY($1::smallint[])
      ORDER BY entity_id, ts DESC`,
    [ids]
  );
  const latest = new Map(rows.map((row) => [row.entity_id, row]));
  const isFresh = (row) =>
    row !== undefined && Date.now() - row.ts.getTime() <= 60 * 60 * 1000;
  for (const [field, id] of Object.entries(roleByField)) {
    const row = id !== null ? latest.get(id) : undefined;
    flow[field] = row !== undefined && isFresh(row) ? Math.round(row.value) : null;
  }
  return flow;
}

// Battery state from net power with a 25 W deadband. Stale or absent power
// readings read as idle (the sensors stop updating around zero load);
// 'unavailable' when the battery entities have no data.
function batteryStateFromPower(available, powerW) {
  if (!available) {
    return "unavailable";
  }
  if (powerW === null || Math.abs(powerW) <= 25) {
    return "idle";
  }
  return powerW > 25 ? "charging" : "discharging";
}

// The current grid CO2 intensity (g/kWh) from Electricity Maps, fetched
// live from Home Assistant through the shared haGetState pattern so the
// decision insight can weigh green hours alongside cheap hours. Null
// whenever the entity is unreachable or its state is not a number.
const DEFAULT_CO2_ENTITY = "sensor.electricity_maps_co2_intensity";

export async function getCo2Intensity() {
  const state = await haGetState(
    process.env.EMS_CO2_ENTITY ?? DEFAULT_CO2_ENTITY
  );
  if (state === null) {
    return null;
  }
  const value = Number.parseFloat(state.state);
  return Number.isFinite(value) ? Math.round(value) : null;
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
  const counterIds = COUNTER_ROLES.map((role) => map[role]).filter((id) =>
    Number.isFinite(id)
  );
  const now = new Date();
  const endMs = now.getTime();
  const todayKey = localDateKey(now);
  const todayStartMs = localDayStartUtcMs(todayKey);
  const [today, week, month, dataEntities, battery, flow, gridScore, pvFlow] =
    await Promise.all([
      getRangeMetrics(todayStartMs, endMs),
      getRangeMetrics(localDayStartUtcMs(mondayDateKey(now)), endMs),
      getRangeMetrics(localDayStartUtcMs(`${todayKey.slice(0, 7)}-01`), endMs),
      counterEntitiesWithData(counterIds),
      getBatterySnapshot(map, todayStartMs, endMs),
      getFlowSnapshot(map),
      getGridScore(),
      getPvFlowHourly(map, todayStartMs, endMs),
    ]);
  const batteryAvailable =
    map.batteryCharging !== null &&
    map.batteryDischarging !== null &&
    dataEntities.has(map.batteryCharging) &&
    dataEntities.has(map.batteryDischarging);
  const data = {
    today,
    week,
    month,
    pv_available: map.pv !== null && dataEntities.has(map.pv),
    battery_available: batteryAvailable,
    battery_soc_pct: battery.socPct,
    battery_power_w: battery.powerW,
    battery_power_age_min: battery.powerAgeMin,
    battery_state: batteryStateFromPower(batteryAvailable, battery.powerW),
    battery_flow_hourly: battery.flowHourly,
    battery_soc_series: battery.socSeries,
    flow,
    grid_score: gridScore,
    pv_flow_hourly: pvFlow,
  };
  // Capacity-based estimates, only when the capacity is configured and the
  // battery is charging or discharging above the 25 W deadband; rounded to
  // the nearest 5 minutes.
  const capacityKwh = Number.parseFloat(
    process.env.BATTERY_CAPACITY_KWH ?? ""
  );
  const capacitySet = Number.isFinite(capacityKwh) && capacityKwh > 0;
  if (capacitySet && battery.socPct !== null && battery.powerW !== null) {
    if (battery.powerW > 25) {
      const minutes =
        (((100 - battery.socPct) / 100) * capacityKwh * 60) /
        (battery.powerW / 1000);
      data.battery_full_in_min = Math.round(minutes / 5) * 5;
    } else if (battery.powerW < -25) {
      const minutes =
        ((battery.socPct / 100) * capacityKwh * 60) /
        (-battery.powerW / 1000);
      data.battery_empty_in_min = Math.round(minutes / 5) * 5;
    }
  }
  // Timestamp of this summary cache fill; the AI insight reports it as
  // the moment its text is based on.
  data.summary_as_of = new Date().toISOString();
  summaryCache = { fetchedAt: Date.now(), data };
  return data;
}

// --- Appliance disaggregation (smart plugs) ---

// Appliances are the smart plugs the ingest pipeline tags with
// domain = 'plug': per plug one energy counter (is_counter = true, kWh in
// energy_delta) and one power sensor (is_counter = false, W in
// measurement). Only the plug domain is ever queried here; other domains
// must not appear in appliance results.

// Appliance energy totals since a start timestamp, grouped by entity
// name, with the cost at the hourly dynamic price. Hours without a price
// row count toward kWh but not toward cost (the LEFT JOIN nulls the
// product, which sum skips).
// Appliance energy totals since a start timestamp, optionally bounded
// by an exclusive end timestamp (null keeps the open-ended behaviour).
export async function applianceTotals(startMs, endMs = null) {
  const { rows } = await pool.query(
    `SELECT e.name AS appliance,
            sum(d.delta_kwh) AS kwh,
            sum(d.delta_kwh * p.price_eur) AS cost_eur
       FROM energy_delta d
       JOIN entity e ON e.id = d.entity_id
       LEFT JOIN price p ON p.ts = date_trunc('hour', d.ts)
      WHERE e.is_counter = true
        AND e.domain = 'plug'
        AND d.ts >= $1::timestamptz
        AND ($2::timestamptz IS NULL OR d.ts < $2::timestamptz)
      GROUP BY e.name
      ORDER BY e.name`,
    [new Date(startMs), endMs === null ? null : new Date(endMs)]
  );
  return rows;
}

// Hourly kWh per appliance since a start timestamp, for the day views;
// optionally bounded by an exclusive end timestamp.
export async function applianceHourly(startMs, endMs = null) {
  const { rows } = await pool.query(
    `SELECT date_trunc('hour', d.ts) AS hour,
            e.name AS appliance,
            sum(d.delta_kwh) AS kwh
       FROM energy_delta d
       JOIN entity e ON e.id = d.entity_id
      WHERE e.is_counter = true
        AND e.domain = 'plug'
        AND d.ts >= $1::timestamptz
        AND ($2::timestamptz IS NULL OR d.ts < $2::timestamptz)
      GROUP BY date_trunc('hour', d.ts), e.name
      ORDER BY date_trunc('hour', d.ts), e.name`,
    [new Date(startMs), endMs === null ? null : new Date(endMs)]
  );
  return rows;
}

// Latest power sample per appliance from the plug power sensors.
export async function applianceLatestPower() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (e.name)
            e.name AS appliance,
            m.value AS power_w,
            m.ts AS power_ts
       FROM measurement m
       JOIN entity e ON e.id = m.entity_id
      WHERE e.domain = 'plug'
        AND e.is_counter = false
      ORDER BY e.name, m.ts DESC`
  );
  return rows;
}

// ---- Heat zones ----

// First local day with heat zone data; the frontend renders its empty
// state for periods before it. Also part of the /api/heat/zones
// response.
export const HEAT_DATA_START = "2026-10-12";

// Friendly display names for the heat zones, derived from the entity
// suffixes (heat_temperature_<key> paired with heat_setpoint_<key>).
// Zones without a curated name fall back to the suffix with
// underscores as spaces and the first word capitalized.
const HEAT_ZONE_NAMES = {
  badkamer: "Badkamer",
  entree: "Entree",
  kantoor: "Kantoor",
  layne: "Layne",
  maddox: "Maddox",
  master_bedroom: "Master Bedroom",
  reza: "Reza",
  woonkamer: "Woonkamer",
  zolder_voor: "Zolder voor",
};

function heatZoneName(key) {
  const known = HEAT_ZONE_NAMES[key];
  if (known !== undefined) {
    return known;
  }
  return key
    .split("_")
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ");
}

// Heat zone pairs from the entity table: every heat_temperature_<key>
// with a heat_setpoint_<key> counterpart. The heat_temperature_home
// aggregate has no setpoint pair and is excluded.
export async function heatZoneEntities() {
  const { rows } = await pool.query(
    `SELECT id, ha_entity_id FROM entity WHERE domain = 'heat' ORDER BY id`
  );
  const temperatures = new Map();
  const setpoints = new Map();
  for (const row of rows) {
    const temperatureKey = /^sensor\.heat_temperature_(.+)$/.exec(
      row.ha_entity_id
    );
    if (temperatureKey !== null) {
      temperatures.set(temperatureKey[1], row.id);
    }
    const setpointKey = /^sensor\.heat_setpoint_(.+)$/.exec(row.ha_entity_id);
    if (setpointKey !== null) {
      setpoints.set(setpointKey[1], row.id);
    }
  }
  const zones = [];
  for (const [key, temperatureId] of temperatures) {
    if (key === "home") {
      continue;
    }
    zones.push({
      key,
      name: heatZoneName(key),
      temperatureId,
      setpointId: setpoints.get(key) ?? null,
    });
  }
  zones.sort((a, b) => a.key.localeCompare(b.key));
  return zones;
}

// The outdoor temperature entity: the weather-domain sample sensor.
export async function outdoorTemperatureEntity() {
  const { rows } = await pool.query(
    `SELECT id FROM entity
      WHERE domain = 'weather' AND is_counter = false
      ORDER BY id LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

// Stored temperature/setpoint samples in [from, to), 5-minute cadence.
export async function heatSamples(entityIds, fromMs, toMs) {
  const { rows } = await pool.query(
    `SELECT m.entity_id, m.ts, m.value
       FROM measurement m
      WHERE m.entity_id = ANY($1::smallint[])
        AND m.ts >= $2::timestamptz
        AND m.ts < $3::timestamptz
      ORDER BY m.entity_id, m.ts`,
    [entityIds, new Date(fromMs), new Date(toMs)]
  );
  return rows;
}

// Hourly averages in [from, to) from the measurement_hourly
// continuous aggregate.
export async function heatSamplesHourly(entityIds, fromMs, toMs) {
  const { rows } = await pool.query(
    `SELECT h.entity_id, h.bucket, h.avg_value
       FROM measurement_hourly h
      WHERE h.entity_id = ANY($1::smallint[])
        AND h.bucket >= $2::timestamptz
        AND h.bucket < $3::timestamptz
      ORDER BY h.entity_id, h.bucket`,
    [entityIds, new Date(fromMs), new Date(toMs)]
  );
  return rows;
}

// One zone series point per stored temperature sample; the setpoint is
// the latest setpoint sample at or before it, forward-filled so the
// sparse setpoint stream pairs with the denser temperature stream.
function mergeZoneSamples(tempRows, setpointRows) {
  const points = [];
  let index = 0;
  let setpoint = null;
  for (const row of tempRows) {
    while (index < setpointRows.length && setpointRows[index].ts <= row.ts) {
      setpoint = Number(setpointRows[index].value);
      index += 1;
    }
    points.push({
      ts: row.ts.toISOString(),
      temp: Number(row.value),
      setpoint,
    });
  }
  return points;
}

// Hourly zone series: bucket-aligned averages from the continuous
// aggregate, with the setpoint average of the same bucket.
function mergeZoneHourly(tempRows, setpointRows) {
  const setpoints = new Map(
    setpointRows.map((row) => [row.bucket.getTime(), Number(row.avg_value)])
  );
  return tempRows.map((row) => ({
    ts: row.bucket.toISOString(),
    temp: Number(row.avg_value),
    setpoint: setpoints.get(row.bucket.getTime()) ?? null,
  }));
}

// Heating intervals for one zone: a maximal run of consecutive series
// points where the temperature sits below the setpoint minus the
// hysteresis becomes one interval. This is an inference from the
// setpoint gap, not measured heat demand.
function heatingIntervals(series, hysteresis) {
  const intervals = [];
  let from = null;
  let to = null;
  for (const point of series) {
    const heating =
      point.setpoint !== null && point.temp < point.setpoint - hysteresis;
    if (heating) {
      if (from === null) {
        from = point.ts;
      }
      to = point.ts;
    } else if (from !== null) {
      intervals.push({ from, to });
      from = null;
    }
  }
  if (from !== null) {
    intervals.push({ from, to });
  }
  return intervals;
}

// The zone-versus-setpoint hysteresis in degrees Celsius from
// EMS_HEAT_HYSTERESIS (default 0; unset, empty or invalid values
// behave as 0). Shared by the heat zones endpoint and the heating
// activity proxy behind the usage breakdown's heat pump estimate.
function heatHysteresisDegrees() {
  const raw = process.env.EMS_HEAT_HYSTERESIS;
  const parsed = raw === undefined || raw === "" ? 0 : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

// GET /api/heat/zones data: per-zone temperature/setpoint series and
// heating intervals, plus the outdoor temperature series. resolution
// "raw" returns the stored 5-minute samples, "hourly" the continuous
// aggregate averages. Periods entirely before HEAT_DATA_START return
// empty series and intervals rather than an error. The hysteresis in
// degrees Celsius comes from EMS_HEAT_HYSTERESIS (default 0; unset,
// empty or invalid values behave as 0). Missing parts degrade softly:
// a zone without a setpoint entity keeps its temperature series with
// null setpoints, a missing outdoor entity yields an empty series.
export async function getHeatZones(fromMs, toMs, resolution) {
  const zones = await heatZoneEntities();
  if (localDateKey(new Date(toMs - 1)) < HEAT_DATA_START) {
    return {
      zones: zones.map((zone) => ({
        key: zone.key,
        name: zone.name,
        series: [],
        heatingIntervals: [],
      })),
      outdoor: { series: [] },
    };
  }

  const hysteresis = heatHysteresisDegrees();

  const outdoorId = await outdoorTemperatureEntity();
  const allIds = [
    ...zones.map((zone) => zone.temperatureId),
    ...zones
      .map((zone) => zone.setpointId)
      .filter((id) => id !== null),
  ];
  if (outdoorId !== null) {
    allIds.push(outdoorId);
  }

  const rows =
    resolution === "hourly"
      ? await heatSamplesHourly(allIds, fromMs, toMs)
      : await heatSamples(allIds, fromMs, toMs);
  const byEntity = new Map();
  for (const row of rows) {
    const list = byEntity.get(row.entity_id) ?? [];
    list.push(row);
    byEntity.set(row.entity_id, list);
  }

  const zoneResults = zones.map((zone) => {
    const tempRows = byEntity.get(zone.temperatureId) ?? [];
    const setpointRows =
      zone.setpointId !== null ? byEntity.get(zone.setpointId) ?? [] : [];
    const series =
      resolution === "hourly"
        ? mergeZoneHourly(tempRows, setpointRows)
        : mergeZoneSamples(tempRows, setpointRows);
    return {
      key: zone.key,
      name: zone.name,
      series,
      heatingIntervals: heatingIntervals(series, hysteresis),
    };
  });

  const outdoorRows = outdoorId !== null ? byEntity.get(outdoorId) ?? [] : [];
  const outdoorSeries = outdoorRows.map((row) => ({
    ts: resolution === "hourly" ? row.bucket.toISOString() : row.ts.toISOString(),
    temp: Number(resolution === "hourly" ? row.avg_value : row.value),
  }));

  return { zones: zoneResults, outdoor: { series: outdoorSeries } };
}

// ---- Gas usage and cost ----

// First local day with gas data; earlier periods return the empty
// series rather than an error.
export const GAS_DATA_START = "2026-10-12";

// The gas counter entities (domain 'gas'). Their energy_delta values
// are cubic metres, even though the shared delta column is named
// delta_kwh for the electricity entities.
export async function gasCounterEntityIds() {
  const { rows } = await pool.query(
    `SELECT id FROM entity WHERE domain = 'gas' AND is_counter = true ORDER BY id`
  );
  return rows.map((row) => row.id);
}

// Gas prices, one row per day, ordered by day up to and including
// endDay. Days without their own row fall back to the most recent
// earlier one at lookup time. Cast to text so the comparison works on
// the plain YYYY-MM-DD day, without timezone parsing.
export async function gasPrices(endDay) {
  const { rows } = await pool.query(
    `SELECT day::text AS day, price_eur_per_m3
       FROM gas_price
      WHERE day <= $1::date
      ORDER BY day`,
    [endDay]
  );
  return rows;
}

// Hourly gas deltas in [from, to) from the energy_hourly continuous
// aggregate. The kwh column holds m3 for gas entities.
export async function gasHourly(entityIds, fromMs, toMs) {
  const { rows } = await pool.query(
    `SELECT h.bucket, h.kwh
       FROM energy_hourly h
      WHERE h.entity_id = ANY($1::smallint[])
        AND h.bucket >= $2::timestamptz
        AND h.bucket < $3::timestamptz
      ORDER BY h.bucket`,
    [entityIds, new Date(fromMs), new Date(toMs)]
  );
  return rows;
}

// Daily gas deltas in [from, to) from the energy_daily continuous
// aggregate; the kwh column holds m3 for gas entities.
export async function gasDaily(entityIds, fromMs, toMs) {
  const { rows } = await pool.query(
    `SELECT h.bucket, h.kwh
       FROM energy_daily h
      WHERE h.entity_id = ANY($1::smallint[])
        AND h.bucket >= $2::timestamptz
        AND h.bucket < $3::timestamptz
      ORDER BY h.bucket`,
    [entityIds, new Date(fromMs), new Date(toMs)]
  );
  return rows;
}

// Month intervals for the year granularity, priced bottom-up: each
// day's gas volume is costed at that day's last-known price (the last
// gas_price row on or before the day, forward-filled), and the month
// cost is the sum over its days. Months are local calendar months
// (Europe/Amsterdam): a bucket belongs to the month of its local day
// key, and each month interval starts at the local midnight of its
// first day - the same convention as the daily buckets and the period
// windows. The caller derives the month's price_eur_per_m3 as cost /
// volume (null when the volume is zero) and flags unknown price when
// a day with non-zero volume has no known price at all. Days without
// data contribute nothing.
export function gasMonthIntervals(dailyRows, priceRows) {
  const byMonth = new Map();
  let index = 0;
  let price = null;
  const buckets = [...dailyRows].sort(
    (a, b) => a.bucket.getTime() - b.bucket.getTime()
  );
  for (const row of buckets) {
    const bucketMs = row.bucket.getTime();
    const volume = Number(row.kwh); // m3 for the gas counter
    const day = localDateKey(new Date(bucketMs));
    while (index < priceRows.length && priceRows[index].day <= day) {
      price = Number(priceRows[index].price_eur_per_m3);
      index += 1;
    }
    const monthStart = localDayStartUtcMs(`${day.slice(0, 7)}-01`);
    const entry =
      byMonth.get(monthStart) ?? { volume: 0, cost: 0, unknownPrice: false };
    entry.volume += volume;
    if (price === null) {
      if (volume > 0) {
        entry.unknownPrice = true;
      }
    } else {
      entry.cost += volume * price;
    }
    byMonth.set(monthStart, entry);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([monthMs, entry]) => ({
      tsMs: monthMs,
      volume: entry.volume,
      cost: entry.cost,
      unknownPrice: entry.unknownPrice,
    }));
}

// GET /api/heat/gas data: gas consumption per interval with the
// applicable price and cost. granularity "hour" reads energy_hourly,
// "day" energy_daily, "month" rolls energy_daily up per local
// calendar month; all three read the shared delta column whose name
// says kWh but holds m3 for the gas counter.
//
// Pricing: hour and day intervals take the last known gas_price on or
// before the interval's local day (one price query per series,
// forward-filled by day); cost is m3 * price, and null (never 0) only
// when no price row exists at all. Month intervals price bottom-up
// instead: each day's volume is costed at that day's last-known price,
// the month cost is the sum over its days, and the month's price is
// the volume-weighted effective price (cost / volume, null when the
// volume is zero). hasUnknownPrice is true when any hour or day
// interval lacks a known price; for months only when a day with
// non-zero volume does.
export async function getGasUsage(fromMs, toMs, granularity) {
  if (localDateKey(new Date(toMs - 1)) < GAS_DATA_START) {
    return {
      granularity,
      series: [],
      totals: { m3: 0, cost_eur: 0, hasUnknownPrice: false },
    };
  }

  const entityIds = await gasCounterEntityIds();
  const prices = await gasPrices(localDateKey(new Date(toMs - 1)));

  const series = [];
  let totalM3 = 0;
  let totalCost = 0;
  let hasUnknownPrice = false;

  if (granularity === "month") {
    const dailyRows =
      entityIds.length > 0 ? await gasDaily(entityIds, fromMs, toMs) : [];
    for (const month of gasMonthIntervals(dailyRows, prices)) {
      const m3 = Math.round(month.volume * 1000) / 1000;
      const cost = Math.round(month.cost * 100) / 100;
      totalM3 += m3;
      totalCost += cost;
      if (month.unknownPrice) {
        hasUnknownPrice = true;
      }
      series.push({
        ts: new Date(month.tsMs).toISOString(),
        m3,
        price_eur_per_m3:
          month.volume === 0
            ? null
            : Math.round((month.cost / month.volume) * 1_000_000) / 1_000_000,
        cost_eur: cost,
      });
    }
  } else {
    // One interval per bucket; multiple gas counters (none today) would
    // sum into the same bucket.
    const intervals = new Map();
    if (entityIds.length > 0) {
      const rows =
        granularity === "hour"
          ? await gasHourly(entityIds, fromMs, toMs)
          : await gasDaily(entityIds, fromMs, toMs);
      for (const row of rows) {
        const tsMs = row.bucket.getTime();
        intervals.set(tsMs, (intervals.get(tsMs) ?? 0) + Number(row.kwh));
      }
    }
    let index = 0;
    let price = null;
    for (const tsMs of [...intervals.keys()].sort((a, b) => a - b)) {
      const day = localDateKey(new Date(tsMs));
      while (index < prices.length && prices[index].day <= day) {
        price = Number(prices[index].price_eur_per_m3);
        index += 1;
      }
      const m3 = Math.round(intervals.get(tsMs) * 1000) / 1000;
      const cost = price === null ? null : Math.round(m3 * price * 100) / 100;
      if (cost === null) {
        hasUnknownPrice = true;
      } else {
        totalCost += cost;
      }
      totalM3 += m3;
      series.push({
        ts: new Date(tsMs).toISOString(),
        m3,
        price_eur_per_m3: price,
        cost_eur: cost,
      });
    }
  }

  return {
    granularity,
    series,
    totals: {
      m3: Math.round(totalM3 * 1000) / 1000,
      cost_eur: Math.round(totalCost * 100) / 100,
      hasUnknownPrice,
    },
  };
}

// ---- Heating cost model ----

// Env-derived model inputs with physical defaults; unset, empty or
// invalid values fall back to the defaults. The calorific value is
// physically 9.7-10.3 kWh/m3 (default 9.9); the boiler efficiency
// assumes a condensing boiler (default 0.9); the COP anchors define a
// simple outdoor-temperature model.
function heatModelAssumptions() {
  const fromEnv = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === "") {
      return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    gasCalorificKwhPerM3: fromEnv("EMS_GAS_CALORIFIC_KWH_PER_M3", 9.9),
    boilerEfficiency: fromEnv("EMS_BOILER_EFFICIENCY", 0.9),
    copAt7C: fromEnv("EMS_COP_AT_7C", 3.0),
    copAtMinus7C: fromEnv("EMS_COP_AT_MINUS_7C", 2.2),
  };
}

// COP estimate from the average outdoor temperature: linear between
// the two anchors (3.0 at 7 C, 2.2 at -7 C by default), clamped
// outside that range. This is an outdoor-temperature model; no
// measured heat pump data exists yet.
function copEstimate(avgOutdoorTemp, assumptions) {
  const { copAt7C, copAtMinus7C } = assumptions;
  const t = Math.min(7, Math.max(-7, avgOutdoorTemp));
  return copAt7C + ((t - 7) / 14) * (copAtMinus7C - copAt7C);
}

// GET /api/heat/model data: the two heating cost routes for a period.
// The gas route is the cost basis - the last known gas price on or
// before the period's end day divided by (calorific value times
// boiler efficiency). The heat pump route is an estimate: the
// period's average electricity price over a COP estimated from the
// average outdoor temperature. Values the period lacks data for are
// null, never 0. The card that renders this informs; it does not
// advise.
export async function getHeatModel(fromMs, toMs, resolution) {
  const assumptions = heatModelAssumptions();

  // Gas route: the freshest price that applies to the period.
  const endDay = localDateKey(new Date(toMs - 1));
  const prices = await gasPrices(endDay);
  const gasPrice =
    prices.length > 0
      ? Number(prices[prices.length - 1].price_eur_per_m3)
      : null;
  const gasCostPerKwhHeat =
    gasPrice === null
      ? null
      : gasPrice /
        (assumptions.gasCalorificKwhPerM3 * assumptions.boilerEfficiency);

  // Heat pump route: average electricity price over the period's
  // price-table hours.
  const priceRows = await dbHourlyPrices(fromMs, toMs);
  const avgElectricityPrice =
    priceRows.length > 0
      ? priceRows.reduce((sum, row) => sum + Number(row.price_eur), 0) /
        priceRows.length
      : null;

  // Average outdoor temperature: the plain mean over the period's
  // samples (stored 5-minute samples for a day, hourly aggregate
  // averages otherwise).
  const outdoorId = await outdoorTemperatureEntity();
  let avgOutdoorTemp = null;
  if (outdoorId !== null) {
    const rows =
      resolution === "hourly"
        ? await heatSamplesHourly([outdoorId], fromMs, toMs)
        : await heatSamples([outdoorId], fromMs, toMs);
    if (rows.length > 0) {
      avgOutdoorTemp =
        rows.reduce(
          (sum, row) =>
            sum + Number(resolution === "hourly" ? row.avg_value : row.value),
          0
        ) / rows.length;
    }
  }
  const avgCop = avgOutdoorTemp === null ? null : copEstimate(avgOutdoorTemp, assumptions);
  const heatPumpCostPerKwhHeat =
    avgElectricityPrice === null || avgCop === null || avgCop === 0
      ? null
      : avgElectricityPrice / avgCop;

  const round = (value, digits) =>
    value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

  return {
    gas_route: {
      cost_per_kwh_heat: round(gasCostPerKwhHeat, 4),
      price_eur_per_m3: gasPrice,
      calorific_kwh_per_m3: assumptions.gasCalorificKwhPerM3,
      boiler_efficiency: assumptions.boilerEfficiency,
    },
    heat_pump_route: {
      cost_per_kwh_heat: round(heatPumpCostPerKwhHeat, 4),
      avg_electricity_price_eur_per_kwh: round(avgElectricityPrice, 4),
      avg_cop: round(avgCop, 2),
      avg_outdoor_temp: round(avgOutdoorTemp, 1),
    },
    assumptions: {
      gas_calorific_kwh_per_m3: assumptions.gasCalorificKwhPerM3,
      boiler_efficiency: assumptions.boilerEfficiency,
      cop_at_7c: assumptions.copAt7C,
      cop_at_minus_7c: assumptions.copAtMinus7C,
    },
  };
}

// ---- Usage category breakdown ----

// The category registry: measured counter entities mapped to usage
// categories. Extensible for the office plug: adding a category, or
// another entity to a category's list, is the whole change. R1
// resolution: the washing machine maps to the plug counter
// sensor.garage_washing_machine_cumulative_energy; the Samsung
// counters sensor.garage_washer_energy and sensor.garage_washer_power
// measure the same machine and are excluded from the registry, since
// counting them would double count the machine.
export const USAGE_CATEGORIES = [
  {
    key: "dishwasher",
    label: "Dishwasher",
    entities: ["sensor.kitchen_dishwasher_cumulative_energy"],
  },
  {
    key: "dryer",
    label: "Dryer",
    entities: ["sensor.garage_dryer_cumulative_energy"],
  },
  {
    key: "washing_machine",
    label: "Washing machine",
    entities: ["sensor.garage_washing_machine_cumulative_energy"],
  },
];

// The heat pump carries the "Est." class: it is estimated, never
// measured. The remainder bucket is neither; it is what is left.
const HEAT_PUMP_CATEGORY = { key: "heat_pump", label: "Heat pump" };

// The home model: the background devices without their own measured
// counter, estimated per local day (docs/spec.md section 6). Every
// entry's basis note states where its estimate comes from; the UI
// labels every modeled number as a model average. Extensible like
// the category registry. The always-on static draw - the
// refrigerators, the network and standby, the standby share of the
// lighting, and the kitchen devices' standby and keep-hot draw (the
// boiler, the microwave, the coffee machine) - is not a static entry
// here: the data-derived base load (baseLoadForWindow below)
// absorbs it from the day's own quiet-night hours, so no static
// entry double counts it. Those devices' occasional usage bursts
// carry no static entry either: they belong to the unexplained
// remainder.
const HOME_MODEL = [
  {
    key: "lighting",
    name: "Lighting",
    kwhPerDay: 1.1,
    basis: "evening use of the 36 Hue lights; the lights' standby draw is covered by the data-derived base load",
  },
];

// Local calendar days in [fromMs, toMs): the multiplier for the
// per-day model estimates. Steps date keys, so DST transitions count
// a day as one day.
export function windowDays(fromMs, toMs) {
  let day = localDateKey(new Date(fromMs));
  const lastDay = localDateKey(new Date(toMs - 1));
  let count = 0;
  while (day <= lastDay) {
    count += 1;
    day = nextDateKey(day, 1);
  }
  return count;
}

// Local days in [fromMs, toMs) that carry measured data: the model
// scales by the window's data-covered days, not its calendar days,
// so an in-progress month never models a whole month of standby draw
// against a few days of usage. Counted from the always-on grid import
// counter's first and last row in the window, capped at the window's
// own days.
export async function windowDataDays(fromMs, toMs, importId) {
  return (await windowDataDayKeys(fromMs, toMs, importId)).length;
}

// The same covered days as windowDataDays, as the ordered local date
// keys themselves: the base load is computed per covered day, so it
// needs the day set, not just its count.
export async function windowDataDayKeys(fromMs, toMs, importId) {
  if (importId === null) {
    return [];
  }
  const { rows } = await pool.query(
    `SELECT min(d.ts) AS first_ts, max(d.ts) AS last_ts
       FROM energy_delta d
      WHERE d.entity_id = $1::smallint
        AND d.ts >= $2::timestamptz
        AND d.ts < $3::timestamptz`,
    [importId, new Date(fromMs), new Date(toMs)]
  );
  const first = rows[0]?.first_ts ?? null;
  const last = rows[0]?.last_ts ?? null;
  if (first === null || last === null) {
    return [];
  }
  const keys = [];
  let day = localDateKey(new Date(first));
  const lastDay = localDateKey(new Date(Math.min(last.getTime(), toMs - 1)));
  while (day <= lastDay) {
    keys.push(day);
    day = nextDateKey(day, 1);
  }
  return keys.slice(0, windowDays(fromMs, toMs));
}

// The baseload method config (docs/spec.md section 6), every knob
// from the environment with safe defaults; unset, empty or invalid
// values fall back. method "median_low" (default) takes the median
// of the day's lowest lowHours candidate hours; "percentile" takes
// the percentile-th percentile of the candidates. Candidates are
// the quiet nighttime hours (nightStart to nightEnd local, wrapping
// midnight), hours whose battery charge exceeds maxChargeKwh never
// qualify, and a day needs at least minHours candidates at all.
export function baseLoadConfig() {
  const num = (name, fallback, min, max) => {
    const raw = process.env[name];
    if (raw === undefined || raw === "") {
      return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max
      ? parsed
      : fallback;
  };
  const method =
    process.env.EMS_BASELOAD_METHOD === "percentile"
      ? "percentile"
      : "median_low";
  const lowHours = Math.max(
    1,
    Math.round(num("EMS_BASELOAD_LOW_HOURS", 4, 1, 24))
  );
  const percentile = num("EMS_BASELOAD_PERCENTILE", 10, 0, 100);
  const nightStart = Math.round(num("EMS_BASELOAD_NIGHT_START", 22, 0, 23));
  const nightEnd = Math.round(num("EMS_BASELOAD_NIGHT_END", 6, 0, 23));
  const minHours = Math.max(
    1,
    Math.round(num("EMS_BASELOAD_MIN_HOURS", 3, 1, 24))
  );
  const maxChargeKwh = num("EMS_BASELOAD_MAX_CHARGE_KWH", 0.05, 0, 1000);
  const stat =
    method === "percentile"
      ? `the day's ${percentile}th-percentile quiet-hour consumption`
      : `the median of the day's ${lowHours} lowest quiet-hour consumption values`;
  return {
    method,
    lowHours,
    percentile,
    nightStart,
    nightEnd,
    minHours,
    maxChargeKwh,
    basis: `data-derived per day: ${stat}, preferring quiet nighttime hours, guarded against battery-charge buckets and sparse counter cadence`,
  };
}

// The per-day baseload: a robust low statistic of the day's own
// hourly consumption (docs/spec.md section 6). Pure, so the method
// is testable: hour entries per local day in, kWh per day out. The
// quiet nighttime hours are the candidates, widened to the whole
// day when too few survive the charge guard; hours whose battery
// charge exceeds the threshold never qualify (a bursty charge
// bucket lands its whole counter delta in one hour and reads that
// hour's consumption artificially low); a day below minHours
// candidates carries no baseload at all (sparse counter cadence
// must not fabricate one); and the result is capped at the day's
// own total consumption. The per-day figure is the hourly statistic
// times 24 hours, rounded to two decimals so period sums reconcile
// exactly.
export function baseloadKwhPerDay(dayHours, config) {
  const out = new Map();
  for (const [day, hours] of dayHours) {
    if (hours.length === 0) {
      continue;
    }
    const unguarded = hours.filter(
      (entry) => entry.chargeKwh <= config.maxChargeKwh
    );
    const quiet = unguarded.filter(
      (entry) =>
        entry.hour >= config.nightStart || entry.hour < config.nightEnd
    );
    const pool = quiet.length >= config.minHours ? quiet : unguarded;
    if (pool.length < config.minHours) {
      continue;
    }
    const sorted = pool.map((entry) => entry.kwh).sort((a, b) => a - b);
    let stat;
    if (config.method === "percentile") {
      const index = Math.round(
        (config.percentile / 100) * (sorted.length - 1)
      );
      stat = sorted[Math.min(sorted.length - 1, Math.max(0, index))];
    } else {
      const low = sorted.slice(0, Math.min(config.lowHours, sorted.length));
      const mid = Math.floor((low.length - 1) / 2);
      stat = low.length % 2 === 1 ? low[mid] : (low[mid] + low[mid + 1]) / 2;
    }
    const dayTotal = hours.reduce((sum, entry) => sum + entry.kwh, 0);
    const kwh = Math.min(round2(stat * 24), round2(dayTotal));
    if (kwh > 0) {
      out.set(day, kwh);
    }
  }
  return out;
}

// The current, incomplete day's share of its own base load: the
// day's full-day figure times its data-covered hours over 24
// (docs/spec.md section 6.1), so a day view in the morning never
// models a full day of standby draw against a few hours of usage.
// Every other day - past days, or the current day once all 24
// hours carry data - keeps its full-day figure unchanged. Pure, so
// the rule is testable: the per-day figures with their covered
// hour counts in, the prorated figures out.
export function proratedBaseLoad(perDay, coveredHoursByDay, nowMs) {
  const today = localDateKey(new Date(nowMs));
  const figure = perDay.get(today);
  const hours = coveredHoursByDay.get(today);
  if (figure === undefined || hours === undefined || hours >= 24) {
    return perDay;
  }
  const out = new Map(perDay);
  const kwh = round2(figure * (hours / 24));
  if (kwh > 0) {
    out.set(today, kwh);
  } else {
    out.delete(today);
  }
  return out;
}

// The window's per-day baseload from its own measured counters:
// the five-counter consumption formula per hour (the same terms as
// the period total, docs/spec.md section 1, floored at zero per
// hour) fed to baseloadKwhPerDay, restricted to the window's
// data-covered days so the base load never models a day without
// measured data. Returns the per-day map plus the config's basis
// note.
export async function baseLoadForWindow(fromMs, toMs) {
  const config = baseLoadConfig();
  const map = await resolveEntityMap();
  const ids = COUNTER_ROLES.map((role) => map[role]).filter((id) =>
    Number.isFinite(id)
  );
  if (ids.length === 0) {
    return { perDay: new Map(), basis: config.basis };
  }
  const { rows } = await pool.query(
    `SELECT date_trunc('hour', ts) AS hour, entity_id, sum(delta_kwh) AS kwh
       FROM energy_delta
      WHERE entity_id = ANY($1::smallint[])
        AND ts >= $2::timestamptz
        AND ts < $3::timestamptz
      GROUP BY 1, 2`,
    [ids, new Date(fromMs), new Date(toMs)]
  );
  const bothBatteryMissing =
    map.batteryCharging === null && map.batteryDischarging === null;
  const perHour = new Map(); // day key -> Map(local hour -> counter terms)
  for (const row of rows) {
    const ts = new Date(row.hour.getTime());
    const day = localDateKey(ts);
    const hour = localHourIndex(ts);
    let dayMap = perHour.get(day);
    if (dayMap === undefined) {
      dayMap = new Map();
      perHour.set(day, dayMap);
    }
    let terms = dayMap.get(hour);
    if (terms === undefined) {
      terms = { import: 0, export: 0, pv: 0, charge: 0, discharge: 0 };
      dayMap.set(hour, terms);
    }
    const kwh = Number(row.kwh ?? 0);
    if (map.import !== null && row.entity_id === map.import) {
      terms.import += kwh;
    } else if (map.export !== null && row.entity_id === map.export) {
      terms.export += kwh;
    } else if (map.pv !== null && row.entity_id === map.pv) {
      terms.pv += kwh;
    } else if (map.batteryCharging !== null && row.entity_id === map.batteryCharging) {
      terms.charge += kwh;
    } else if (map.batteryDischarging !== null && row.entity_id === map.batteryDischarging) {
      terms.discharge += kwh;
    }
  }
  const dayHours = new Map();
  for (const [day, dayMap] of perHour) {
    dayHours.set(
      day,
      [...dayMap.entries()].map(([hour, terms]) => ({
        hour,
        kwh: Math.max(
          0,
          terms.import +
            terms.pv +
            terms.discharge -
            terms.export -
            (bothBatteryMissing ? 0 : terms.charge)
        ),
        chargeKwh: bothBatteryMissing ? 0 : terms.charge,
      }))
    );
  }
  const covered = new Set(await windowDataDayKeys(fromMs, toMs, map.import));
  const full = baseloadKwhPerDay(dayHours, config);
  for (const day of [...full.keys()]) {
    if (!covered.has(day)) {
      full.delete(day);
    }
  }
  const coveredHours = new Map(
    [...dayHours].map(([day, hours]) => [day, hours.length])
  );
  const perDay = proratedBaseLoad(full, coveredHours, Date.now());
  return { perDay, basis: config.basis };
}

// The model's per-period entries: the data-derived base load first
// (each covered day's own figure, summed), then each static per-day
// estimate times the window's data-covered days, plus the modeled
// sum. Every kWh is exact at two decimals, so the displayed figures
// reconcile exactly with the remainder.
export function homeModelEntries(days, baseLoad = null) {
  const perDay = baseLoad?.perDay ?? new Map();
  const baseKwh = [...perDay.values()].reduce((sum, kwh) => sum + kwh, 0);
  const entries = [
    {
      key: "base_load",
      name: "Base load",
      derived: true,
      kwh_per_day: perDay.size > 0 ? round2(baseKwh / perDay.size) : 0,
      basis: baseLoad?.basis ?? baseLoadConfig().basis,
      kwh: round2(baseKwh),
    },
    ...HOME_MODEL.map((entry) => ({
      key: entry.key,
      name: entry.name,
      kwh_per_day: entry.kwhPerDay,
      basis: entry.basis,
      kwh: round2(entry.kwhPerDay * days),
    })),
  ];
  const modeledKwh = entries.reduce((sum, entry) => sum + entry.kwh, 0);
  return { entries, modeledKwh };
}

// ---- Per-slot chart series ----

// The slot unit for a window (docs/spec.md section 8): hours for a
// single-day window, days up to two months, months beyond. Pure, so
// the granularity rule is testable.
export function slotUnitForDays(days) {
  if (days <= 1) {
    return "hour";
  }
  if (days <= 62) {
    return "day";
  }
  return "month";
}

// The heat pump estimate per heating-active local day: the day's
// heating gas (measured gas minus the day's baseline share) through
// the hybrid model conversion. Day and month slots sum their days;
// hourly slots cannot attribute the daily gas figure, so they carry
// no heat pump entry.
async function heatPumpKwhPerActiveDay(fromMs, toMs) {
  const out = new Map();
  if (localDateKey(new Date(toMs - 1)) < GAS_DATA_START) {
    return out;
  }
  const activeDays = await heatingActiveDays(fromMs, toMs);
  if (activeDays.size === 0) {
    return out;
  }
  const entityIds = await gasCounterEntityIds();
  if (entityIds.length === 0) {
    return out;
  }
  const rows = await gasDaily(entityIds, fromMs, toMs);
  const perDay = new Map();
  for (const row of rows) {
    const day = localDateKey(new Date(row.bucket.getTime()));
    perDay.set(day, (perDay.get(day) ?? 0) + Number(row.kwh));
  }
  const assumptions = heatModelAssumptions();
  const baseline = gasNonHeatingBaselineM3PerMonth();
  for (const [day, volume] of perDay) {
    if (!activeDays.has(day)) {
      continue;
    }
    const gas = Math.max(0, volume - baseline / daysInMonthOf(day));
    if (gas > 0) {
      out.set(day, heatPumpKwhFromHeatingGas(gas, assumptions));
    }
  }
  return out;
}

// The per-slot chart series (docs/spec.md section 8): the window's
// household consumption bucketed per hour, day or month - the same
// five-counter formula as the period total (docs/spec.md section 1),
// computed per slot and floored at zero - with each slot's average
// hourly price and the registry categories' per-slot kWh for the
// tooltip breakdown. Day and month slots carry the heat pump
// estimate with its "Est." class. Every slot of the period is
// emitted, including the ones without data yet: they sit on the axis
// without a bar.
export async function getUsageSlots(fromMs, toMs) {
  const map = await resolveEntityMap();
  const days = windowDays(fromMs, toMs);
  const unit = slotUnitForDays(days);
  const bothBatteryMissing =
    map.batteryCharging === null && map.batteryDischarging === null;

  // The entities: the five grid/PV/battery counters plus the
  // registry's plug counters.
  const ids = [];
  for (const role of COUNTER_ROLES) {
    const id = map[role];
    if (id !== null) {
      ids.push(id);
    }
  }
  const plugRows = await pool.query(
    `SELECT id, ha_entity_id FROM entity WHERE ha_entity_id = ANY($1::text[])`,
    [USAGE_CATEGORIES.flatMap((category) => category.entities)]
  );
  const plugIdToCategory = new Map();
  for (const row of plugRows.rows) {
    for (const category of USAGE_CATEGORIES) {
      if (category.entities.includes(row.ha_entity_id)) {
        plugIdToCategory.set(row.id, category);
      }
    }
  }
  for (const id of plugIdToCategory.keys()) {
    ids.push(id);
  }

  const { rows } =
    ids.length > 0
      ? await pool.query(
          `SELECT date_trunc('hour', ts) AS hour, entity_id, sum(delta_kwh) AS kwh
             FROM energy_delta
            WHERE entity_id = ANY($1::smallint[])
              AND ts >= $2::timestamptz
              AND ts < $3::timestamptz
            GROUP BY 1, 2
            ORDER BY 1`,
          [ids, new Date(fromMs), new Date(toMs)]
        )
      : { rows: [] };

  // Per-hour accumulation, keyed by local slot. Hour slots use
  // "YYYY-MM-DDTHH", day slots the local date key, month slots
  // "YYYY-MM".
  const hours = new Map();
  for (const row of rows) {
    const bucketMs = row.hour.getTime();
    const dateKey = localDateKey(new Date(bucketMs));
    const hourIndex = localHourIndex(new Date(bucketMs));
    const slotKey =
      unit === "hour"
        ? `${dateKey}T${String(hourIndex).padStart(2, "0")}`
        : unit === "day"
          ? dateKey
          : dateKey.slice(0, 7);
    const kwh = Number(row.kwh ?? 0);
    let entry = hours.get(slotKey);
    if (entry === undefined) {
      entry = {
        import: 0,
        export: 0,
        pv: 0,
        charge: 0,
        discharge: 0,
        plugs: new Map(),
      };
      hours.set(slotKey, entry);
    }
    const category = plugIdToCategory.get(row.entity_id);
    if (category !== undefined) {
      entry.plugs.set(
        category.key,
        (entry.plugs.get(category.key) ?? 0) + kwh
      );
      continue;
    }
    if (map.import !== null && row.entity_id === map.import) {
      entry.import += kwh;
    } else if (map.export !== null && row.entity_id === map.export) {
      entry.export += kwh;
    } else if (map.pv !== null && row.entity_id === map.pv) {
      entry.pv += kwh;
    } else if (map.batteryCharging !== null && row.entity_id === map.batteryCharging) {
      entry.charge += kwh;
    } else if (map.batteryDischarging !== null && row.entity_id === map.batteryDischarging) {
      entry.discharge += kwh;
    }
  }

  // The slot keys to emit, in order.
  const startKey = localDateKey(new Date(fromMs));
  const endKey = localDateKey(new Date(toMs - 1));
  const keys = [];
  if (unit === "hour") {
    for (let hour = 0; hour < 24; hour += 1) {
      keys.push(`${startKey}T${String(hour).padStart(2, "0")}`);
    }
  } else if (unit === "day") {
    // Every calendar day of the window: days without data sit on
    // the axis without a bar, so an in-progress month still shows
    // its full span.
    let day = startKey;
    while (day <= endKey) {
      keys.push(day);
      day = nextDateKey(day, 1);
    }
  } else {
    const year = Number(startKey.slice(0, 4));
    for (let month = 1; month <= 12; month += 1) {
      keys.push(`${year}-${String(month).padStart(2, "0")}`);
    }
  }

  // The heat pump estimate per day, for day and month slots.
  const heatPumpPerDay =
    unit === "day" || unit === "month"
      ? await heatPumpKwhPerActiveDay(fromMs, toMs)
      : new Map();

  // Prices per slot: the average of the slot's non-null hourly
  // prices.
  const priceRows = await dbHourlyPrices(fromMs, toMs);
  const priceSums = new Map();
  for (const row of priceRows) {
    if (row.price_eur === null) {
      continue;
    }
    const tsMs = row.ts.getTime();
    const dateKey = localDateKey(new Date(tsMs));
    const slotKey =
      unit === "hour"
        ? `${dateKey}T${String(localHourIndex(new Date(tsMs))).padStart(2, "0")}`
        : unit === "day"
          ? dateKey
          : dateKey.slice(0, 7);
    const entry = priceSums.get(slotKey) ?? { sum: 0, count: 0 };
    entry.sum += Number(row.price_eur);
    entry.count += 1;
    priceSums.set(slotKey, entry);
  }

  const series = keys.map((key) => {
    const entry = hours.get(key);
    const importKwh = entry?.import ?? 0;
    const exportKwh = entry?.export ?? 0;
    const pvKwh = entry?.pv ?? 0;
    const charge = bothBatteryMissing ? 0 : entry?.charge ?? 0;
    const discharge = bothBatteryMissing ? 0 : entry?.discharge ?? 0;
    const kwh = Math.max(
      0,
      importKwh + pvKwh + discharge - exportKwh - charge
    );
    const price = priceSums.get(key);
    const avgPrice = price === undefined ? null : price.sum / price.count;
    const categories = [];
    if (entry !== undefined) {
      for (const category of USAGE_CATEGORIES) {
        const plugKwh = entry.plugs.get(category.key);
        if (plugKwh !== undefined && round2(plugKwh) > 0) {
          categories.push({
            key: category.key,
            label: category.label,
            kwh: round2(plugKwh),
            class: "measured",
          });
        }
      }
    }
    if (unit !== "hour") {
      const dayKeys =
        unit === "day"
          ? [key]
          : keysOfMonth(key).filter((day) => heatPumpPerDay.has(day));
      const heatPumpKwh = dayKeys.reduce(
        (sum, day) => sum + (heatPumpPerDay.get(day) ?? 0),
        0
      );
      if (heatPumpKwh > 0) {
        categories.push({
          key: "heat_pump",
          label: "Heat pump",
          kwh: round2(heatPumpKwh),
          class: "Est.",
        });
      }
    }
    return {
      ts: slotKeyToIso(key, unit),
      kwh: round2(kwh),
      price_eur: avgPrice === null ? null : Math.round(avgPrice * 10_000) / 10_000,
      cost_eur: avgPrice === null ? null : round2(kwh * avgPrice),
      categories,
    };
  });

  return { unit, series };
}

// The local date keys of one "YYYY-MM" month key.
function keysOfMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const last = daysInMonthOf(`${monthKey}-01`);
  const keys = [];
  for (let day = 1; day <= last; day += 1) {
    keys.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  }
  return keys;
}

// The UTC ISO instant of a slot key's local start, for the frontend's
// labeling.
function slotKeyToIso(key, unit) {
  if (unit === "hour") {
    const dateKey = key.slice(0, 10);
    const hour = Number(key.slice(11, 13));
    return new Date(localDayStartUtcMs(dateKey) + hour * 3_600_000).toISOString();
  }
  if (unit === "day") {
    return new Date(localDayStartUtcMs(key)).toISOString();
  }
  return new Date(localDayStartUtcMs(`${key}-01`)).toISOString();
}

// Days in the calendar month of a "YYYY-MM-DD" key, for prorating the
// monthly non-heating gas baseline to a per-day share.
function daysInMonthOf(dateKey) {
  const [year, month] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The configurable non-heating gas baseline in m3 per month (hot
// water, cooking), subtracted from measured gas before attributing
// heating. EMS_GAS_NON_HEATING_BASELINE_M3_PER_MONTH, default 20;
// unset, empty or invalid values fall back to the default.
export function gasNonHeatingBaselineM3PerMonth() {
  const raw = process.env.EMS_GAS_NON_HEATING_BASELINE_M3_PER_MONTH;
  if (raw === undefined || raw === "") {
    return 20;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20;
}

// The setpoint staleness guard for the heating activity proxy, in
// milliseconds: a forward-filled setpoint stops counting this long
// after its last real sample, so a dead setpoint sensor cannot imply
// endless heating. EMS_HEAT_SETPOINT_STALENESS_HOURS, default 24;
// unset, empty or invalid values fall back to the default.
export function setpointStalenessMs() {
  const raw = process.env.EMS_HEAT_SETPOINT_STALENESS_HOURS;
  if (raw === undefined || raw === "") {
    return 24 * 3_600_000;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed * 3_600_000
    : 24 * 3_600_000;
}

// Heating bucket decisions for one zone from hourly temperature and
// setpoint rows (both sorted by bucket, avg_value never null): the
// sparse setpoint stream is forward-filled onto the temperature
// buckets, the staleness guard expires a forward-filled setpoint that
// outlives stalenessMs since its last real sample, and a bucket is
// heating when the temperature sits below the setpoint minus the
// hysteresis. Returns the local date keys of the heating buckets.
export function heatingBucketDays(
  tempRows,
  setpointRows,
  hysteresis,
  stalenessMs
) {
  const days = [];
  let setpointMs = null;
  let setpointValue = null;
  let setpointIndex = 0;
  for (const temp of tempRows) {
    const tempMs = temp.bucket.getTime();
    while (
      setpointIndex < setpointRows.length &&
      setpointRows[setpointIndex].bucket.getTime() <= tempMs
    ) {
      setpointMs = setpointRows[setpointIndex].bucket.getTime();
      setpointValue = Number(setpointRows[setpointIndex].avg_value);
      setpointIndex += 1;
    }
    if (
      setpointValue !== null &&
      setpointMs !== null &&
      tempMs - setpointMs <= stalenessMs &&
      Number(temp.avg_value) < setpointValue - hysteresis
    ) {
      days.push(localDateKey(new Date(tempMs)));
    }
  }
  return days;
}

// Heating activity per local day across all zones, the activity proxy
// for the heat pump estimate (R1 confirmed no heat demand entity
// exists). A day is heating-active when any zone shows the
// temperature-below-setpoint proxy in any hourly bucket. Periods
// before HEAT_DATA_START have no zone data and yield no days.
export async function heatingActiveDays(fromMs, toMs) {
  const days = new Set();
  if (localDateKey(new Date(toMs - 1)) < HEAT_DATA_START) {
    return days;
  }
  const zones = await heatZoneEntities();
  if (zones.length === 0) {
    return days;
  }
  const ids = [];
  for (const zone of zones) {
    ids.push(zone.temperatureId);
    if (zone.setpointId !== null) {
      ids.push(zone.setpointId);
    }
  }
  const rows = await heatSamplesHourly(ids, fromMs, toMs);
  const byEntity = new Map();
  for (const row of rows) {
    const list = byEntity.get(row.entity_id) ?? [];
    list.push(row);
    byEntity.set(row.entity_id, list);
  }
  const hysteresis = heatHysteresisDegrees();
  const stalenessMs = setpointStalenessMs();
  for (const zone of zones) {
    const tempRows = (byEntity.get(zone.temperatureId) ?? []).filter(
      (row) => row.avg_value !== null
    );
    const setpointRows =
      zone.setpointId !== null
        ? (byEntity.get(zone.setpointId) ?? []).filter(
            (row) => row.avg_value !== null
          )
        : [];
    for (const day of heatingBucketDays(
      tempRows,
      setpointRows,
      hysteresis,
      stalenessMs
    )) {
      days.add(day);
    }
  }
  return days;
}

// Heating gas in m3 from daily gas rows: only heating-active days
// contribute, and each contributes its volume above that day's share
// of the non-heating baseline (the monthly figure prorated over the
// days of the day's calendar month). A daily figure, the finest
// attribution the gas data supports: the gas counter updates hourly,
// so hourly attribution is not supported. Never negative.
export function heatingGasM3(dailyRows, activeDays, baselineM3PerMonth) {
  const perDay = new Map();
  for (const row of dailyRows) {
    const day = localDateKey(new Date(row.bucket.getTime()));
    perDay.set(day, (perDay.get(day) ?? 0) + Number(row.kwh));
  }
  let total = 0;
  for (const [day, volume] of perDay) {
    if (!activeDays.has(day)) {
      continue;
    }
    const share = baselineM3PerMonth / daysInMonthOf(day);
    total += Math.max(0, volume - share);
  }
  return total;
}

// Heat pump electricity from heating gas, the Heat tab hybrid model's
// conversion: the gas volume times the calorific value and the boiler
// efficiency gives the delivered heat, and the flat COP converts it
// to electricity. The flat COP reuses the existing heat model
// config's 7 C anchor (EMS_COP_AT_7C, default 3.0) as a single value
// instead of its outdoor-temperature curve.
export function heatPumpKwhFromHeatingGas(gasM3, assumptions) {
  const flatCop = assumptions.copAt7C;
  if (gasM3 <= 0 || flatCop <= 0) {
    return 0;
  }
  return (
    (gasM3 * assumptions.gasCalorificKwhPerM3 * assumptions.boilerEfficiency) /
    flatCop
  );
}

// The heat pump estimate for a window: the heating gas (measured gas
// minus the prorated non-heating baseline, on heating-active days
// only) converted to electricity. Summer windows have no
// heating-active days and estimate zero. Details ride along for the
// response's assumptions echo.
export async function heatPumpEstimate(fromMs, toMs) {
  const baseline = gasNonHeatingBaselineM3PerMonth();
  const assumptions = heatModelAssumptions();
  const activeDays = await heatingActiveDays(fromMs, toMs);
  let gasM3 = 0;
  if (
    activeDays.size > 0 &&
    localDateKey(new Date(toMs - 1)) >= GAS_DATA_START
  ) {
    const entityIds = await gasCounterEntityIds();
    const rows =
      entityIds.length > 0 ? await gasDaily(entityIds, fromMs, toMs) : [];
    gasM3 = heatingGasM3(rows, activeDays, baseline);
  }
  return {
    kwh: heatPumpKwhFromHeatingGas(gasM3, assumptions),
    heatingGasM3: gasM3,
    heatingDays: activeDays.size,
    flatCop: assumptions.copAt7C,
    gasNonHeatingBaselineM3PerMonth: baseline,
  };
}

// The remainder bucket: the window's total usage minus the measured
// categories minus the heat pump estimate, floored at zero (section 3
// of docs/spec.md: no value is ever negative).
export function remainderKwh(totalKwh, measuredKwh, estimatedKwh) {
  return Math.max(0, totalKwh - measuredKwh - estimatedKwh);
}

// Measured kWh and cost per registry entity in a window: the energy
// counter deltas summed with the dynamic hourly price joined per hour
// (hours without a price row count toward kWh but not cost). Grouped
// by ha_entity_id so the registry mapping needs no id resolution.
export async function measuredEntityTotals(entityNames, fromMs, toMs) {
  const { rows } = await pool.query(
    `SELECT e.ha_entity_id AS ha_entity_id,
            sum(d.delta_kwh) AS kwh,
            sum(d.delta_kwh * p.price_eur) AS cost_eur
       FROM energy_delta d
       JOIN entity e ON e.id = d.entity_id
       LEFT JOIN price p ON p.ts = date_trunc('hour', d.ts)
      WHERE e.ha_entity_id = ANY($1::text[])
        AND d.ts >= $2::timestamptz
        AND d.ts < $3::timestamptz
      GROUP BY e.ha_entity_id`,
    [entityNames, new Date(fromMs), new Date(toMs)]
  );
  return new Map(
    rows.map((row) => [
      row.ha_entity_id,
      {
        kwh: Number(row.kwh),
        costEur: row.cost_eur === null ? null : Number(row.cost_eur),
      },
    ])
  );
}

// GET /api/usage/breakdown data for one window: every category with
// kWh and cost, the remainder bucket, the window total and the
// measured/estimated split. Measured categories sum their registry
// counters, costed per hour at the dynamic price; the heat pump
// estimate and the remainder, which have no hourly shape, are costed
// flat at the window's average hourly price. The remainder is total
// usage minus measured minus estimated (docs/spec.md section 3.4),
// floored at zero.
export async function getUsageBreakdown(fromMs, toMs) {
  const entityNames = USAGE_CATEGORIES.flatMap(
    (category) => category.entities
  );
  const [metrics, measured, priceRows, heatPump, map, slots, baseLoad] =
    await Promise.all([
      getRangeMetrics(fromMs, toMs),
      entityNames.length > 0
        ? measuredEntityTotals(entityNames, fromMs, toMs)
        : Promise.resolve(new Map()),
      dbHourlyPrices(fromMs, toMs),
      heatPumpEstimate(fromMs, toMs),
      resolveEntityMap(),
      getUsageSlots(fromMs, toMs),
      baseLoadForWindow(fromMs, toMs),
    ]);
  const avgPriceEur =
    priceRows.length > 0
      ? priceRows.reduce((sum, row) => sum + Number(row.price_eur), 0) /
        priceRows.length
      : null;
  // Usable price data exists at all: gates the priced grid fields
  // (the null-cost rule).
  const hasPrices = priceRows.some((row) => row.price_eur !== null);
  // Unattributed energy (the estimate and the remainder) is costed
  // flat at the window's average hourly price: no hourly shape exists
  // for it. Zero energy costs zero even without price rows.
  const flatCost = (kwh) =>
    kwh <= 0 ? 0 : avgPriceEur === null ? null : round2(kwh * avgPriceEur);

  const categories = [];
  let measuredKwh = 0;
  let measuredCost = 0;
  for (const category of USAGE_CATEGORIES) {
    let kwh = 0;
    let cost = null;
    for (const name of category.entities) {
      const row = measured.get(name);
      if (row === undefined) {
        continue;
      }
      kwh += row.kwh;
      if (row.costEur !== null) {
        cost = (cost ?? 0) + row.costEur;
      }
    }
    measuredKwh += kwh;
    if (cost !== null) {
      measuredCost += cost;
    }
    categories.push({
      key: category.key,
      label: category.label,
      class: "measured",
      entities: category.entities,
      kwh: round2(kwh),
      // Zero energy costs zero even when no price row priced it;
      // non-zero energy without any price row stays null.
      cost_eur:
        cost === null ? (kwh === 0 ? 0 : null) : round2(cost),
    });
  }

  const estimatedKwh = heatPump.kwh;
  categories.push({
    key: HEAT_PUMP_CATEGORY.key,
    label: HEAT_PUMP_CATEGORY.label,
    class: "Est.",
    entities: [],
    kwh: round2(estimatedKwh),
    cost_eur: flatCost(estimatedKwh),
  });

  const totalKwh = metrics.total_usage_kwh;
  const unroundedRemainder = remainderKwh(totalKwh, measuredKwh, estimatedKwh);
  categories.push({
    key: "remainder",
    label: "Remainder",
    class: "remainder",
    entities: [],
    kwh: round2(unroundedRemainder),
    cost_eur: flatCost(unroundedRemainder),
  });

  const estimatedCost = flatCost(estimatedKwh);
  const remainderCost = flatCost(unroundedRemainder);
  const totalCost =
    avgPriceEur === null
      ? null
      : round2(measuredCost + estimatedCost + remainderCost);

  // The home model over the window and the unexplained share of the
  // remainder it does not cover (docs/spec.md section 6): the
  // data-derived base load - each covered day's own figure, summed
  // exactly - plus each static per-day estimate times the window's
  // data-covered days, floored at zero so no value is negative.
  // Computed from the rounded remainder so the displayed figures
  // reconcile exactly.
  const remainderRounded = round2(unroundedRemainder);
  const modelDays = await windowDataDays(fromMs, toMs, map.import);
  const model = homeModelEntries(modelDays, baseLoad);
  const unexplainedKwh = Math.max(0, round2(remainderRounded - model.modeledKwh));

  return {
    total: { kwh: round2(totalKwh), cost_eur: totalCost },
    categories,
    split: {
      measured_kwh: round2(measuredKwh),
      estimated_kwh: round2(estimatedKwh),
      remainder_kwh: remainderRounded,
      measured_cost_eur: round2(measuredCost),
      estimated_cost_eur: estimatedCost,
      remainder_cost_eur: remainderCost,
    },
    // The window's average hourly electricity price, the flat basis
    // for costing energy without an hourly shape; null when the
    // window has no price rows at all.
    avg_price_eur:
      avgPriceEur === null
        ? null
        : Math.round(avgPriceEur * 10_000) / 10_000,
    // The grid statistics (docs/spec.md section 7.1): physical
    // volumes plus the hourly-priced import cost and export credit.
    // The null-cost rule: without usable price rows the two priced
    // fields are null, never zero.
    grid_import_kwh: metrics.import_kwh,
    grid_export_kwh: metrics.export_kwh,
    import_cost_eur: hasPrices ? metrics.cost_eur : null,
    export_credit_eur: hasPrices ? metrics.export_credit_eur : null,
    home_model: {
      days: modelDays,
      entries: model.entries,
      modeled_kwh: round2(model.modeledKwh),
      unexplained_kwh: unexplainedKwh,
    },
    // The per-slot chart series (docs/spec.md section 8).
    slots: slots,
    assumptions: {
      flat_cop: heatPump.flatCop,
      heating_gas_m3: round2(heatPump.heatingGasM3),
      heating_days: heatPump.heatingDays,
      gas_non_heating_baseline_m3_per_month:
        heatPump.gasNonHeatingBaselineM3PerMonth,
      setpoint_staleness_hours: setpointStalenessMs() / 3_600_000,
    },
  };
}
