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
  localHourIndex,
  localHourKey,
  localIsoWithOffset,
  localDayStartUtcMs,
  mondayDateKey,
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
  const [today, week, month, dataEntities, battery, flow] = await Promise.all([
    getRangeMetrics(todayStartMs, endMs),
    getRangeMetrics(localDayStartUtcMs(mondayDateKey(now)), endMs),
    getRangeMetrics(localDayStartUtcMs(`${todayKey.slice(0, 7)}-01`), endMs),
    counterEntitiesWithData(counterIds),
    getBatterySnapshot(map, todayStartMs, endMs),
    getFlowSnapshot(map),
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

  const hysteresisRaw = process.env.EMS_HEAT_HYSTERESIS;
  const hysteresisParsed =
    hysteresisRaw === undefined || hysteresisRaw === "" ? 0 : Number(hysteresisRaw);
  const hysteresis = Number.isFinite(hysteresisParsed) ? hysteresisParsed : 0;

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

// GET /api/heat/gas data: gas consumption per interval with the
// applicable price and cost. granularity "hour" reads energy_hourly,
// "day" energy_daily, "month" rolls energy_daily up per UTC calendar
// month; all three read the shared delta column whose name says kWh
// but holds m3 for the gas counter. The price for an interval is the
// last known gas_price on or before its local day; cost is m3 * price,
// and null (never 0) only when no price row exists at all.
export async function getGasUsage(fromMs, toMs, granularity) {
  if (localDateKey(new Date(toMs - 1)) < GAS_DATA_START) {
    return {
      granularity,
      series: [],
      totals: { m3: 0, cost_eur: 0, hasUnknownPrice: false },
    };
  }

  // One interval per bucket; multiple gas counters (none today) would
  // sum into the same bucket.
  const intervals = new Map();
  const entityIds = await gasCounterEntityIds();
  if (entityIds.length > 0) {
    const rows =
      granularity === "hour"
        ? await gasHourly(entityIds, fromMs, toMs)
        : await gasDaily(entityIds, fromMs, toMs);
    for (const row of rows) {
      const tsMs =
        granularity === "month"
          ? Date.UTC(
              row.bucket.getUTCFullYear(),
              row.bucket.getUTCMonth(),
              1
            )
          : row.bucket.getTime();
      intervals.set(tsMs, (intervals.get(tsMs) ?? 0) + Number(row.kwh));
    }
  }

  // One price query for the whole series, forward-filled by day.
  const prices = await gasPrices(localDateKey(new Date(toMs - 1)));
  const series = [];
  let index = 0;
  let price = null;
  let totalM3 = 0;
  let totalCost = 0;
  let hasUnknownPrice = false;
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
