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
// - The solar disposition split (server/solar-split.mjs) divides
//   each hour's PV across the home, the grid export and the battery
//   charging; every series interval carries the three split figures
//   plus selfConsumptionAvoidedCostEur, the bottom-up cost of the
//   solarToHome share at that hour's price with the same fallback
//   and the same null-never-0 rule. totals gains the self-consumed
//   kWh, its share (null when nothing was produced) and the
//   self-consumption avoided cost. The split is always computed at
//   hourly resolution: daily intervals aggregate their local day's
//   hourly split (Europe/Amsterdam, via the shared localDateKey
//   helper). The split series are the same counters the flow model
//   uses; the split's own estimate limitations live in the
//   solar-split module header.
//
// Known caveats: the PV counter updates roughly every 15 minutes, so
// hourly attribution can look stepped while daily totals are correct.
//
// Export earnings: the raw grid export counter (the split's
// gridExport series, the P1 meter's total export - battery export
// included, unlike the split's PV-capped solarToGrid estimate) times
// the flat feed-in tariff from EMS_FEED_IN_TARIFF_EUR, EUR/kWh -
// never the dynamic grid price. Unset, empty, zero or invalid reads
// as not configured: every earnings figure is then null, never a
// silent 0, and totals.exportKwh keeps reporting the measured kWh.
// The tariff rides in meta.feedInTariff so the frontend can explain
// its numbers; totals.totalCostNetEur combines the self-consumption
// savings with the export earnings and stays null while either
// component is null.

import { pool } from "./db.mjs";
import { dbHourlyPrices } from "./queries.mjs";
import {
  coalesceHourlyRows,
  dailySolarDispositions,
  hourlySolarDispositions,
  ZERO_SPLIT,
} from "./solar-split.mjs";
import { localDateKey, localDayStartUtcMs } from "./time.mjs";

// The PV production counter's entity name; the numeric ID is always
// resolved from the entity table, never hardcoded. The first day any
// production (or price) data exists for, so the frontend can render
// honest empty states for earlier periods.
const PV_ENTITY = "sensor.zonneplan_one_optimized_yield_total";
export const SOLAR_DATA_START = "2026-10-10";

// The four counters the disposition split reads alongside PV. The
// same entity names the summary's counter map uses (queries.mjs);
// numeric IDs are resolved from the entity table, never hardcoded.
const SPLIT_ENTITIES = {
  gridImport: "sensor.zonneplan_electricity_consumption_today",
  gridExport: "sensor.zonneplan_electricity_returned_today",
  batteryCharge:
    "sensor.anker_solix_solarbank_max_ac_009_battery_charging_energy",
  batteryDischarge:
    "sensor.anker_solix_solarbank_max_ac_009_battery_discharge_energy",
};

const round2 = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;

