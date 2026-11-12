// The context-box facts layer (contract section 11): the pure fact
// builders behind the three spoke-page context-box callers -
// usage_context (the Usage page's three section boxes), heat_context
// (the Heat page's three section boxes) and solar_production (the
// Solar production box). Pure like buildUsageSlots: the query
// results in (all SQL stays in queries.mjs), the fact sets out; a
// later pass wires the endpoints, no SQL, no model call and no env
// read lives here. Time handling goes through the DST-safe helpers
// in time.mjs only. Null encodings follow the house rule: a missing
// or thin input is null, never a guess, never zero.

import { conditionSummary } from "./context.mjs";
import {
  localDateKey,
  localDayStartUtcMs,
  localHourLabel,
  localIsoWithOffset,
  nextDateKey,
  periodDateKeys,
} from "./time.mjs";

const round1 = (value) => Math.round(value * 10) / 10;
const round2 = (value) => Math.round(value * 100) / 100;
const round4 = (value) => Math.round(value * 10_000) / 10_000;
const pct = (part, whole) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

// The anchored period's half-open local window [fromMs, toMs) from
// the DST-safe helpers: start the local midnight of the first day,
// end the local midnight after the last day. Null for an unknown
// period or an impossible date key.
function anchorWindow(period, dateKey) {
  const keys = periodDateKeys(period, dateKey);
  if (keys === null) {
    return null;
  }
  const fromMs = localDayStartUtcMs(keys.startKey);
  const toMs = localDayStartUtcMs(nextDateKey(keys.endKey, 1));
  return { keys, fromMs, toMs };
}

// The time-aligned comparison helper: the previous period of the
// same kind, the period containing the day before the anchored one's
// first day, so both sides span the same length. The same rule the
// usage breakdown endpoint applies to its previous period.
export function previousPeriodWindow(period, dateKey) {
  const window = anchorWindow(period, dateKey);
  if (window === null) {
    return null;
  }
  const prevKeys = periodDateKeys(period, nextDateKey(window.keys.startKey, -1));
  if (prevKeys === null) {
    return null;
  }
  return {
    keys: prevKeys,
    fromMs: localDayStartUtcMs(prevKeys.startKey),
    toMs: localDayStartUtcMs(nextDateKey(prevKeys.endKey, 1)),
  };
}

// day_status of the anchored period at `now`: "in_progress" when the
// local today lies inside the period, "complete" when the period
// ended before today, null for a future period (no data can exist
// yet). so_far marks the in-progress case: every figure is a so-far
// total of the period, never a full-period figure.
function dayStatus(keys, now) {
  const todayKey = localDateKey(now);
  if (todayKey >= keys.startKey && todayKey <= keys.endKey) {
    return "in_progress";
  }
  return keys.endKey < todayKey ? "complete" : null;
}

function windowFacts(window) {
  if (window === null) {
    return null;
  }
  return {
    start: localIsoWithOffset(new Date(window.fromMs)),
    end: localIsoWithOffset(new Date(window.toMs)),
  };
}

// The energy semantics hint every fact set ships (contract section
// 11): energy figures are day or period totals, never live power.
const ENERGY_SEMANTICS =
  "Energy figures are day or period totals, never live power.";

// ---- usage_context: the Usage page's three section boxes ----

// The breakdown section: the measured categories plus the heat pump
// estimate, each with kWh and EUR, share of the home total and its
// class, plus the measured coverage share of home usage. Null when
// the anchored period carries no usage data at all.
function breakdownSection(breakdown) {
  if (!breakdown?.total || !(breakdown.total.kwh > 0)) {
    return null;
  }
  const totalKwh = breakdown.total.kwh;
  const categories = breakdown.categories
    .filter(
      (category) =>
        category.class === "measured" || category.key === "heat_pump"
    )
    .map((category) => ({
      name: category.label,
      kwh: category.kwh,
      eur: category.cost_eur,
      share_pct: pct(category.kwh, totalKwh),
      class: category.key === "heat_pump" ? "estimated" : "measured",
    }));
  return {
    total_kwh: totalKwh,
    total_eur: breakdown.total.cost_eur,
    categories,
    measured_share_pct: pct(breakdown.split?.measured_kwh ?? 0, totalKwh),
    semantics: ENERGY_SEMANTICS,
  };
}

