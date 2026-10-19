// Live power snapshot for GET /api/live: a pure read-only passthrough of
// the whitelisted Home Assistant power sensors, with a fail-soft fallback
// to the newest database measurement for each field.
//
// No write path of any kind lives here: no INSERT or UPDATE, no state
// push to Home Assistant, no ingest import, nothing persisted. The only
// side effects are the in-memory snapshot cache and console warnings
// when a fetch fails - per field, so a silent multi-month HA outage
// like the price fetch once had cannot happen unnoticed again.

import { POWER_DEADBAND_W, currentMeasurements } from "./queries.mjs";

const DEFAULT_CACHE_SECONDS = 3;
const REQUEST_TIMEOUT_MS = 3_000;
// The snapshot cache already throttles fetch attempts; this keeps a long
// HA outage from flooding the log with one warning per field per minute.
const FAILURE_LOG_INTERVAL_MS = 60_000;

// The whitelisted entities: field name -> HA entity and unit. The same
// sensors the flow diagram resolves in queries.mjs.
const LIVE_ENTITIES = {
  gridImportW: {
    entity: "sensor.connect_energiemeter_electricity_consumption",
    unit: "W",
  },
  gridExportW: {
    entity: "sensor.connect_energiemeter_electricity_production",
    unit: "W",
  },
  batteryChargeW: {
    entity:
      "sensor.anker_solix_solarbank_max_ac_009_battery_charging_power",
    unit: "W",
  },
  batteryDischargeW: {
    entity:
      "sensor.anker_solix_solarbank_max_ac_009_battery_discharging_power",
    unit: "W",
  },
  batterySocPct: {
    entity: "sensor.anker_solix_solarbank_max_ac_009_soc",
    unit: "%",
  },
  batterySolarInW: {
    entity: "sensor.anker_solix_solarbank_max_ac_009_solar_power",
    unit: "W",
  },
  pvPowerW: {
    entity: "sensor.zonneplan_one_optimized_last_measured_value",
    unit: "W",
  },
};

const lastFailureLogAt = new Map(); // field -> ms of the last warning

function warnFetchFailure(field, entity, reason) {
  const now = Date.now();
  const last = lastFailureLogAt.get(field) ?? 0;
  if (now - last < FAILURE_LOG_INTERVAL_MS) {
    return;
  }
  lastFailureLogAt.set(field, now);
  console.warn(`live: HA fetch failed for ${field} (${entity}): ${reason}`);
}

// Fetch and database errors carry the useful detail in cause.code
// (ECONNREFUSED, ETIMEDOUT, ...), not in the top-level message.
function errorText(err) {
  const code = err?.cause?.code ?? err?.code;
  const message = err?.cause?.message ?? err?.message ?? String(err);
  return code === undefined || code === null ? message : `${message} (${code})`;
}

// One whitelisted entity from the HA REST API. Reads HA_URL and HA_TOKEN
// from the environment, the same precedent as ha.mjs, and never logs
// them. Fail-soft: any error or non-numeric state resolves to null so the
// caller can fall back to the database.
async function fetchHaField(field, entity) {
  const baseUrl = process.env.HA_URL;
  const token = process.env.HA_TOKEN;
  if (!baseUrl || !token) {
    warnFetchFailure(field, entity, "HA_URL or HA_TOKEN not configured");
    return null;
  }
  let response;
  try {
    response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/states/${entity}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
  } catch (err) {
    warnFetchFailure(
      field,
      entity,
      err?.name === "TimeoutError" ? "request timed out" : errorText(err)
    );
    return null;
  }
  if (!response.ok) {
    warnFetchFailure(field, entity, `HTTP ${response.status}`);
    return null;
  }
  let state;
  try {
    state = await response.json();
  } catch {
    warnFetchFailure(field, entity, "response was not valid JSON");
    return null;
  }
  const value = Number.parseFloat(state?.state);
  if (!Number.isFinite(value)) {
    warnFetchFailure(field, entity, `state "${state?.state}" is not a number`);
    return null;
  }
  const lastUpdated = Date.parse(state?.last_updated);
  return {
    value,
    at: Number.isFinite(lastUpdated) ? lastUpdated : Date.now(),
  };
}

function roundedValue(field, value) {
  // Watts read as integers like the flow snapshot; the SOC keeps one
  // decimal. Rounding presentation only - never a fabricated value.
  return LIVE_ENTITIES[field].unit === "W"
    ? Math.round(value)
    : Math.round(value * 10) / 10;
}

// Fetches every whitelisted entity in parallel and resolves each field to
// its HA value, its newest database measurement, or null. HA last_updated
// timestamps carry the honest HA age; the database row's ts carries the
// fallback age.
async function buildSnapshot() {
  const haResults = await Promise.all(
    Object.entries(LIVE_ENTITIES).map(async ([field, definition]) => [
      field,
      definition,
      await fetchHaField(field, definition.entity),
    ])
  );

  // The database fallback, only when at least one field is missing from
  // HA: the newest measurement row per entity, read-only, through the
  // existing queries module.
  let dbRows = [];
  if (haResults.some(([, , ha]) => ha === null)) {
    try {
      dbRows = await currentMeasurements();
    } catch (err) {
      console.warn(`live: database fallback failed: ${errorText(err)}`);
    }
  }
  const dbByEntity = new Map(dbRows.map((row) => [row.ha_entity_id, row]));

  const entries = new Map(); // field -> { value, unit, source, at } | null
  for (const [field, definition, ha] of haResults) {
    if (ha !== null) {
      entries.set(field, {
        value: roundedValue(field, ha.value),
        unit: definition.unit,
        source: "ha",
        at: ha.at,
      });
      continue;
    }
    const row = dbByEntity.get(definition.entity);
    const value = Number(row?.value);
    if (row !== undefined && row.ts !== null && Number.isFinite(value)) {
      entries.set(field, {
        value: roundedValue(field, value),
        unit: definition.unit,
        source: "db",
        at: row.ts.getTime(),
      });
    } else {
      // Neither source has the field: null, never a fabricated zero.
      entries.set(field, null);
    }
  }
  return { fetchedAt: Date.now(), entries };
}

