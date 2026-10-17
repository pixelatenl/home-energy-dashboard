// The period-anchored battery flow data: charge and discharge kWh
// per interval with their money dimensions - the charging cost and
// the discharge value, both priced bottom-up at each hour's dynamic
// electricity price (the price table's all-in consumption price,
// with the last-known-price fallback) - plus the SOC series for day
// windows and the period totals. Battery arbitrage is the
// discharge value minus the charge cost.
//
// Resolution follows the period: hourly buckets for a day, daily
// aggregates for a week or month (each local day's hours rolled up,
// so totals always match the chart), monthly aggregates for a year.
// The money figures are always priced bottom-up from the hourly
// buckets, whatever the display resolution. An interval with flow
// but no known price carries null money - never a silent 0 - and a
// single such interval makes the matching money total null too.
//
// The module's pure functions are the aggregation and pricing; the
// caller fetches the hourly counter rows and price rows. The hour
// resolution reuses solar-production's applicablePrice fallback.

import { pool } from "./db.mjs";
import { dbHourlyPrices } from "./queries.mjs";
import { applicablePrice } from "./solar-production.mjs";
import { localDateKey, localDayStartUtcMs } from "./time.mjs";

// The battery counters and the SOC sensor; numeric IDs are always
// resolved from the entity table, never hardcoded. The first local
// day any battery flow data exists for, for honest empty states.
const BATTERY_ENTITIES = {
  charging:
    "sensor.anker_solix_solarbank_max_ac_009_battery_charging_energy",
  discharging:
    "sensor.anker_solix_solarbank_max_ac_009_battery_discharge_energy",
  soc: "sensor.anker_solix_solarbank_max_ac_009_soc",
};
export const BATTERY_DATA_START = "2026-10-11";

const round2 = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;

// The battery entities' numeric IDs by ha_entity_id, in the summary
// counter map's shape: a role to ID or null.
async function batteryEntityIds() {
  const { rows } = await pool.query(
    `SELECT id, ha_entity_id FROM entity WHERE ha_entity_id = ANY($1::text[])`,
    [Object.values(BATTERY_ENTITIES)]
  );
  const idByName = new Map(rows.map((row) => [row.ha_entity_id, row.id]));
  const ids = {};
  for (const [role, name] of Object.entries(BATTERY_ENTITIES)) {
    ids[role] = idByName.get(name) ?? null;
  }
  return ids;
}

// Hourly kWh buckets in [from, to) for one energy counter, from the
// energy_hourly continuous aggregate. Rows are sparse - an hour
// without energy has no row; the flow layer coalesces them to 0.
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

// One hour's flow: charged and discharged kWh with their money
// dimensions. The cost or value is null when the hour carries flow
// but no known price, and a true 0 when the hour carried nothing -
// pricing nothing is free, not unknown.
function priceHour(hour, price) {
  const inCost =
    hour.inKwh <= 0 ? 0 : price === null ? null : hour.inKwh * price;
  const outValue =
    hour.outKwh <= 0 ? 0 : price === null ? null : hour.outKwh * price;
  return { ...hour, inCostEur: inCost, outValueEur: outValue };
}

// The hourly battery flow: the union of the two counter series'
// hours, each with charged and discharged kWh (absent hours
// coalesced to 0) priced at its own hour's price with the
// last-known-price fallback. Pure; rows are SQL-shape
// { bucket: Date, kwh } and priceRows must be ts-ascending.
export function hourlyBatteryFlow(chargeRows, dischargeRows, priceRows) {
  const hours = new Map(); // tsMs -> { tsMs, inKwh, outKwh }
  const add = (rows, field) => {
    for (const row of rows) {
      const tsMs = row.bucket.getTime();
      const hour = hours.get(tsMs) ?? { tsMs, inKwh: 0, outKwh: 0 };
      hour[field] += Number(row.kwh ?? 0);
      hours.set(tsMs, hour);
    }
  };
  add(chargeRows, "inKwh");
  add(dischargeRows, "outKwh");
  return [...hours.values()]
    .sort((a, b) => a.tsMs - b.tsMs)
    .map((hour) => priceHour(hour, applicablePrice(priceRows, hour.tsMs)));
}

// Rolls the hourly flow up per local calendar day
// (Europe/Amsterdam, via the shared localDateKey helper), so a
// week's or month's series carries one interval per day with the
// day's totals - kWh and money alike - and the day bucket's ts is
// the local midnight. A day with flow in an hour without a known
// price carries null money, never a silent 0. Pure; returns a
// tsMs-ascending array of the same interval shape.
export function dailyBatteryFlow(hours) {
  const byDay = new Map(); // dayKey -> interval
  for (const hour of hours) {
    const dayKey = localDateKey(new Date(hour.tsMs));
    const day =
      byDay.get(dayKey) ??
      {
        tsMs: localDayStartUtcMs(dayKey),
        inKwh: 0,
        outKwh: 0,
        inCostEur: 0,
        outValueEur: 0,
        unknownCost: false,
        unknownValue: false,
      };
    day.inKwh += hour.inKwh;
    day.outKwh += hour.outKwh;
    if (hour.inCostEur === null) {
      day.unknownCost = true;
    } else {
      day.inCostEur += hour.inCostEur;
    }
    if (hour.outValueEur === null) {
      day.unknownValue = true;
    } else {
      day.outValueEur += hour.outValueEur;
    }
    byDay.set(dayKey, day);
  }
  return [...byDay.values()]
    .sort((a, b) => a.tsMs - b.tsMs)
    .map((day) => ({
      ...day,
      inCostEur: day.unknownCost ? null : day.inCostEur,
      outValueEur: day.unknownValue ? null : day.outValueEur,
    }));
}