// The flat feed-in tariff in EUR/kWh from EMS_FEED_IN_TARIFF_EUR,
// the rate grid export is paid at. Unset, empty, zero or invalid
// values read as not configured (null), the same env convention as
// the heat hysteresis; a negative tariff is invalid too.
export function feedInTariffEur() {
  const raw = process.env.EMS_FEED_IN_TARIFF_EUR;
  const parsed = raw === undefined || raw === "" ? null : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// The PV energy counter's numeric entity ID, by ha_entity_id. Null
// when the counter has not been registered.
async function pvEntityId() {
  const { rows } = await pool.query(
    `SELECT id FROM entity WHERE ha_entity_id = $1`,
    [PV_ENTITY]
  );
  return rows[0]?.id ?? null;
}

// The four split counters' numeric entity IDs by ha_entity_id, in
// the summary counter map's shape: a role to ID or null.
async function splitEntityIds() {
  const { rows } = await pool.query(
    `SELECT id, ha_entity_id FROM entity WHERE ha_entity_id = ANY($1::text[])`,
    [Object.values(SPLIT_ENTITIES)]
  );
  const idByName = new Map(rows.map((row) => [row.ha_entity_id, row.id]));
  const ids = {};
  for (const [role, name] of Object.entries(SPLIT_ENTITIES)) {
    ids[role] = idByName.get(name) ?? null;
  }
  return ids;
}

// Hourly kWh buckets in [from, to) for one energy counter, from the
// energy_hourly continuous aggregate. Rows are sparse - an hour
// without energy has no row; the split layer coalesces them to 0.
async function hourlyBuckets(entityId, fromMs, toMs) {
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
// continuous aggregate. Buckets are local calendar days
// (Europe/Amsterdam): each starts at local midnight, so the
// half-open instant window below matches them exactly.
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
// hour's price, each carrying its disposition split and the
// self-consumed share's avoided cost at the same price. The raw
// grid export counter's kWh rides along as exportKwh - the metered
// total export (battery discharge included), distinct from the
// split's PV-capped solarToGrid estimate; a null exportByTs means
// the export counter is not registered, so exportKwh is null,
// while an hour missing from the map coalesces to 0. The interval
// base is the union of the PV hours and the export counter's own
// hours: evening battery export rides the same grid counter, and
// those PV-less hours must carry their export kWh and earnings
// rather than silently dropping out of the series and its totals -
// they read as 0 kWh produced, and an interval that produced
// nothing never flags an unknown price (the daily convention).
// Pure; splitByTs maps an hour's tsMs to its split, hours without
// one (the split series predate the PV series) read as the zero
// split.
export function hourlyProductionIntervals(
  hourRows,
  priceRows,
  splitByTs = new Map(),
  exportByTs = null
) {
  const rows = [...hourRows];
  const pvTs = new Set(hourRows.map((row) => row.bucket.getTime()));
  if (exportByTs !== null) {
    for (const tsMs of exportByTs.keys()) {
      if (!pvTs.has(tsMs)) {
        rows.push({ bucket: new Date(tsMs), kwh: 0 });
      }
    }
    rows.sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
  }
  return rows.map((row) => {
    const tsMs = row.bucket.getTime();
    const kwh = Number(row.kwh ?? 0);
    const price = kwh <= 0 ? 0 : applicablePrice(priceRows, tsMs);
    const split = splitByTs.get(tsMs) ?? ZERO_SPLIT;
    return {
      tsMs,
      kwh,
      costEur: price === null ? null : kwh * price,
      solarToHomeKwh: split.solarToHomeKwh,
      solarToGridKwh: split.solarToGridKwh,
      solarToBatteryKwh: split.solarToBatteryKwh,
      selfConsumedCostEur:
        price === null ? null : split.solarToHomeKwh * price,
      exportKwh: exportByTs === null ? null : (exportByTs.get(tsMs) ?? 0),
    };
  });
}

// Daily intervals: kWh from the energy_daily buckets, cost as the
// bottom-up sum over the day's own hourly buckets of kWh times that
// hour's price - never the day total times one price. A day whose
// producing hours include one without any known price costs null,
// as does a producing day whose hourly buckets are missing entirely
// (aggregate lag). The day's hours are the ones whose local day key
// (Europe/Amsterdam, via the shared localDateKey helper) matches the
// daily bucket's, so an hour bucket that crosses local midnight
// belongs to the local day it falls in. The split fields are the
// sums of that local day's hourly dispositions (splitByDay, keyed
// by the same local day key); the self-consumed cost is priced
// bottom-up over the day's self-consuming hours, null when such an
// hour lacks a price or when a producing day's hourly aggregate
// lagged away entirely. exportKwh is the local day's raw grid
// export counter sum over its own hourly buckets (exportByDay,
// keyed by the same local day key; a day absent from the map
// exported 0); a null exportByDay means the export counter is not
// registered, so exportKwh is null. Pure.
export function dailyProductionIntervals(
  dailyRows,
  hourRows,
  priceRows,
  splitByDay = new Map(),
  exportByDay = null
) {
  const hoursByLocalDay = new Map();
  for (const row of hourRows) {
    const tsMs = row.bucket.getTime();
    const dayKey = localDateKey(new Date(tsMs));
    const hours = hoursByLocalDay.get(dayKey) ?? [];
    hours.push({ tsMs, kwh: Number(row.kwh ?? 0) });
    hoursByLocalDay.set(dayKey, hours);
  }
  return dailyRows.map((row) => {
    const tsMs = row.bucket.getTime();
    const dayKey = localDateKey(new Date(tsMs));
    const kwh = Number(row.kwh ?? 0);
    const hours = hoursByLocalDay.get(dayKey) ?? [];
    const daySplit = splitByDay.get(dayKey) ?? null;
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
    let selfCost = 0;
    let selfUnknown = kwh > 0 && daySplit === null;
    if (daySplit !== null) {
      for (const hour of daySplit.hours) {
        if (hour.solarToHomeKwh <= 0) {
          continue;
        }
        const price = applicablePrice(priceRows, hour.tsMs);
        if (price === null) {
          selfUnknown = true;
        } else {
          selfCost += hour.solarToHomeKwh * price;
        }
      }
    }
    return {
      tsMs,
      kwh,
      costEur: unknown ? null : cost,
      solarToHomeKwh: daySplit === null ? null : daySplit.solarToHomeKwh,
      solarToGridKwh: daySplit === null ? null : daySplit.solarToGridKwh,
      solarToBatteryKwh:
        daySplit === null ? null : daySplit.solarToBatteryKwh,
      selfConsumedCostEur: selfUnknown ? null : selfCost,
      exportKwh: exportByDay === null ? null : (exportByDay.get(dayKey) ?? 0),
    };
  });
}

// The response body from the priced intervals: the series with
// exact-rounding figures (the split fields included; a daily
// interval whose hourly aggregate lagged away carries null splits),
// the totals (null intervals excluded from either cost, never from
// the kWh; the self-consumed share is null when nothing was
// produced), and the peak interval. The export earnings price the
// raw exportKwh at the flat feedInTariff (null = not configured:
// earnings null, never a silent 0); totalCostNetEur combines the
// self-consumption savings with the export earnings and stays null
// while either component is null. Pure.
export function assembleProduction(intervals, feedInTariff = null) {
  const series = intervals.map((interval) => {
    const exportKwh =
      interval.exportKwh == null ? null : round3(interval.exportKwh);
    return {
      ts: new Date(interval.tsMs).toISOString(),
      kwh: round3(interval.kwh),
      avoidedCostEur:
        interval.costEur === null ? null : round2(interval.costEur),
      solarToHomeKwh:
        interval.solarToHomeKwh == null
          ? null
          : round3(interval.solarToHomeKwh),
      solarToGridKwh:
        interval.solarToGridKwh == null
          ? null
          : round3(interval.solarToGridKwh),
      solarToBatteryKwh:
        interval.solarToBatteryKwh == null
          ? null
          : round3(interval.solarToBatteryKwh),
      selfConsumptionAvoidedCostEur:
        interval.selfConsumedCostEur == null
          ? null
          : round2(interval.selfConsumedCostEur),
      exportKwh,
      exportEarningsEur:
        feedInTariff === null || exportKwh === null
          ? null
          : round2(exportKwh * feedInTariff),
    };
  });
  let totalKwh = 0;
  let totalCost = 0;
  let totalSelfKwh = 0;
  let totalSelfCost = 0;
  let totalExportKwh = 0;
  let totalExportEarnings = 0;
  let hasUnknownPrice = false;
  let hasUnknownExport = false;
  let peak = null;
  for (const point of series) {
    totalKwh += point.kwh;
    if (point.avoidedCostEur === null) {
      hasUnknownPrice = true;
    } else {
      totalCost += point.avoidedCostEur;
    }
    if (point.solarToHomeKwh !== null) {
      totalSelfKwh += point.solarToHomeKwh;
    }
    if (point.selfConsumptionAvoidedCostEur !== null) {
      totalSelfCost += point.selfConsumptionAvoidedCostEur;
    }
    if (point.exportKwh === null) {
      hasUnknownExport = true;
    } else {
      totalExportKwh += point.exportKwh;
    }
    if (point.exportEarningsEur !== null) {
      totalExportEarnings += point.exportEarningsEur;
    }
    if (peak === null || point.kwh > peak.kwh) {
      peak = { ts: point.ts, kwh: point.kwh };
    }
  }
  const exportEarningsTotal =
    feedInTariff === null || hasUnknownExport
      ? null
      : round2(totalExportEarnings);
  return {
    series,
    totals: {
      kwh: round3(totalKwh),
      avoidedCostEur: round2(totalCost),
      hasUnknownPrice,
      selfConsumedKwh: round3(totalSelfKwh),
      selfConsumedShare: totalKwh > 0 ? round3(totalSelfKwh / totalKwh) : null,
      selfConsumptionAvoidedCostEur: round2(totalSelfCost),
      exportKwh: hasUnknownExport ? null : round3(totalExportKwh),
      exportEarningsEur: exportEarningsTotal,
      totalCostNetEur:
        exportEarningsTotal === null
          ? null
          : round2(round2(totalSelfCost) + exportEarningsTotal),
    },
    peak,
  };
}

// The newest energy_hourly bucket across the split's five counters,
// with no window bound: coverage is a property of the aggregate, not
// of the queried period. Null when no bucket exists yet.
async function hourlyCoverageLastBucket(entityIds) {
  const { rows } = await pool.query(
    `SELECT max(bucket) AS last_bucket
       FROM energy_hourly
      WHERE entity_id = ANY($1::smallint[])`,
    [entityIds]
  );
  return rows[0]?.last_bucket ? new Date(rows[0].last_bucket).getTime() : null;
}

// GET /api/solar/production data for [fromMs, toMs): PV production
// with the avoided grid cost and the disposition split, at the given
// resolution ("hourly" or "daily" - the split itself is always
// computed hourly and aggregated per local day for daily intervals).
// Windows that end before the data start carry an empty series
// rather than an error, so the frontend can render its honest empty
// state. The raw export counter's kWh rides along per interval with
// its earnings at the flat feed-in tariff (feedInTariff in the
// response, null when unconfigured). The hourly interval base is
// the union of the PV hours and the export counter's hours, so
// evening battery export (which rides the same grid counter) keeps
// its own hourly interval with 0 kWh produced. The hourlyCoverage
// sanity check reports the aggregate's freshness (stale when its
// newest bucket predates the current hour); the data is served
// either way, never failed.
export async function getSolarProduction(fromMs, toMs, resolution) {
  const tariff = feedInTariffEur();
  if (localDateKey(new Date(toMs - 1)) < SOLAR_DATA_START) {
    return {
      ...assembleProduction([], tariff),
      feedInTariff: tariff,
      hourlyCoverage: null,
    };
  }
  const entityId = await pvEntityId();
  if (entityId === null) {
    return {
      ...assembleProduction([], tariff),
      feedInTariff: tariff,
      hourlyCoverage: null,
    };
  }
  const splitIds = await splitEntityIds();
  const allIds = [entityId, ...Object.values(splitIds)].filter(
    (id) => id !== null
  );
  // Every price row from the data start: intervals early in the
  // window fall back to the last known price before them.
  const priceRows = await dbHourlyPrices(
    localDayStartUtcMs(SOLAR_DATA_START),
    toMs
  );
  const hourRows = await hourlyBuckets(entityId, fromMs, toMs);
  const [importRows, exportRows, chargeRows, dischargeRows] =
    await Promise.all(
      ["gridImport", "gridExport", "batteryCharge", "batteryDischarge"].map(
        (role) =>
          splitIds[role] === null
            ? Promise.resolve([])
            : hourlyBuckets(splitIds[role], fromMs, toMs)
      )
    );
  const dispositions = hourlySolarDispositions(
    coalesceHourlyRows({
      pv: hourRows,
      gridImport: importRows,
      gridExport: exportRows,
      batteryCharge: chargeRows,
      batteryDischarge: dischargeRows,
    })
  );
  const splitByTs = new Map(dispositions.map((hour) => [hour.tsMs, hour]));
  // The raw export counter's hourly kWh, by hour and by local day;
  // null maps mean the counter is not registered, so the export
  // figures read null rather than a silent 0. The same rows already
  // feed the disposition split.
  const exportAvailable = splitIds.gridExport !== null;
  const exportByTs = exportAvailable
    ? new Map(exportRows.map((row) => [row.bucket.getTime(), Number(row.kwh ?? 0)]))
    : null;
  const exportByDay = exportAvailable ? new Map() : null;
  if (exportByDay !== null) {
    for (const row of exportRows) {
      const dayKey = localDateKey(new Date(row.bucket.getTime()));
      exportByDay.set(dayKey, (exportByDay.get(dayKey) ?? 0) + Number(row.kwh ?? 0));
    }
  }
  const intervals =
    resolution === "hourly"
      ? hourlyProductionIntervals(hourRows, priceRows, splitByTs, exportByTs)
      : dailyProductionIntervals(
          await pvDaily(entityId, fromMs, toMs),
          hourRows,
          priceRows,
          dailySolarDispositions(dispositions),
          exportByDay
        );
  const lastBucketMs = await hourlyCoverageLastBucket(allIds);
  const currentHourMs = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  return {
    ...assembleProduction(intervals, tariff),
    feedInTariff: tariff,
    hourlyCoverage: {
      lastBucket:
        lastBucketMs === null ? null : new Date(lastBucketMs).toISOString(),
      stale: lastBucketMs === null ? true : lastBucketMs < currentHourMs,
    },
  };
}