// A derived grid field from the import and export entries. The source is
// "ha" only when both inputs are, and the age is bounded by the older
// input. Null with source "none" when either input is missing.
function deriveGridField(importEntry, exportEntry, value, unit) {
  if (importEntry === null || exportEntry === null) {
    return null;
  }
  return {
    value,
    unit,
    source:
      importEntry.source === "ha" && exportEntry.source === "ha"
        ? "ha"
        : "db",
    at: Math.min(importEntry.at, exportEntry.at),
  };
}

// The battery state, single-writer on the server: net charge power at
// the shared deadband, the same POWER_DEADBAND_W batteryStateFromPower
// reads idle at. Both power readings must exist; with either missing
// the state is honestly unavailable, never guessed from one side. A
// stale zero stays idle - the age carries the honesty, not the label.
// Pure, so the deadband boundary is testable without the network.
export function deriveBatteryState(chargeEntry, dischargeEntry) {
  if (chargeEntry === null || dischargeEntry === null) {
    return null;
  }
  const netW = chargeEntry.value - dischargeEntry.value;
  const state =
    netW > POWER_DEADBAND_W
      ? "charging"
      : netW < -POWER_DEADBAND_W
        ? "discharging"
        : "idle";
  return {
    state,
    source:
      chargeEntry.source === "ha" && dischargeEntry.source === "ha"
        ? "ha"
        : "db",
    at: Math.min(chargeEntry.at, dischargeEntry.at),
  };
}

let snapshotCache = null; // { fetchedAt, entries }
let inFlight = null; // Promise while a fetch is running

function cacheSeconds() {
  const parsed = Number.parseInt(
    process.env.EMS_LIVE_CACHE_SECONDS ?? "",
    10
  );
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_CACHE_SECONDS;
}

function ageSeconds(at) {
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

function fieldResponse(field, entry) {
  const unit = LIVE_ENTITIES[field]?.unit ?? null;
  if (entry === null || entry === undefined) {
    return {
      value: null,
      unit,
      source: "none",
      ageSeconds: null,
    };
  }
  return {
    value: entry.value,
    unit: entry.unit,
    source: entry.source,
    ageSeconds: ageSeconds(entry.at),
  };
}

// The live snapshot served by GET /api/live. Read-only by construction:
// the only inputs are the HA REST API and the existing read-only queries.
// Ages are recomputed from the stored timestamps on every response, so a
// cache hit still reports honest ages.
export async function getLiveSnapshot() {
  const ttlMs = cacheSeconds() * 1000;
  if (
    snapshotCache === null ||
    Date.now() - snapshotCache.fetchedAt >= ttlMs
  ) {
    if (inFlight === null) {
      inFlight = buildSnapshot()
        .then((built) => {
          snapshotCache = built;
        })
        .catch((err) => {
          console.warn(`live: snapshot build failed: ${errorText(err)}`);
        })
        .finally(() => {
          inFlight = null;
        });
    }
    await inFlight;
  }

  const entries = snapshotCache?.entries ?? new Map();
  const gridImport = entries.get("gridImportW") ?? null;
  const gridExport = entries.get("gridExportW") ?? null;
  const batteryStateEntry = deriveBatteryState(
    entries.get("batteryChargeW") ?? null,
    entries.get("batteryDischargeW") ?? null
  );
  const netGrid =
    gridImport !== null && gridExport !== null
      ? deriveGridField(
          gridImport,
          gridExport,
          gridImport.value - gridExport.value,
          "W"
        )
      : null;
  const isExporting =
    gridImport !== null && gridExport !== null
      ? deriveGridField(
          gridImport,
          gridExport,
          gridExport.value - gridImport.value > POWER_DEADBAND_W,
          null
        )
      : null;

  return {
    fetchedAt: new Date(snapshotCache?.fetchedAt ?? Date.now()).toISOString(),
    cacheSeconds: cacheSeconds(),
    fields: {
      gridImportW: fieldResponse("gridImportW", gridImport),
      gridExportW: fieldResponse("gridExportW", gridExport),
      netGridW: fieldResponse("netGridW", netGrid),
      batteryChargeW: fieldResponse(
        "batteryChargeW",
        entries.get("batteryChargeW") ?? null
      ),
      batteryDischargeW: fieldResponse(
        "batteryDischargeW",
        entries.get("batteryDischargeW") ?? null
      ),
      batterySocPct: fieldResponse(
        "batterySocPct",
        entries.get("batterySocPct") ?? null
      ),
      // The server-computed battery state: the single writer the
      // frontend renders verbatim.
      batteryState: {
        state: batteryStateEntry?.state ?? "unavailable",
        source: batteryStateEntry?.source ?? "none",
        ageSeconds:
          batteryStateEntry === null ? null : ageSeconds(batteryStateEntry.at),
      },
      batterySolarInW: fieldResponse(
        "batterySolarInW",
        entries.get("batterySolarInW") ?? null
      ),
      pvPowerW: fieldResponse("pvPowerW", entries.get("pvPowerW") ?? null),
      isExporting: {
        value: isExporting?.value ?? null,
        unit: null,
        source: isExporting?.source ?? "none",
        ageSeconds: isExporting === null ? null : ageSeconds(isExporting.at),
      },
    },
  };
}
