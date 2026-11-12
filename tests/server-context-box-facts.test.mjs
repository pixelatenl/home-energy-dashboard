import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHeatContextFacts,
  buildSolarProductionFacts,
  buildUsageContextFacts,
  GAS_MIDNIGHT_COVERAGE_NOTE,
  NIGHT_EXPORT_CAVEAT,
  previousPeriodWindow,
} from "../server/context-box-facts.mjs";
import { localDayStartUtcMs } from "../server/time.mjs";

// The context-box fact builders (contract section 11): pure, data
// in, facts out. Null encodings, day_status, the verdict and the
// DST-safe anchoring are pinned here.

// A fixed "now": mid-day local Amsterdam time on a Monday in November.
const NOW = new Date("2026-11-16T12:00:00+01:00");
const TODAY_KEY = "2026-11-16";

// A getUsageBreakdown-shaped fixture for one day: two measured
// categories, the heat pump estimate, the remainder, the home model
// and an hourly slot series.
function usageBreakdownFixture() {
  const dayStart = localDayStartUtcMs(TODAY_KEY);
  const series = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const tsMs = dayStart + hour * 3_600_000;
    const kwh = hour === 18 ? 3.2 : 0.2;
    const price = hour === 18 ? 0.45 : hour === 3 ? 0.1 : 0.3;
    series.push({
      ts: new Date(tsMs).toISOString(),
      kwh,
      price_eur: price,
      cost_eur: Math.round(kwh * price * 100) / 100,
      categories: [],
    });
  }
  return {
    total: { kwh: 10, cost_eur: 3.5 },
    categories: [
      { key: "dishwasher", label: "Dishwasher", class: "measured", entities: ["sensor.kitchen_dishwasher_cumulative_energy"], kwh: 2, cost_eur: 0.6 },
      { key: "heat_pump", label: "Heat pump", class: "Est.", entities: [], kwh: 3, cost_eur: 0.9 },
      { key: "remainder", label: "Remainder", class: "remainder", entities: [], kwh: 5, cost_eur: 1.5 },
    ],
    split: { measured_kwh: 2, estimated_kwh: 3, remainder_kwh: 5, measured_cost_eur: 0.6, estimated_cost_eur: 0.9, remainder_cost_eur: 1.5 },
    avg_price_eur: 0.35,
    home_model: {
      days: 1,
      entries: [
        { key: "base_load", name: "Base load", derived: true, kwh_per_day: 1, basis: "data-derived per day: the median of the day's lowest quiet-hour values", kwh: 1 },
        { key: "lighting", name: "Lighting", kwh_per_day: 1.1, basis: "evening use of the 36 Hue lights", kwh: 1.1 },
      ],
      modeled_kwh: 2.1,
      unexplained_kwh: 2.9,
    },
    slots: { unit: "hour", series },
  };
}

function priceRowsFixture() {
  const dayStart = localDayStartUtcMs(TODAY_KEY);
  const rows = [];
  for (let hour = 0; hour < 24; hour += 1) {
    rows.push({
      ts: new Date(dayStart + hour * 3_600_000),
      price_eur: hour === 18 ? 0.45 : hour === 3 ? 0.1 : 0.3,
    });
  }
  return rows;
}

