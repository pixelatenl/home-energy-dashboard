import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdvisory,
  buildCandidates,
  buildGuidance,
} from "../server/context.mjs";
import { localDateKey, nextDateKey } from "../server/time.mjs";

// The practicality gate's named constants (docs/advisory-spec.md):
// EVENING_PIVOT_HOUR 18, PRACTICAL_MIN_HOURS 2,
// PRACTICAL_MIN_ADVANTAGE_EUR 0.05, GUIDANCE_MIN_SPREAD_EUR 0.03.
// Windows use fixed future dates so the tests are deterministic at
// any hour of any day: a future window keeps its full length, and the
// local Amsterdam hour of the fixed instant never moves.

function partsFixture({
  windowStart = "2027-06-15T12:00:00+02:00",
  windowEnd = "2027-06-15T15:00:00+02:00",
  windowAvg = 0.25,
  dayAverage = 0.36,
  dayMax = 0.5,
  dayWindow = null,
  peakHour = "08:00",
} = {}) {
  return {
    cheapestByDay: {
      today: {
        start: windowStart,
        end: windowEnd,
        average_price: windowAvg,
      },
    },
    priceData: {
      today: { average: dayAverage, max: dayMax, peak_hour: peakHour },
    },
    dayCheapestWindow: dayWindow,
  };
}

describe("buildGuidance: the practicality gate", () => {
  it("passes when every condition holds", () => {
    const g = buildGuidance(partsFixture());
    assert.notEqual(g, null);
    assert.equal(g.practical, true);
    assert.equal(g.window, "12:00-15:00 today");
  });

  it("fails when the window starts at the evening pivot hour", () => {
    const g = buildGuidance(
      partsFixture({
        windowStart: "2027-06-15T18:00:00+02:00",
        windowEnd: "2027-06-15T21:00:00+02:00",
      })
    );
    assert.equal(g.practical, false);
  });

  it("passes at the pivot boundary minus one hour", () => {
    const g = buildGuidance(
      partsFixture({
        windowStart: "2027-06-15T17:00:00+02:00",
        windowEnd: "2027-06-15T20:00:00+02:00",
      })
    );
    assert.equal(g.practical, true);
  });

  it("fails below the minimum remaining hours", () => {
    const g = buildGuidance(
      partsFixture({ windowEnd: "2027-06-15T13:30:00+02:00" })
    );
    assert.equal(g.practical, false);
  });

  it("passes at exactly the minimum remaining hours", () => {
    const g = buildGuidance(
      partsFixture({ windowEnd: "2027-06-15T14:00:00+02:00" })
    );
    assert.equal(g.practical, true);
  });

  it("fails below the advantage threshold", () => {
    const g = buildGuidance(partsFixture({ dayAverage: 0.299 }));
    assert.equal(g.practical, false);
  });

  it("passes at exactly the advantage threshold", () => {
    const g = buildGuidance(partsFixture({ dayAverage: 0.3 }));
    assert.equal(g.practical, true);
  });

  it("returns null on a flat day below the spread threshold", () => {
    const g = buildGuidance(partsFixture({ dayMax: 0.279 }));
    assert.equal(g, null);
  });

  it("keeps a day at exactly the spread threshold", () => {
    const g = buildGuidance(partsFixture({ dayMax: 0.28 }));
    assert.notEqual(g, null);
    assert.equal(g.spread_per_kwh_eur, 0.03);
  });

  it("carries the whole-day cheapest window verbatim", () => {
    const g = buildGuidance(
      partsFixture({
        dayWindow: {
          start: "2027-06-15T09:00:00+02:00",
          end: "2027-06-15T12:00:00+02:00",
          average_price: 0.24,
        },
      })
    );
    assert.equal(g.day_cheapest_window, "09:00-12:00");
    assert.equal(g.day_cheapest_average_eur, 0.24);
  });

  it("nulls the whole-day window when the price data lacks it", () => {
    const g = buildGuidance(partsFixture());
    assert.equal(g.day_cheapest_window, null);
    assert.equal(g.day_cheapest_average_eur, null);
  });

  it("exposes the gate inputs on the payload", () => {
    const g = buildGuidance(partsFixture());
    assert.equal(g.window_start_hour, 12);
    assert.equal(g.hours_remaining, 3);
    assert.equal(g.day_average_eur, 0.36);
    assert.equal(g.cheapest_window_average_eur, 0.25);
  });
});

