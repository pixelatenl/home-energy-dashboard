import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAdvisoryFacts } from "../server/facts.mjs";
import { buildSections } from "../server/advisory/advisory-core.mjs";
import { localDateKey, localHourIndex, nextDateKey } from "../server/time.mjs";

// The facts layer (server/facts.mjs): the existing builders' outputs
// shaped into the advisory core's facts object (contract section 3),
// with every thin input null - never a guess. The database-backed pulls
// (today's priced battery flow, tomorrow's hourly curve) are injected
// loaders, so the mapping is tested without touching the database.

// A fixed future window keeps the guidance practical at any hour of any
// run day (the same convention as the context builder tests); the weather
// days are relative to the real today so the outlook picks them up.
const todayKey = localDateKey(new Date());
const tomorrowKey = nextDateKey(todayKey, 1);
const fridayKey = nextDateKey(todayKey, 3);

function snapshotFixture({
  pvKwh = 10,
  exportKwh = 3,
  usageKwh = 14,
  costEur = 2.4,
  soc = 72,
  batteryState = "charging",
  chargedKwh = 4.3,
  dischargedKwh = 2.4,
  tomorrowAvailable = false,
  arbitrageEur = 1.23,
  loaderError = false,
} = {}) {
  return {
    summary: {
      today: {
        pv_kwh: pvKwh,
        export_kwh: exportKwh,
        total_usage_kwh: usageKwh,
        cost_eur: costEur,
        battery_charged_kwh: chargedKwh,
        battery_discharged_kwh: dischargedKwh,
      },
      battery_soc_pct: soc,
      battery_state: batteryState,
    },
    weatherDaily: [
      { date: todayKey, estimated_kwh: 14.4, solar_score: 40, weather_code: 1 },
      {
        date: tomorrowKey,
        estimated_kwh: 11.99,
        solar_score: 28,
        weather_code: 1,
      },
      {
        date: fridayKey,
        estimated_kwh: 1.2,
        solar_score: 5,
        weather_code: 61,
      },
    ],
    priceParts: {
      priceData: {
        today: {
          average: 0.36,
          min: 0.25,
          max: 0.5,
          low_hour: "12:00",
          peak_hour: "19:00",
        },
        tomorrow: tomorrowAvailable
          ? { available: true, average: 0.28, min: 0.2, max: 0.4 }
          : null,
      },
      tomorrowPricesAvailable: tomorrowAvailable,
      cheapestByDay: {
        today: {
          start: "2027-06-15T12:00:00+02:00",
          end: "2027-06-15T15:00:00+02:00",
          average_price: 0.25,
        },
        tomorrow: tomorrowAvailable
          ? {
              start: "2027-06-16T17:00:00+02:00",
              end: "2027-06-16T20:00:00+02:00",
              average_price: 0.2,
            }
          : null,
      },
      dayCheapestWindow: {
        start: `${todayKey}T09:00:00+02:00`,
        end: `${todayKey}T12:00:00+02:00`,
        average_price: 0.24,
      },
      remainingAverageEur: 0.35,
    },
    extras: {
      co2Intensity: 133,
      candidates: [
        {
          label: "Dishwasher",
          load_kwh: 1.07,
          window: "12:00-15:00 today",
          saving_eur: 0.12,
          below_threshold: false,
          basis: "a candidate basis line",
        },
        {
          label: "Battery recharge",
          load_kwh: 2.4,
          window: "12:00-15:00 today",
          saving_eur: 0.02,
          below_threshold: true,
          basis: "another basis line",
        },
      ],
    },
    loaders: {
      batteryArbitrageEur: loaderError
        ? async () => {
            throw new Error("database unreachable");
          }
        : async () => arbitrageEur,
      tomorrowHourlyPrices: async () => [0.36, 0.35, 0.34],
    },
  };
}