// The rest-of-home section: the home model's entries - the
// data-derived baseload (class derived, with its basis note) first,
// then the static model entries such as lighting (class model) - and
// the unexplained remainder with its framing fact: real usage of
// unnamed appliances, not an error. Energy without an hourly shape is
// costed flat at the window's average price, null when that is
// unknown (the same flat rule the breakdown endpoint applies).
function restOfHomeSection(breakdown) {
  if (!breakdown?.total || !(breakdown.total.kwh > 0)) {
    return null;
  }
  const avgPrice = breakdown.avg_price_eur ?? null;
  const flatEur = (kwh) =>
    kwh <= 0 ? 0 : avgPrice === null ? null : round2(kwh * avgPrice);
  const model = breakdown.home_model ?? { entries: [], unexplained_kwh: 0 };
  const entries = model.entries.map((entry) => ({
    key: entry.key,
    name: entry.name,
    kwh: entry.kwh,
    eur: flatEur(entry.kwh),
    class: entry.derived === true ? "derived" : "model",
    basis: entry.basis ?? null,
  }));
  const unexplainedKwh = model.unexplained_kwh ?? 0;
  return {
    entries,
    unexplained_kwh: unexplainedKwh,
    unexplained_eur: flatEur(unexplainedKwh),
    unexplained_framing:
      "The unexplained share is real usage of unnamed appliances, not an error.",
    semantics: ENERGY_SEMANTICS,
  };
}

// The human time label of one slot: "HH:00" for hour slots, the
// "YYYY-MM-DD" date key for day slots, "YYYY-MM" for month slots.
function slotLabel(ts, unit) {
  if (unit === "hour") {
    return localHourLabel(ts);
  }
  const dateKey = localDateKey(new Date(ts));
  return unit === "day" ? dateKey : dateKey.slice(0, 7);
}

// The over-time section: the slot totals (each with kWh and EUR and
// its time label), the peak slot, the share of usage in the most
// expensive hours (the period's three highest-priced slots), the
// period's price statistics, and the comparison with the previous
// period - only when the anchored period is complete, via the
// time-aligned previousPeriodWindow helper; an in-progress period
// never compares.
function overTimeSection(breakdown, priceRows, previous, status) {
  const slots = breakdown?.slots;
  if (!slots?.series || slots.series.length === 0) {
    return null;
  }
  const unit = slots.unit;
  const series = slots.series;
  const totalKwh = series.reduce((sum, slot) => sum + slot.kwh, 0);
  const slotFacts = series.map((slot) => ({
    label: slotLabel(slot.ts, unit),
    kwh: slot.kwh,
    eur: slot.cost_eur,
  }));
  const peak = series.reduce(
    (best, slot) => (best === null || slot.kwh > best.kwh ? slot : best),
    null
  );
  const priced = series.filter((slot) => slot.price_eur !== null);
  const expensive = [...priced]
    .sort((a, b) => b.price_eur - a.price_eur)
    .slice(0, 3);
  const prices = (priceRows ?? [])
    .map((row) => (row.price_eur === null ? null : Number(row.price_eur)))
    .filter((price) => price !== null);
  let peakPriceRow = null;
  for (const row of priceRows ?? []) {
    if (row.price_eur === null) {
      continue;
    }
    if (peakPriceRow === null || Number(row.price_eur) > Number(peakPriceRow.price_eur)) {
      peakPriceRow = row;
    }
  }
  return {
    unit,
    slots: slotFacts,
    peak_slot:
      peak !== null && peak.kwh > 0
        ? { label: slotLabel(peak.ts, unit), kwh: peak.kwh, eur: peak.cost_eur }
        : null,
    most_expensive_hours_share_pct:
      totalKwh > 0 && expensive.length > 0
        ? pct(
            expensive.reduce((sum, slot) => sum + slot.kwh, 0),
            totalKwh
          )
        : null,
    price_stats:
      prices.length > 0
        ? {
            average_eur: round4(prices.reduce((sum, p) => sum + p, 0) / prices.length),
            min_eur: Math.min(...prices),
            max_eur: Math.max(...prices),
            peak_label:
              peakPriceRow === null
                ? null
                : localHourLabel(new Date(peakPriceRow.ts).toISOString()),
          }
        : null,
    comparison:
      status === "complete" && previous?.total
        ? {
            previous_kwh: previous.total.kwh,
            previous_eur: previous.total.cost_eur,
            delta_kwh: round2((breakdown.total?.kwh ?? 0) - previous.total.kwh),
            delta_eur:
              breakdown.total?.cost_eur !== null &&
              breakdown.total?.cost_eur !== undefined &&
              previous.total.cost_eur !== null &&
              previous.total.cost_eur !== undefined
                ? round2(breakdown.total.cost_eur - previous.total.cost_eur)
                : null,
          }
        : null,
    semantics: ENERGY_SEMANTICS,
  };
}