function candidatesFixture(applianceRows, summary, priceRows = []) {
  const priceParts = {
    cheapestByDay: {
      today: {
        start: "2027-06-15T12:00:00+02:00",
        end: "2027-06-15T15:00:00+02:00",
        average_price: 0.2574,
      },
    },
  };
  return buildCandidates(applianceRows, summary ?? {}, priceParts, priceRows);
}

describe("buildCandidates: the candidate arithmetic", () => {
  it("includes an appliance at exactly the 0.5 kWh threshold", () => {
    const rows = [{ appliance: "Dishwasher", kwh: 0.5, cost_eur: 0.225 }];
    const candidates = candidatesFixture(rows);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].label, "Dishwasher");
  });

  it("excludes an appliance below the 0.5 kWh threshold", () => {
    const rows = [{ appliance: "Fridge", kwh: 0.49, cost_eur: 0.1 }];
    assert.deepEqual(candidatesFixture(rows), []);
  });

  it("excludes an appliance with no priced hours today", () => {
    const rows = [{ appliance: "Dryer", kwh: 1.2, cost_eur: 0 }];
    assert.deepEqual(candidatesFixture(rows), []);
  });

  it("computes the exact saving at four decimals", () => {
    // 0.59 kWh at 0.45 average (cost 0.2655) versus 0.2574 in the
    // window: 0.59 x 0.1926 = 0.113634 -> 0.1136.
    const rows = [{ appliance: "Dishwasher", kwh: 0.59, cost_eur: 0.2655 }];
    const [candidate] = candidatesFixture(rows);
    assert.equal(candidate.saving_eur, 0.1136);
    assert.equal(candidate.load_kwh, 0.59);
    assert.equal(candidate.below_threshold, false);
  });

  it("marks a saving just below the 0.05 EUR threshold", () => {
    const rows = [
      { appliance: "Pond pump", kwh: 1, cost_eur: 0.3073 },
    ];
    const [candidate] = candidatesFixture(rows);
    assert.equal(candidate.saving_eur, 0.0499);
    assert.equal(candidate.below_threshold, true);
  });

  it("keeps a saving at exactly the threshold above it", () => {
    const rows = [{ appliance: "Pond pump", kwh: 1, cost_eur: 0.3074 }];
    const [candidate] = candidatesFixture(rows);
    assert.equal(candidate.saving_eur, 0.05);
    assert.equal(candidate.below_threshold, false);
  });

  it("carries the appliance name in household register in the basis", () => {
    const rows = [
      { appliance: "Washing machine energy", kwh: 0.9, cost_eur: 0.405 },
    ];
    const [candidate] = candidatesFixture(rows);
    assert.match(candidate.basis, /^your washing machine used 0\.9 kWh/);
    assert.match(candidate.basis, /at an average of EUR 0\.45\/kWh/);
    assert.match(candidate.basis, /versus EUR 0\.2574\/kWh/);
  });

  it("adds no battery candidate without discharge today", () => {
    const candidates = candidatesFixture([], {
      battery_flow_hourly: [{ ts: "2027-06-15T10:00:00.000Z", out_kwh: 0 }],
    });
    assert.deepEqual(candidates, []);
  });

  it("adds the battery candidate only on real discharge", () => {
    const priceRows = [
      { ts: new Date("2027-06-15T10:00:00.000Z"), price_eur: 0.5 },
      { ts: new Date("2027-06-15T09:00:00.000Z"), price_eur: 0.4 },
    ];
    const summary = {
      battery_flow_hourly: [
        { ts: "2027-06-15T10:00:00.000Z", out_kwh: 1.0 },
        { ts: "2027-06-15T09:00:00.000Z", out_kwh: 0.5 },
      ],
    };
    const [candidate] = candidatesFixture([], summary, priceRows);
    // Avoided 1.0 x 0.5 + 0.5 x 0.4 = 0.7; recharge 1.5 x 0.2574 =
    // 0.3861; saving 0.3139.
    assert.equal(candidate.label, "Battery recharge");
    assert.equal(candidate.saving_eur, 0.3139);
    assert.equal(candidate.load_kwh, 1.5);
    assert.match(candidate.basis, /^your battery discharged 1\.5 kWh today/);
  });
});