describe("buildUsageContextFacts", () => {
  it("builds the three section fact sets with kWh and EUR on every energy figure", () => {
    const facts = buildUsageContextFacts("day", TODAY_KEY, { breakdown: usageBreakdownFixture(), priceRows: priceRowsFixture() }, NOW);
    assert.equal(facts.widget, "usage_context");
    assert.equal(facts.day_status, "in_progress");
    assert.equal(facts.so_far, true);
    assert.ok(facts.breakdown);
    assert.ok(facts.rest_of_home);
    assert.ok(facts.over_time);
    for (const category of facts.breakdown.categories) {
      assert.ok("kwh" in category && "eur" in category);
    }
  });

  it("marks measured categories measured and the heat pump estimated, with shares", () => {
    const facts = buildUsageContextFacts("day", TODAY_KEY, { breakdown: usageBreakdownFixture() }, NOW);
    const byName = new Map(facts.breakdown.categories.map((c) => [c.name, c]));
    assert.equal(byName.get("Dishwasher").class, "measured");
    assert.equal(byName.get("Dishwasher").share_pct, 20);
    assert.equal(byName.get("Heat pump").class, "estimated");
    assert.equal(byName.get("Heat pump").kwh, 3);
    assert.equal(byName.get("Heat pump").eur, 0.9);
    // The remainder is not a breakdown category; it lives in rest_of_home.
    assert.equal(byName.has("Remainder"), false);
    assert.equal(facts.breakdown.measured_share_pct, 20);
  });

  it("builds rest_of_home with the derived baseload, the model entries and the framing fact", () => {
    const facts = buildUsageContextFacts("day", TODAY_KEY, { breakdown: usageBreakdownFixture() }, NOW);
    const rest = facts.rest_of_home;
    const byKey = new Map(rest.entries.map((e) => [e.key, e]));
    assert.equal(byKey.get("base_load").class, "derived");
    assert.match(byKey.get("base_load").basis, /data-derived/);
    assert.equal(byKey.get("lighting").class, "model");
    // Flat-costed at the window average: 1.1 kWh at EUR 0.35.
    assert.equal(byKey.get("lighting").eur, 0.39);
    assert.equal(rest.unexplained_kwh, 2.9);
    assert.match(rest.unexplained_framing, /real usage of unnamed appliances, not an error/);
  });

  it("builds over_time with slot labels, the peak slot, the expensive-hours share and price stats", () => {
    const facts = buildUsageContextFacts("day", TODAY_KEY, { breakdown: usageBreakdownFixture(), priceRows: priceRowsFixture() }, NOW);
    const over = facts.over_time;
    assert.equal(over.unit, "hour");
    assert.equal(over.slots.length, 24);
    assert.equal(over.peak_slot.label, "18:00");
    assert.equal(over.peak_slot.kwh, 3.2);
    // The three highest-priced slots: 18:00 (0.45) plus 22 slots at 0.30
    // before 03:00 (0.10); top three by price are 18:00 and the two
    // first 0.30 slots (00:00, 01:00).
    const totalKwh = over.slots.reduce((sum, s) => sum + s.kwh, 0);
    const expected = Math.round(((3.2 + 0.2 + 0.2) / totalKwh) * 100);
    assert.equal(over.most_expensive_hours_share_pct, expected);
    assert.equal(over.price_stats.max_eur, 0.45);
    assert.equal(over.price_stats.min_eur, 0.1);
    assert.equal(over.price_stats.peak_label, "18:00");
    assert.ok(over.price_stats.average_eur > 0);
  });

  it("compares with the previous period only when the anchored period is complete", () => {
    const previous = { total: { kwh: 8, cost_eur: 2.8 } };
    const complete = buildUsageContextFacts("day", "2026-11-10", { breakdown: usageBreakdownFixture(), priceRows: priceRowsFixture(), previous }, NOW);
    assert.equal(complete.day_status, "complete");
    assert.equal(complete.so_far, false);
    assert.deepEqual(complete.over_time.comparison, {
      previous_kwh: 8,
      previous_eur: 2.8,
      delta_kwh: 2,
      delta_eur: 0.7,
    });
    const inProgress = buildUsageContextFacts("day", TODAY_KEY, { breakdown: usageBreakdownFixture(), previous }, NOW);
    assert.equal(inProgress.over_time.comparison, null);
  });

  it("nulls the sections for a period without data, never an empty fact set", () => {
    const empty = buildUsageContextFacts("day", TODAY_KEY, {}, NOW);
    assert.equal(empty.breakdown, null);
    assert.equal(empty.rest_of_home, null);
    assert.equal(empty.over_time, null);
    const zero = buildUsageContextFacts("day", TODAY_KEY, { breakdown: { ...usageBreakdownFixture(), total: { kwh: 0, cost_eur: null } } }, NOW);
    assert.equal(zero.breakdown, null);
    assert.equal(zero.rest_of_home, null);
  });

  it("nulls everything for an invalid anchor", () => {
    const facts = buildUsageContextFacts("day", "2026-02-31", {}, NOW);
    assert.equal(facts.day_status, null);
    assert.equal(facts.window, null);
    assert.equal(facts.breakdown, null);
    assert.equal(facts.over_time, null);
    assert.equal(buildUsageContextFacts("decade", TODAY_KEY, {}, NOW).breakdown, null);
  });

  it("anchors the window DST-safely: 25 hours on the fall-back day, 23 on spring-forward", () => {
    const fallBack = buildUsageContextFacts("day", "2026-10-25", {}, NOW);
    const springForward = buildUsageContextFacts("day", "2026-03-29", {}, NOW);
    const span = (facts) => new Date(facts.window.end) - new Date(facts.window.start);
    assert.equal(span(fallBack), 25 * 3_600_000);
    assert.equal(span(springForward), 23 * 3_600_000);
  });

  it("aligns the previous period on the same length via previousPeriodWindow", () => {
    const prev = previousPeriodWindow("day", "2026-10-26");
    // The previous day of 2026-10-26 is the 25-hour fall-back day.
    assert.equal(prev.fromMs, localDayStartUtcMs("2026-10-25"));
    assert.equal(prev.toMs, localDayStartUtcMs("2026-10-26"));
    assert.equal(prev.toMs - prev.fromMs, 25 * 3_600_000);
    const prevMonth = previousPeriodWindow("month", "2026-11-16");
    assert.equal(prevMonth.fromMs, localDayStartUtcMs("2026-10-01"));
    assert.equal(prevMonth.toMs, localDayStartUtcMs("2026-11-01"));
    assert.equal(previousPeriodWindow("day", "2026-02-31"), null);
  });
});