// Rolls the daily flow up per local calendar month, for the year
// view: one interval per month, keyed by the month's first day.
// Pure; takes dailyBatteryFlow's output.
export function monthlyBatteryFlow(days) {
  const byMonth = new Map(); // monthKey -> interval
  for (const day of days) {
    const monthKey = localDateKey(new Date(day.tsMs)).slice(0, 7);
    const month =
      byMonth.get(monthKey) ??
      {
        tsMs: localDayStartUtcMs(`${monthKey}-01`),
        inKwh: 0,
        outKwh: 0,
        inCostEur: 0,
        outValueEur: 0,
        unknownCost: false,
        unknownValue: false,
      };
    month.inKwh += day.inKwh;
    month.outKwh += day.outKwh;
    if (day.inCostEur === null) {
      month.unknownCost = true;
    } else {
      month.inCostEur += day.inCostEur;
    }
    if (day.outValueEur === null) {
      month.unknownValue = true;
    } else {
      month.outValueEur += day.outValueEur;
    }
    byMonth.set(monthKey, month);
  }
  return [...byMonth.values()]
    .sort((a, b) => a.tsMs - b.tsMs)
    .map((month) => ({
      ...month,
      inCostEur: month.unknownCost ? null : month.inCostEur,
      outValueEur: month.unknownValue ? null : month.outValueEur,
    }));
}

// The response body from the flow intervals: the series with
// exact-rounding figures and the period totals. The totals sum the
// series' rounded values bottom-up, so they always match the chart;
// a money total is null when any interval with flow lacks its price
// (null intervals excluded from the sum, never a silent 0), and the
// arbitrage - discharge value minus charge cost - is null while
// either money figure is null. Pure.
export function assembleBatteryFlow(intervals) {
  const series = intervals.map((interval) => ({
    ts: new Date(interval.tsMs).toISOString(),
    in_kwh: round3(interval.inKwh),
    out_kwh: round3(interval.outKwh),
    in_cost_eur:
      interval.inCostEur === null ? null : round2(interval.inCostEur),
    out_value_eur:
      interval.outValueEur === null ? null : round2(interval.outValueEur),
  }));
  let chargedKwh = 0;
  let dischargedKwh = 0;
  let chargeCost = 0;
  let dischargeValue = 0;
  let hasUnknownCost = false;
  let hasUnknownValue = false;
  for (const point of series) {
    chargedKwh += point.in_kwh;
    dischargedKwh += point.out_kwh;
    if (point.in_cost_eur === null) {
      if (point.in_kwh > 0) {
        hasUnknownCost = true;
      }
    } else {
      chargeCost += point.in_cost_eur;
    }
    if (point.out_value_eur === null) {
      if (point.out_kwh > 0) {
        hasUnknownValue = true;
      }
    } else {
      dischargeValue += point.out_value_eur;
    }
  }
  const costTotal = hasUnknownCost ? null : round2(chargeCost);
  const valueTotal = hasUnknownValue ? null : round2(dischargeValue);
  return {
    series,
    totals: {
      charged_kwh: round3(chargedKwh),
      discharged_kwh: round3(dischargedKwh),
      net_kwh: round3(chargedKwh - dischargedKwh),
      charge_cost_eur: costTotal,
      discharge_value_eur: valueTotal,
      arbitrage_eur:
        costTotal === null || valueTotal === null
          ? null
          : round2(valueTotal - costTotal),
    },
  };
}

// The SOC series for a window: the measurement rows of the SOC
// sensor, rounded to whole percents. Empty when the sensor is not
// registered.
async function socSeries(socEntityId, fromMs, toMs) {
  if (socEntityId === null) {
    return [];
  }
  const { rows } = await pool.query(
    `SELECT ts, value
       FROM measurement
      WHERE entity_id = $1::smallint
        AND ts >= $2::timestamptz
        AND ts < $3::timestamptz
      ORDER BY ts ASC`,
    [socEntityId, new Date(fromMs), new Date(toMs)]
  );
  return rows.map((row) => ({
    ts: row.ts.toISOString(),
    soc_pct: Math.round(row.value),
  }));
}

// The battery flow data for [fromMs, toMs) at the given resolution
// ("hour", "day" or "month"): the flow series, the period totals
// and - for hour windows - the SOC series. Windows that end before
// the data start carry an empty series rather than an error, so the
// frontend can render its honest empty state. Prices are fetched
// from the data start so intervals early in the window fall back
// to the last known price before them.
export async function getBatteryFlow(fromMs, toMs, resolution) {
  const ids = await batteryEntityIds();
  if (ids.charging === null || ids.discharging === null) {
    return {
      ...assembleBatteryFlow([]),
      soc_series: [],
      battery_available: false,
    };
  }
  const [chargeRows, dischargeRows, priceRows, soc] = await Promise.all([
    hourlyBuckets(ids.charging, fromMs, toMs),
    hourlyBuckets(ids.discharging, fromMs, toMs),
    dbHourlyPrices(localDayStartUtcMs(BATTERY_DATA_START), toMs),
    resolution === "hour"
      ? socSeries(ids.soc, fromMs, toMs)
      : Promise.resolve([]),
  ]);
  const hours = hourlyBatteryFlow(chargeRows, dischargeRows, priceRows);
  const intervals =
    resolution === "hour"
      ? hours
      : resolution === "day"
        ? dailyBatteryFlow(hours)
        : monthlyBatteryFlow(dailyBatteryFlow(hours));
  return {
    ...assembleBatteryFlow(intervals),
    soc_series: soc,
    battery_available: true,
  };
}
