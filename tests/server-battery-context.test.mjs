import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solarScoreBand } from "../server/advisory-constants.mjs";
import {
  BATTERY_SYSTEM_PROMPT,
  SOLAR_SCORE_MEANING,
  buildBatteryContext,
} from "../server/ai.mjs";
import { validateBatteryInsight } from "../server/battery-guards.mjs";

// The battery box fixtures, built the same way the production path
// builds them: getSummary's battery fields, the daily forecast rows and
// the price context parts, all through buildBatteryContext.
function summaryFixture() {
  return {
    battery_soc_pct: 80,
    battery_state: "idle",
    battery_power_w: 0,
    today: { battery_charged_kwh: 4.2, battery_discharged_kwh: 1.1 },
    week: { battery_charged_kwh: 21.5, battery_discharged_kwh: 18.3 },
    month: { battery_charged_kwh: 90.1, battery_discharged_kwh: 84.7 },
    battery_flow_hourly: [
      { ts: "2026-11-15T10:00:00+01:00", in_kwh: 1.5, out_kwh: 0 },
      { ts: "2026-11-15T18:00:00+01:00", in_kwh: 0, out_kwh: 1.1 },
    ],
  };
}

function weatherFixture(scores = [9, 12]) {
  return scores.map((score, index) => ({
    date: `2026-11-${15 + index}`,
    solar_score: score,
    estimated_kwh: 3.62 - index * 1.2,
  }));
}

function priceFixture() {
  return {
    priceData: { current_price: 0.31 },
    cheapestBlock: {
      start: "2026-11-15T12:00:00+01:00",
      end: "2026-11-15T15:00:00+01:00",
      average_price: 0.24,
    },
  };
}

function batteryContext(overrides = {}) {
  return buildBatteryContext(
    overrides.summary ?? summaryFixture(),
    overrides.weather ?? weatherFixture(),
    overrides.price ?? priceFixture()
  );
}

describe("buildBatteryContext: the served meaning and the price block", () => {
  it("carries the shared score-meaning block", () => {
    const context = batteryContext();
    assert.equal(context.solar_score_meaning, SOLAR_SCORE_MEANING);
    assert.match(context.solar_score_meaning, /0 to 100/);
    assert.match(context.solar_score_meaning, /theoretical best day of the year/);
  });

  it("serves a per-day band label from the one shared helper", () => {
    const context = batteryContext({
      weather: weatherFixture([19, 20, 60, 61]),
    });
    assert.deepEqual(
      context.solar_forecast.map((day) => day.solar_band),
      ["little sun", "moderate", "moderate", "good"]
    );
    for (const day of context.solar_forecast) {
      assert.equal(day.solar_band, solarScoreBand(day.solar_score));
    }
  });

  it("leaves the price block served and unchanged", () => {
    const context = batteryContext();
    assert.equal(context.current_price, 0.31);
    assert.deepEqual(context.cheapest_window, {
      start_hour: "12:00",
      end_hour: "15:00",
      average_price: 0.24,
    });
  });

  it("keeps the battery facts in their served units", () => {
    const context = batteryContext();
    assert.equal(context.soc_pct, 80);
    assert.equal(context.state, "idle");
    assert.equal(context.power_w, 0);
    assert.equal(context.today_in_kwh, 4.2);
    assert.equal(context.today_out_kwh, 1.1);
    assert.deepEqual(context.flow_hourly[0], {
      hour: "10:00",
      in_kwh: 1.5,
      out_kwh: 0,
    });
  });
});

describe("BATTERY_SYSTEM_PROMPT: a context-box prompt, facts only", () => {
  it("requests no tip and no recommendation", () => {
    assert.doesNotMatch(BATTERY_SYSTEM_PROMPT, /practical tip/i);
    assert.doesNotMatch(BATTERY_SYSTEM_PROMPT, /recommend\w*\s+(charging|timing|a tip)/i);
  });

  it("carries the no-advice instruction and the as-served figures rule", () => {
    assert.match(BATTERY_SYSTEM_PROMPT, /No advice of any kind/);
    assert.match(BATTERY_SYSTEM_PROMPT, /facts only/);
    assert.match(BATTERY_SYSTEM_PROMPT, /never computed or converted/);
    assert.match(BATTERY_SYSTEM_PROMPT, /little sun, moderate, good/);
  });
});