describe("buildAdvisoryFacts: the contract facts shape", () => {
  it("shapes the builders' outputs into the core's facts object", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    assert.deepEqual(facts.lowPrice, { timestamp: "12:00", price: 0.25 });
    assert.deepEqual(facts.peakPrice, { timestamp: "19:00", price: 0.5 });
    assert.deepEqual(facts.battery, {
      socPct: 72,
      state: "charging",
      todayInKwh: 4.3,
      todayOutKwh: 2.4,
    });
    assert.equal(facts.dayAverageEur, 0.36);
    assert.deepEqual(facts.cheapestWindow, {
      start: "12:00",
      end: "15:00",
      averageEur: 0.25,
    });
    assert.equal(facts.spreadPerKwhEur, 0.25);
    assert.equal(facts.practicalBenefitEur, 0.11);
    assert.equal(facts.co2IntensityGPerKwh, 133);
    assert.deepEqual(facts.solarToday, { actualKwh: 10, forecastKwh: 14.4 });
    assert.deepEqual(facts.candidates, [
      {
        label: "Dishwasher",
        kwh: 1.07,
        savingEur: 0.12,
        window: "12:00-15:00 today",
        worthwhile: true,
      },
      {
        label: "Battery recharge",
        kwh: 2.4,
        savingEur: 0.02,
        window: "12:00-15:00 today",
        worthwhile: false,
      },
    ]);
    assert.equal(facts.dayCheapestWindow, "09:00-12:00");
    // The passed flag follows the local clock against the window's end.
    assert.equal(
      facts.dayCheapestPassed,
      localHourIndex(new Date()) >= 12
    );
    assert.equal(facts.dayCheapestAverageEur, 0.24);
    assert.deepEqual(facts.remainingWindow, {
      start: "12:00",
      end: "15:00",
      averageEur: 0.25,
      practicalBenefitEur: 0.11,
    });
    assert.equal(facts.remainingAverageEur, 0.35);
    assert.equal(facts.dayUsageKwh, 14);
    assert.equal(facts.dayCostEur, 2.4);
  });

  it("computes the solar share with the hub's own method", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    // (10 kWh produced - 3 kWh exported) / 14 kWh usage = 50%.
    assert.equal(facts.solar_share_pct, 50);
  });

  it("carries today's battery result from the arbitrage loader", async () => {
    const { loaders, ...snapshot } = snapshotFixture({ arbitrageEur: 1.87 });
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    assert.equal(facts.battery_earned_eur, 1.87);
  });

  it("builds the tomorrow block from the advisory builder's output", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    assert.equal(facts.tomorrow.pricesPublished, false);
    assert.equal(facts.tomorrow.prices, null);
    assert.equal(facts.tomorrow.averageEur, null);
    assert.equal(facts.tomorrow.window, null);
    assert.equal(facts.tomorrow.solarKwh, 11.99);
    assert.equal(facts.tomorrow.solarScore, 28);
    assert.equal(facts.tomorrow.lowSolar, false);
    assert.equal(facts.tomorrow.compareSolarKwh, 14.4);
    assert.equal(facts.tomorrow.condition, "partly cloudy");
  });

  it("carries the published prices, average and window when tomorrow is out", async () => {
    const { loaders, ...snapshot } = snapshotFixture({
      tomorrowAvailable: true,
    });
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    assert.equal(facts.tomorrow.pricesPublished, true);
    assert.deepEqual(facts.tomorrow.prices, [0.36, 0.35, 0.34]);
    assert.equal(facts.tomorrow.averageEur, 0.28);
    assert.equal(facts.tomorrow.window, "17:00-20:00");
  });

  it("carries the outlook days as the coming days", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    assert.equal(facts.comingDays.length, 2);
    assert.deepEqual(facts.comingDays[0], {
      weekday: facts.comingDays[0].weekday,
      date: tomorrowKey,
      solarKwh: 11.99,
      solarScore: 28,
      condition: "partly cloudy",
    });
    assert.deepEqual(facts.comingDays[1], {
      weekday: facts.comingDays[1].weekday,
      date: fridayKey,
      solarKwh: 1.2,
      solarScore: 5,
      condition: "rain",
    });
  });

  it("feeds the core's section builder without any thin-input crash", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    const sections = buildSections(facts, "2026-10-20T15:30:00+02:00");
    const ids = sections.map((section) => section.id);
    assert.ok(ids.includes("today"));
    assert.ok(ids.includes("tomorrow"));
    assert.ok(ids.includes("coming_days"));
    const today = sections.find((section) => section.id === "today");
    assert.equal(today.mode, "plan");
    assert.equal(today.facts.candidate.label, "Dishwasher");
  });
});