// buildUsageContextFacts(period, dateKey, data, now): the three
// section fact sets of the usage_context caller. `data` carries the
// query results for the anchored window: breakdown (getUsageBreakdown),
// priceRows (dbHourlyPrices) and, for a complete period, previous
// (the previous period's getUsageBreakdown, fetched over
// previousPeriodWindow). An invalid anchor or a window without data
// nulls the sections - honest absence, never an empty fact set.
export function buildUsageContextFacts(period, dateKey, data = {}, now = new Date()) {
  const window = anchorWindow(period, dateKey);
  if (window === null) {
    return {
      widget: "usage_context",
      period,
      date: dateKey,
      day_status: null,
      so_far: false,
      window: null,
      breakdown: null,
      rest_of_home: null,
      over_time: null,
    };
  }
  const status = dayStatus(window.keys, now);
  const breakdown = data.breakdown ?? null;
  return {
    widget: "usage_context",
    period,
    date: dateKey,
    day_status: status,
    so_far: status === "in_progress",
    window: windowFacts(window),
    breakdown: breakdownSection(breakdown),
    rest_of_home: restOfHomeSection(breakdown),
    over_time: overTimeSection(breakdown, data.priceRows, data.previous, status),
  };
}

// ---- heat_context: the Heat page's three section boxes ----

// The gas day-coverage caveat, served as a fact (the same note the
// heat gas endpoint's meta carries): the gas day totals miss roughly
// the first half hour after midnight.
export const GAS_MIDNIGHT_COVERAGE_NOTE =
  "Gas day totals miss roughly the first half hour after midnight";

// The gas section: m3, cost, price per m3 (null when unknown, never
// zero), the unknown-price flag and the midnight-coverage note.
// `data.gas` carries the getGasUsage totals plus the last known gas
// price on or before the period's end day (price_eur_per_m3).
function gasSection(gas) {
  if (!gas?.totals) {
    return null;
  }
  const unknownPrice = gas.totals.hasUnknownPrice === true;
  return {
    m3: gas.totals.m3,
    eur: unknownPrice ? null : gas.totals.cost_eur,
    price_eur_per_m3: unknownPrice ? null : gas.price_eur_per_m3 ?? null,
    unknown_price: unknownPrice,
    midnight_coverage_note: GAS_MIDNIGHT_COVERAGE_NOTE,
  };
}