describe("the battery box validator: the rejection fixtures", () => {
  it("rejects a tip text for advice, with the markers named", () => {
    const verdict = validateBatteryInsight(
      "Tip: charge the battery from the grid before the evening peak.",
      batteryContext()
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((p) => p.includes('gives a recommendation ("Tip")')),
      `expected the recommendation reason, got: ${verdict.problems.join("; ")}`
    );
    assert.ok(
      verdict.problems.some((p) => p.includes('instructs battery operation ("charge the battery")')),
      `expected the battery-operation reason, got: ${verdict.problems.join("; ")}`
    );
  });

  it("rejects an appliance text for appliance advice", () => {
    const verdict = validateBatteryInsight(
      "Run the washing machine when the sun is out.",
      batteryContext()
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((p) => p.includes('mentions "washing machine"')),
      `expected the appliance reason, got: ${verdict.problems.join("; ")}`
    );
  });

  it("rejects a band misreading while every served band is little sun", () => {
    const verdict = validateBatteryInsight(
      "The coming days look good for solar.",
      batteryContext({ weather: weatherFixture([9, 12]) })
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((p) =>
        p.includes('positive evaluative phrase "good"')
      ),
      `expected the band reason, got: ${verdict.problems.join("; ")}`
    );
  });

  it("rejects a converted power figure in kW", () => {
    const verdict = validateBatteryInsight(
      "Currently charging at 2.5 kW.",
      batteryContext()
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((p) => p.includes('"2.5 kW" in kW')),
      `expected the kW reason, got: ${verdict.problems.join("; ")}`
    );
  });

  it("rejects a monetary amount that matches no served price fact", () => {
    const verdict = validateBatteryInsight(
      "The price is €0.55 today.",
      batteryContext()
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((p) =>
        p.includes('"€0.55" which matches no served price fact')
      ),
      `expected the price-grounding reason, got: ${verdict.problems.join("; ")}`
    );
  });

  it("rejects a kWh figure that matches no served kWh fact", () => {
    const verdict = validateBatteryInsight(
      "The battery charged 5 kWh today.",
      batteryContext()
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((p) =>
        p.includes('"5 kWh" which matches no served kWh fact')
      ),
      `expected the kWh-grounding reason, got: ${verdict.problems.join("; ")}`
    );
  });
});

describe("the battery box validator: the acceptance fixtures", () => {
  it("accepts a factual text with SOC, state, watts, today's kWh and the cheapest window as served", () => {
    const verdict = validateBatteryInsight(
      "Battery at 80% (idle) with 0 W. Today the battery charged 4.2 kWh " +
        "and discharged 1.1 kWh. The cheapest window runs 12:00-15:00 at €0.24.",
      batteryContext()
    );
    assert.deepEqual(verdict, { ok: true, problems: [] });
  });

  it("accepts descriptive present-tense charging in watts", () => {
    const verdict = validateBatteryInsight(
      "The battery is charging at 800 W.",
      batteryContext()
    );
    assert.deepEqual(verdict, { ok: true, problems: [] });
  });

  it("accepts a band-consistent solar mention with the served band little sun", () => {
    const verdict = validateBatteryInsight(
      "Tomorrow is a little sun day.",
      batteryContext({ weather: weatherFixture([9, 12]) })
    );
    assert.deepEqual(verdict, { ok: true, problems: [] });
  });

  it("accepts a plain price fact with the exact served amount", () => {
    const verdict = validateBatteryInsight(
      "The current price is €0.31.",
      batteryContext()
    );
    assert.deepEqual(verdict, { ok: true, problems: [] });
  });

  it("allows the word good when a served day has band good", () => {
    const verdict = validateBatteryInsight(
      "The coming days look good for solar.",
      batteryContext({ weather: weatherFixture([9, 75]) })
    );
    assert.deepEqual(verdict, { ok: true, problems: [] });
  });
});