describe("buildAdvisoryFacts: thin inputs to null", () => {
  it("nulls every price-derived fact without a price curve", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(
      { ...snapshot, priceParts: null },
      loaders
    );
    assert.equal(facts.lowPrice, null);
    assert.equal(facts.peakPrice, null);
    assert.equal(facts.cheapestWindow, null);
    assert.equal(facts.spreadPerKwhEur, null);
    assert.equal(facts.practicalBenefitEur, null);
    assert.equal(facts.dayCheapestWindow, null);
    assert.equal(facts.dayCheapestPassed, false);
    assert.equal(facts.dayCheapestAverageEur, null);
    assert.equal(facts.remainingWindow, null);
    assert.equal(facts.remainingAverageEur, null);
    assert.equal(facts.dayAverageEur, null);
  });

  it("nulls the tomorrow block when the advisory builder produced none", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(
      { ...snapshot, weatherDaily: null },
      loaders
    );
    assert.equal(facts.tomorrow, null);
    assert.deepEqual(facts.comingDays, []);
    assert.equal(facts.solarToday.actualKwh, 10);
    assert.equal(facts.solarToday.forecastKwh, null);
  });

  it("nulls the battery fact when the grounding builder nulls it", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(
      {
        ...snapshot,
        summary: {
          ...snapshot.summary,
          battery_soc_pct: null,
          battery_state: "idle",
        },
      },
      loaders
    );
    assert.equal(facts.battery, null);
  });

  it("nulls the solar share when the totals are thin", async () => {
    const { loaders, ...snapshot } = snapshotFixture({ pvKwh: null });
    assert.equal(
      (await buildAdvisoryFacts(snapshot, loaders)).solar_share_pct,
      null
    );
    const noUsage = snapshotFixture({ usageKwh: 0 });
    assert.equal(
      (await buildAdvisoryFacts(noUsage, noUsage.loaders)).solar_share_pct,
      null
    );
  });

  it("clamps the solar share to the usage it can cover", async () => {
    const { loaders, ...snapshot } = snapshotFixture({
      pvKwh: 20,
      exportKwh: 0,
      usageKwh: 5,
    });
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    assert.equal(facts.solar_share_pct, 100);
    const evening = snapshotFixture({ pvKwh: 2, exportKwh: 6, usageKwh: 14 });
    assert.equal(
      (await buildAdvisoryFacts(evening, evening.loaders)).solar_share_pct,
      0
    );
  });

  it("nulls the battery result when the loader fails", async () => {
    const { loaders, ...snapshot } = snapshotFixture({ loaderError: true });
    const facts = await buildAdvisoryFacts(snapshot, loaders);
    assert.equal(facts.battery_earned_eur, null);
  });

  it("nulls the recap day totals and co2 when the summary is thin", async () => {
    const { loaders, ...snapshot } = snapshotFixture();
    const facts = await buildAdvisoryFacts(
      { ...snapshot, summary: null, extras: {} },
      loaders
    );
    assert.equal(facts.battery, null);
    assert.deepEqual(facts.solarToday, { actualKwh: null, forecastKwh: 14.4 });
    assert.deepEqual(facts.candidates, []);
    assert.equal(facts.co2IntensityGPerKwh, null);
    assert.equal(facts.solar_share_pct, null);
    assert.equal(facts.dayUsageKwh, null);
    assert.equal(facts.dayCostEur, null);
  });
});