// The tomorrow row (C20): the advisory object always exists when the
// forecast carries tomorrow's expected solar; the prefer triggers
// (PRICE_DEARER_FACTOR 1.2, PRICE_CHEAPER_FACTOR 0.8,
// SOLAR_POORER_FACTOR 0.6, SOLAR_SUNNIER_FACTOR 1.4) decide the
// recommendation, not the row's existence.

function forecastFixture({
  todaySolar = 14.4,
  tomorrowSolar = 8.2,
  tomorrowScore = 55,
  following = [10],
} = {}) {
  const today = localDateKey(new Date());
  return [
    { date: today, estimated_kwh: todaySolar, solar_score: 50 },
    {
      date: nextDateKey(today, 1),
      estimated_kwh: tomorrowSolar,
      solar_score: tomorrowScore,
    },
    ...following.map((kwh, index) => ({
      date: nextDateKey(today, 2 + index),
      estimated_kwh: kwh,
      solar_score: 50,
    })),
  ];
}

function advisoryPriceParts({
  todayAvg = 0.3,
  tomorrowAvg = 0.32,
  tomorrowAvailable = true,
  dayAfterKnown = false,
} = {}) {
  return {
    priceData: {
      today: { average: todayAvg },
      tomorrow: tomorrowAvailable ? { average: tomorrowAvg } : undefined,
    },
    tomorrowPricesAvailable: tomorrowAvailable,
    dayAfterPricesAvailable: dayAfterKnown,
  };
}

describe("buildAdvisory: the tomorrow row", () => {
  it("returns null without any forecast data", () => {
    assert.equal(buildAdvisory(advisoryPriceParts(), []), null);
  });

  it("returns null when the forecast lacks tomorrow's row", () => {
    const today = localDateKey(new Date());
    const days = [
      { date: today, estimated_kwh: 14.4 },
      { date: nextDateKey(today, 2), estimated_kwh: 10 },
    ];
    assert.equal(buildAdvisory(advisoryPriceParts(), days), null);
  });

  it("always computes the row when no trigger fires", () => {
    const a = buildAdvisory(advisoryPriceParts(), forecastFixture());
    assert.notEqual(a, null);
    assert.equal(a.triggered, false);
    assert.equal(a.type, "advance");
    assert.equal(a.tomorrow_average_eur, 0.32);
    assert.equal(a.tomorrow_solar_kwh, 8.2);
    assert.equal(a.compare_day, "today");
    assert.equal(a.compare_solar_kwh, 14.4);
    assert.equal(a.price_difference_per_kwh, 0.02);
    assert.equal(a.horizon_note, null);
  });

  it("labels the horizon honestly when tomorrow's prices are unpublished", () => {
    const a = buildAdvisory(
      advisoryPriceParts({ tomorrowAvailable: false }),
      forecastFixture()
    );
    assert.equal(a.triggered, false);
    assert.equal(a.tomorrow_average_eur, null);
    assert.equal(
      a.horizon_note,
      "Grid prices for tomorrow are not yet published; a fuller comparison follows once they are available."
    );
  });

  it("keeps the defer trigger and its horizon note", () => {
    const a = buildAdvisory(
      advisoryPriceParts({ todayAvg: 0.24, tomorrowAvg: 0.38 }),
      forecastFixture()
    );
    assert.equal(a.triggered, true);
    assert.equal(a.type, "defer");
    assert.equal(a.compare_day, "today");
    assert.equal(
      a.horizon_note,
      "Cheapest day known so far is today at 0.24 average; the day after is not yet published"
    );
  });

  it("keeps the advance trigger without a horizon note", () => {
    const a = buildAdvisory(
      advisoryPriceParts({ todayAvg: 0.3, tomorrowAvg: 0.2 }),
      forecastFixture()
    );
    assert.equal(a.triggered, true);
    assert.equal(a.type, "advance");
    assert.equal(a.horizon_note, null);
  });

  it("fires the solar defer trigger on a far sunnier following day", () => {
    const a = buildAdvisory(
      advisoryPriceParts({ tomorrowAvailable: false }),
      forecastFixture({ tomorrowSolar: 4, following: [15] })
    );
    assert.equal(a.triggered, true);
    assert.equal(a.type, "defer");
    assert.equal(a.compare_solar_kwh, 15);
  });
});