// A getGasUsage-shaped fixture plus the period's last known price.
function gasFixture({ unknown = false } = {}) {
  return {
    totals: { m3: 4.5, cost_eur: unknown ? 0 : 9.0, hasUnknownPrice: unknown },
    price_eur_per_m3: unknown ? null : 2.0,
  };
}

// A getHeatZones-shaped fixture: two zones with series and intervals.
function zonesFixture() {
  const base = localDayStartUtcMs(TODAY_KEY);
  const point = (hour, temp, setpoint) => ({
    ts: new Date(base + hour * 3_600_000).toISOString(),
    temp,
    setpoint,
  });
  return {
    zones: [
      {
        key: "living",
        name: "Living room",
        series: [point(0, 19.5, 20), point(1, 19.8, 20), point(2, 20.1, 20)],
        heatingIntervals: [
          {
            from: new Date(base).toISOString(),
            to: new Date(base + 2 * 3_600_000).toISOString(),
          },
        ],
      },
      {
        key: "bedroom",
        name: "Bedroom",
        series: [point(0, 17.5, 18), point(1, 17.8, 18)],
        heatingIntervals: [],
      },
    ],
    outdoor: {
      series: [
        { ts: new Date(base).toISOString(), temp: 7.0 },
        { ts: new Date(base + 3_600_000).toISOString(), temp: 8.0 },
      ],
    },
  };
}

function heatModelFixture({ gas = 0.05, hp = 0.09 } = {}) {
  return {
    gas_route: {
      cost_per_kwh_heat: gas,
      price_eur_per_m3: 2.0,
      calorific_kwh_per_m3: 9.9,
      boiler_efficiency: 0.9,
    },
    heat_pump_route: {
      cost_per_kwh_heat: hp,
      avg_electricity_price_eur_per_kwh: 0.28,
      avg_cop: 3.1,
      avg_outdoor_temp: 7.5,
    },
    assumptions: {
      gas_calorific_kwh_per_m3: 9.9,
      boiler_efficiency: 0.9,
      cop_at_7c: 3.0,
      cop_at_minus_7c: 2.2,
    },
  };
}

describe("buildHeatContextFacts", () => {
  it("builds the gas section with m3, cost, price and the midnight-coverage note as a fact", () => {
    const facts = buildHeatContextFacts("day", TODAY_KEY, { gas: gasFixture() }, NOW);
    assert.equal(facts.widget, "heat_context");
    assert.equal(facts.gas.m3, 4.5);
    assert.equal(facts.gas.eur, 9.0);
    assert.equal(facts.gas.price_eur_per_m3, 2.0);
    assert.equal(facts.gas.unknown_price, false);
    assert.equal(facts.gas.midnight_coverage_note, GAS_MIDNIGHT_COVERAGE_NOTE);
  });

  it("nulls the gas price when unknown, never zero, and flags it", () => {
    const facts = buildHeatContextFacts("day", TODAY_KEY, { gas: gasFixture({ unknown: true }) }, NOW);
    assert.equal(facts.gas.price_eur_per_m3, null);
    assert.equal(facts.gas.eur, null);
    assert.equal(facts.gas.unknown_price, true);
    assert.equal(facts.gas.m3, 4.5);
  });

  it("nulls the gas section without data", () => {
    const facts = buildHeatContextFacts("day", TODAY_KEY, {}, NOW);
    assert.equal(facts.gas, null);
    assert.equal(facts.zones, null);
    assert.equal(facts.heating_cost, null);
  });

  it("builds the zones section with per-zone facts, inferred heating intervals and outdoor average", () => {
    const facts = buildHeatContextFacts("day", TODAY_KEY, { zones: zonesFixture() }, NOW);
    const zones = facts.zones;
    assert.equal(zones.zones.length, 2);
    const living = zones.zones[0];
    assert.equal(living.avg_temp_c, 19.8);
    assert.equal(living.current_temp_c, 20.1);
    assert.equal(living.setpoint_avg_c, 20);
    assert.deepEqual(living.heating, {
      count: 1,
      total_hours: 2,
      inferred: true,
      inference_note: "Inferred from setpoint gaps, not measured heat demand.",
    });
    assert.equal(zones.zones[1].heating.count, 0);
    assert.equal(zones.outdoor_avg_c, 7.5);
    assert.deepEqual(zones.warmest_zone, { name: "Living room", avg_temp_c: 19.8 });
    assert.deepEqual(zones.coolest_zone, { name: "Bedroom", avg_temp_c: 17.7 });
  });

  it("builds heating_cost with both routes, the assumptions and the verdict", () => {
    const facts = buildHeatContextFacts("day", TODAY_KEY, { heat_model: heatModelFixture({ gas: 0.05, hp: 0.09 }) }, NOW);
    const cost = facts.heating_cost;
    assert.equal(cost.gas_eur_per_kwh_heat, 0.05);
    assert.equal(cost.heat_pump_eur_per_kwh_heat, 0.09);
    assert.equal(cost.heat_pump_class, "estimated");
    assert.equal(cost.assumptions.calorific_kwh_per_m3, 9.9);
    assert.equal(cost.assumptions.boiler_efficiency, 0.9);
    assert.equal(cost.assumptions.cop_at_avg_outdoor_temp, 3.1);
    assert.equal(cost.assumptions.avg_electricity_price_eur_per_kwh, 0.28);
    assert.equal(cost.verdict, "gas_cheaper");
  });

  it("verdicts hp_cheaper when the heat pump route is cheaper, null when a side is not computable", () => {
    const hp = buildHeatContextFacts("day", TODAY_KEY, { heat_model: heatModelFixture({ gas: 0.09, hp: 0.05 }) }, NOW);
    assert.equal(hp.heating_cost.verdict, "hp_cheaper");
    const missing = buildHeatContextFacts("day", TODAY_KEY, { heat_model: heatModelFixture({ hp: null }) }, NOW);
    assert.equal(missing.heating_cost.verdict, null);
    assert.equal(missing.heating_cost.heat_pump_eur_per_kwh_heat, null);
  });
});