// One zone's facts: the period average and the current temperature
// with the setpoint summary, and the heating intervals - count and
// total duration, always flagged inferred, with the server-owned
// parity note: inferred from setpoint gaps, not measured heat
// demand (contract section 11).
function zoneFacts(zone) {
  const series = zone.series ?? [];
  const temps = series
    .map((point) => point.temp)
    .filter((temp) => Number.isFinite(temp));
  const setpoints = series
    .map((point) => point.setpoint)
    .filter((setpoint) => setpoint !== null && Number.isFinite(setpoint));
  const intervals = zone.heatingIntervals ?? [];
  const totalHours = round1(
    intervals.reduce((sum, interval) => {
      const from = new Date(interval.from).getTime();
      const to = new Date(interval.to).getTime();
      return sum + Math.max(0, to - from) / 3_600_000;
    }, 0)
  );
  const current = series.length > 0 ? series[series.length - 1] : null;
  return {
    key: zone.key,
    name: zone.name,
    avg_temp_c: temps.length > 0 ? round1(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
    current_temp_c: current !== null && Number.isFinite(current.temp) ? current.temp : null,
    setpoint_avg_c:
      setpoints.length > 0
        ? round1(setpoints.reduce((a, b) => a + b, 0) / setpoints.length)
        : null,
    heating: {
      count: intervals.length,
      total_hours: totalHours,
      inferred: true,
      inference_note: "Inferred from setpoint gaps, not measured heat demand.",
    },
  };
}

// The zones section: per-zone facts, the outdoor average, and the
// warmest and coolest zone by period average temperature.
function zonesSection(zonesData) {
  if (!zonesData?.zones) {
    return null;
  }
  const zones = zonesData.zones.map(zoneFacts);
  const outdoorTemps = (zonesData.outdoor?.series ?? [])
    .map((point) => point.temp)
    .filter((temp) => Number.isFinite(temp));
  const withAvg = zones.filter((zone) => zone.avg_temp_c !== null);
  const warmest =
    withAvg.length > 0
      ? withAvg.reduce((a, b) => (b.avg_temp_c > a.avg_temp_c ? b : a))
      : null;
  const coolest =
    withAvg.length > 0
      ? withAvg.reduce((a, b) => (b.avg_temp_c < a.avg_temp_c ? b : a))
      : null;
  return {
    zones,
    outdoor_avg_c:
      outdoorTemps.length > 0
        ? round1(outdoorTemps.reduce((a, b) => a + b, 0) / outdoorTemps.length)
        : null,
    warmest_zone:
      warmest === null
        ? null
        : { name: warmest.name, avg_temp_c: warmest.avg_temp_c },
    coolest_zone:
      coolest === null
        ? null
        : { name: coolest.name, avg_temp_c: coolest.avg_temp_c },
  };
}

// The heating_cost section: EUR per kWh of heat on the gas route
// versus the heat pump estimate (class estimated), the assumption
// fields (calorific value, boiler efficiency, COP at the average
// outdoor temperature, average electricity price), and the verdict:
// "gas_cheaper" or "hp_cheaper" when both sides are computable, null
// when either side is not.
function heatingCostSection(model) {
  if (!model?.gas_route || !model?.heat_pump_route) {
    return null;
  }
  const gasEur = model.gas_route.cost_per_kwh_heat ?? null;
  const hpEur = model.heat_pump_route.cost_per_kwh_heat ?? null;
  let verdict = null;
  if (gasEur !== null && hpEur !== null) {
    verdict = gasEur <= hpEur ? "gas_cheaper" : "hp_cheaper";
  }
  return {
    gas_eur_per_kwh_heat: gasEur,
    heat_pump_eur_per_kwh_heat: hpEur,
    heat_pump_class: "estimated",
    assumptions: {
      calorific_kwh_per_m3: model.assumptions?.gas_calorific_kwh_per_m3 ?? null,
      boiler_efficiency: model.assumptions?.boiler_efficiency ?? null,
      cop_at_avg_outdoor_temp: model.heat_pump_route.avg_cop ?? null,
      avg_electricity_price_eur_per_kwh:
        model.heat_pump_route.avg_electricity_price_eur_per_kwh ?? null,
      avg_outdoor_temp_c: model.heat_pump_route.avg_outdoor_temp ?? null,
    },
    verdict,
  };
}

// buildHeatContextFacts(period, dateKey, data, now): the three
// section fact sets of the heat_context caller. `data` carries the
// query results for the anchored window: gas (the getGasUsage totals
// plus the period's last known gas price), zones (getHeatZones) and
// heat_model (getHeatModel).
export function buildHeatContextFacts(period, dateKey, data = {}, now = new Date()) {
  const window = anchorWindow(period, dateKey);
  if (window === null) {
    return {
      widget: "heat_context",
      period,
      date: dateKey,
      day_status: null,
      so_far: false,
      window: null,
      gas: null,
      zones: null,
      heating_cost: null,
    };
  }
  const status = dayStatus(window.keys, now);
  return {
    widget: "heat_context",
    period,
    date: dateKey,
    day_status: status,
    so_far: status === "in_progress",
    window: windowFacts(window),
    gas: gasSection(data.gas),
    zones: zonesSection(data.zones),
    heating_cost: heatingCostSection(data.heat_model),
  };
}

// ---- solar_production: the Solar production box ----

// The Anker night-export caveat, served as a fact: the export
// counter is the P1 meter's total export, battery discharge
// included, so export in the dark hours can be the Anker battery
// feeding the grid, not solar production.
export const NIGHT_EXPORT_CAVEAT =
  "Export in the dark hours can be the home battery discharging to the grid, not solar; the export counter counts both.";

// buildSolarProductionFacts(data, now): the solar_production box's
// fact set, anchored on today. `data` carries today's query results:
// today (getRangeMetrics over [local midnight, now)) for the export
// and self-consumption figures, pv_today_kwh (getPvTodayKwh) as a
// fallback production source, and weather_today (the weather daily
// row for today) for the whole-day forecast, the score and the
// condition fact served from the weather source. The actual figure
// is a so-far day total; the forecast is a whole-day total; live
// watts are never part of the fact set.
export function buildSolarProductionFacts(data = {}, now = new Date()) {
  const todayKey = localDateKey(now);
  const today = data.today ?? null;
  const weatherToday = data.weather_today ?? null;
  const actualKwh = today?.pv_kwh ?? data.pv_today_kwh ?? null;
  return {
    widget: "solar_production",
    date: todayKey,
    day_status: "in_progress",
    so_far: true,
    actual_kwh: actualKwh,
    forecast_kwh: weatherToday?.estimated_kwh ?? null,
    solar_score: weatherToday?.solar_score ?? null,
    condition:
      weatherToday?.weather_code === null ||
      weatherToday?.weather_code === undefined
        ? null
        : conditionSummary(weatherToday.weather_code),
    export_kwh: today?.export_kwh ?? null,
    export_eur: today?.export_credit_eur ?? null,
    self_consumption_pct: today?.self_consumption_pct ?? null,
    night_export_caveat: NIGHT_EXPORT_CAVEAT,
    semantics: {
      energy: ENERGY_SEMANTICS,
      forecast: "Forecast figures are whole-period totals, never later or still to come.",
      actual: "The actual figure is the day total so far, not a full-day figure.",
    },
  };
}