// The Phase E today modes: the peak-avoidance flag (strictly ahead of
// the current hour), the passed-hours honesty, the remaining-evening
// average pass-through and the cross-day delay comparison
// (DELAY_MIN_ADVANTAGE_EUR 0.05). Time-relative fixtures are computed
// against the current hour so the tests are deterministic at any
// time of day.

import { localHourIndex } from "../server/time.mjs";
import { buildOutlook } from "../server/context.mjs";

function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

describe("buildGuidance: the Phase E today modes", () => {
  const nowHour = localHourIndex(new Date());

  it("flags the peak ahead only while its hour is still to come", () => {
    const ahead = buildGuidance(
      partsFixture({ peakHour: hourLabel((nowHour + 2) % 24) })
    );
    assert.equal(ahead.peak_ahead, true);
    const current = buildGuidance(
      partsFixture({ peakHour: hourLabel(nowHour) })
    );
    assert.equal(current.peak_ahead, false);
  });

  it("passes the remaining-evening average through", () => {
    const g = buildGuidance({ ...partsFixture(), remainingAverageEur: 0.41 });
    assert.equal(g.remaining_average_eur, 0.41);
  });

  it("marks the day's cheap hours passed only once they are", (t) => {
    // The passed check compares local hour indices only, so the wall
    // clock is pinned to a fixed afternoon: a now-anchored window
    // would land on yesterday's hours just after midnight and the
    // assertion would flip.
    t.mock.timers.enable({
      now: new Date("2027-06-15T14:30:00+02:00").getTime(),
    });
    const passed = buildGuidance(
      partsFixture({
        dayWindow: {
          start: "2027-06-15T09:00:00+02:00",
          end: "2027-06-15T12:00:00+02:00",
          average_price: 0.24,
        },
      })
    );
    assert.equal(passed.day_cheapest_passed, true);
    const ahead = buildGuidance(
      partsFixture({
        dayWindow: {
          start: "2027-06-15T16:00:00+02:00",
          end: "2027-06-15T19:00:00+02:00",
          average_price: 0.24,
        },
      })
    );
    assert.equal(ahead.day_cheapest_passed, false);
  });

  it("computes the delay comparison against tomorrow's window", () => {
    const base = {
      ...partsFixture({ windowAvg: 0.33 }),
      tomorrowPricesAvailable: true,
      cheapestByDay: {
        today: {
          start: "2027-06-15T18:00:00+02:00",
          end: "2027-06-15T21:00:00+02:00",
          average_price: 0.33,
        },
        tomorrow: {
          start: "2027-06-16T12:00:00+02:00",
          end: "2027-06-16T15:00:00+02:00",
          average_price: 0.19,
        },
      },
    };
    const g = buildGuidance(base);
    assert.notEqual(g.delay, null);
    assert.equal(g.delay.tomorrow_window, "12:00-15:00 tomorrow");
    assert.equal(g.delay.tomorrow_window_average_eur, 0.19);
    assert.equal(g.delay.today_window_average_eur, 0.33);
  });

  it("fires the delay at exactly the advantage threshold", () => {
    const g = buildGuidance({
      ...partsFixture({ windowAvg: 0.3 }),
      tomorrowPricesAvailable: true,
      cheapestByDay: {
        today: {
          start: "2027-06-15T18:00:00+02:00",
          end: "2027-06-15T21:00:00+02:00",
          average_price: 0.3,
        },
        tomorrow: {
          start: "2027-06-16T12:00:00+02:00",
          end: "2027-06-16T15:00:00+02:00",
          average_price: 0.25,
        },
      },
    });
    assert.notEqual(g.delay, null);
  });

  it("omits the delay when tomorrow's prices are unpublished", () => {
    const g = buildGuidance({
      ...partsFixture({ windowAvg: 0.33 }),
      tomorrowPricesAvailable: false,
      cheapestByDay: {
        today: {
          start: "2027-06-15T18:00:00+02:00",
          end: "2027-06-15T21:00:00+02:00",
          average_price: 0.33,
        },
        tomorrow: {
          start: "2027-06-16T12:00:00+02:00",
          end: "2027-06-16T15:00:00+02:00",
          average_price: 0.19,
        },
      },
    });
    assert.equal(g.delay, null);
  });

  it("omits the delay below the advantage threshold", () => {
    const g = buildGuidance({
      ...partsFixture({ windowAvg: 0.28 }),
      tomorrowPricesAvailable: true,
      cheapestByDay: {
        today: {
          start: "2027-06-15T18:00:00+02:00",
          end: "2027-06-15T21:00:00+02:00",
          average_price: 0.28,
        },
        tomorrow: {
          start: "2027-06-16T12:00:00+02:00",
          end: "2027-06-16T15:00:00+02:00",
          average_price: 0.25,
        },
      },
    });
    assert.equal(g.delay, null);
  });
});