describe("buildSolarProductionFacts", () => {
  const solarData = {
    today: { pv_kwh: 8.6, export_kwh: 2.1, export_credit_eur: 0.5, self_consumption_pct: 75.6 },
    weather_today: { estimated_kwh: 14.4, solar_score: 28, weather_code: 61 },
  };

  it("builds the today-anchored fact set with so-far actual and whole-day forecast", () => {
    const facts = buildSolarProductionFacts(solarData, NOW);
    assert.equal(facts.widget, "solar_production");
    assert.equal(facts.date, TODAY_KEY);
    assert.equal(facts.day_status, "in_progress");
    assert.equal(facts.so_far, true);
    assert.equal(facts.actual_kwh, 8.6);
    assert.equal(facts.forecast_kwh, 14.4);
    assert.equal(facts.solar_score, 28);
    assert.equal(facts.export_kwh, 2.1);
    assert.equal(facts.export_eur, 0.5);
    assert.equal(facts.self_consumption_pct, 75.6);
  });

  it("serves the condition fact from the weather source", () => {
    const facts = buildSolarProductionFacts(solarData, NOW);
    assert.equal(facts.condition, "rain");
    const clear = buildSolarProductionFacts(
      { weather_today: { estimated_kwh: 20, solar_score: 80, weather_code: 0 } },
      NOW
    );
    assert.equal(clear.condition, "clear");
  });

  it("carries the Anker night-export caveat and never a live-power field", () => {
    const facts = buildSolarProductionFacts(solarData, NOW);
    assert.equal(facts.night_export_caveat, NIGHT_EXPORT_CAVEAT);
    assert.match(facts.night_export_caveat, /battery/);
    assert.equal(
      Object.keys(facts).some((key) => /watt|power/i.test(key)),
      false
    );
    assert.match(facts.semantics.energy, /never live power/);
    assert.match(facts.semantics.forecast, /whole-period totals/);
  });

  it("nulls the figures when the sources are missing", () => {
    const facts = buildSolarProductionFacts({}, NOW);
    assert.equal(facts.actual_kwh, null);
    assert.equal(facts.forecast_kwh, null);
    assert.equal(facts.solar_score, null);
    assert.equal(facts.condition, null);
    assert.equal(facts.export_kwh, null);
    assert.equal(facts.export_eur, null);
    assert.equal(facts.self_consumption_pct, null);
    // The caveat and semantics stay: they are facts about the data, not data.
    assert.equal(facts.night_export_caveat, NIGHT_EXPORT_CAVEAT);
  });

  it("falls back to pv_today_kwh when the range metrics carry no PV figure", () => {
    const facts = buildSolarProductionFacts({ pv_today_kwh: 4.2, today: { pv_kwh: null } }, NOW);
    assert.equal(facts.actual_kwh, 4.2);
  });
});