describe("buildAdvisory and buildOutlook: the solar score", () => {
  it("flags tomorrow's low solar score below the threshold", () => {
    const a = buildAdvisory(
      advisoryPriceParts({ tomorrowAvailable: false }),
      forecastFixture({ tomorrowSolar: 2.1, tomorrowScore: 12 })
    );
    assert.equal(a.tomorrow_solar_score, 12);
    assert.equal(a.tomorrow_low_solar, true);
  });

  it("keeps a score at the threshold above the low flag", () => {
    const a = buildAdvisory(
      advisoryPriceParts({ tomorrowAvailable: false }),
      forecastFixture({ tomorrowSolar: 8.2, tomorrowScore: 20 })
    );
    assert.equal(a.tomorrow_low_solar, false);
  });

  it("grounds the outlook's best day in its score", () => {
    const today = localDateKey(new Date());
    const days = [
      { date: today, estimated_kwh: 3, solar_score: 20 },
      { date: nextDateKey(today, 1), estimated_kwh: 8, solar_score: 45 },
      { date: nextDateKey(today, 2), estimated_kwh: 15.3, solar_score: 68 },
    ];
    const outlook = buildOutlook(days, {});
    assert.equal(outlook.best_solar_day.solar_score, 68);
    assert.equal(outlook.best_solar_day.good, true);
    assert.equal(outlook.days[1].solar_score, 68);
  });

  it("does not call a mediocre best day good", () => {
    const today = localDateKey(new Date());
    const days = [
      { date: today, estimated_kwh: 3, solar_score: 20 },
      { date: nextDateKey(today, 1), estimated_kwh: 2, solar_score: 15 },
      { date: nextDateKey(today, 2), estimated_kwh: 9.2, solar_score: 45 },
    ];
    const outlook = buildOutlook(days, {});
    assert.equal(outlook.best_solar_day.good, false);
  });
});
