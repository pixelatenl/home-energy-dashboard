import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GOOD_SOLAR_SCORE,
  LOW_SOLAR_SCORE,
  solarScoreBand,
} from "../server/advisory-constants.mjs";
// The advisory core re-exports the same constants, so the hub advisory
// and the weather box can never disagree about a score.
import {
  GOOD_SOLAR_SCORE as CORE_GOOD_SOLAR_SCORE,
  LOW_SOLAR_SCORE as CORE_LOW_SOLAR_SCORE,
} from "../server/advisory/advisory-core.mjs";
import {
  WEATHER_SYSTEM_PROMPT,
  buildWeatherContext,
  topProductionHours,
} from "../server/ai.mjs";
import { validateWeatherInsight } from "../server/weather-guards.mjs";

// The incident pin of 15 November 2026: the served scores were 9, 7, 2,
// 8, 12 out of 100 on the absolute year-norm scale, with the noon hour
// at about 1220 Wh. The fixture builds the served context exactly the
// way the production path does, through buildWeatherContext.
const INCIDENT_DAILY = [9, 7, 2, 8, 12].map((score, index) => ({
  date: `2026-11-${15 + index}`,
  solar_score: score,
  estimated_kwh: 0.4 + index * 0.3,
  temp_min: 4,
  temp_max: 9,
  weather_code: 3,
}));
const INCIDENT_HOURLY = {
  current: { temperature: 7, weather_code: 3, cloud_cover: 80 },
  hours: [
    { hour: "2026-11-15T10:00:00+01:00", estimated_pv_wh: 640 },
    { hour: "2026-11-15T11:00:00+01:00", estimated_pv_wh: 980 },
    { hour: "2026-11-15T12:00:00+01:00", estimated_pv_wh: 1220 },
    { hour: "2026-11-15T13:00:00+01:00", estimated_pv_wh: 1180 },
    { hour: "2026-11-15T14:00:00+01:00", estimated_pv_wh: 820 },
  ],
};

// The two incident texts, pinned verbatim. Both treat the little-sun
// scores as high marks and both issue appliance-run advice.
const INCIDENT_TEXT_1 =
  "The coming days are good for solar production, with the highest " +
  "output on November 19th. Today, production peaks at noon with " +
  "1.22 kWh. To optimize use, run high-energy appliances between " +
  "11:00 and 13:00.";
const INCIDENT_TEXT_2 =
  "The coming days are very good for solar production on the 15th, " +
  "16th, 18th, and 19th, with scores of 9, 7, 8, and 12 respectively. " +
  "Today, production peaks at 12:00 with an estimated 1.22 kWh. Run " +
  "high-energy appliances like washing machines between 11:00 and " +
  "13:00 to maximize self-consumption.";

function incidentContext() {
  return buildWeatherContext(INCIDENT_DAILY, INCIDENT_HOURLY);
}

describe("solarScoreBand: the shared band helper boundaries", () => {
  it("pins the constants the advisory and the weather box share", () => {
    assert.equal(LOW_SOLAR_SCORE, 20);
    assert.equal(GOOD_SOLAR_SCORE, 60);
    assert.equal(CORE_LOW_SOLAR_SCORE, LOW_SOLAR_SCORE);
    assert.equal(CORE_GOOD_SOLAR_SCORE, GOOD_SOLAR_SCORE);
  });

  it("maps the band boundaries 19, 20, 60, 61", () => {
    assert.equal(solarScoreBand(19), "little sun");
    assert.equal(solarScoreBand(20), "moderate");
    assert.equal(solarScoreBand(60), "moderate");
    assert.equal(solarScoreBand(61), "good");
  });

  it("maps the scale ends and a non-finite score to the little-sun band", () => {
    assert.equal(solarScoreBand(0), "little sun");
    assert.equal(solarScoreBand(100), "good");
    assert.equal(solarScoreBand(Number.NaN), "little sun");
    assert.equal(solarScoreBand(null), "little sun");
  });
});

describe("buildWeatherContext: the served meaning and units", () => {
  it("serves the score meaning block with the facts", () => {
    const context = incidentContext();
    assert.match(context.solar_score_meaning, /0 to 100/);
    assert.match(context.solar_score_meaning, /theoretical best day of the year/);
    assert.match(context.solar_score_meaning, /little-sun band/);
  });

  it("serves a per-day band label from the shared helper", () => {
    const context = incidentContext();
    assert.deepEqual(
      context.days.map((day) => day.solar_band),
      ["little sun", "little sun", "little sun", "little sun", "little sun"]
    );
    for (const day of context.days) {
      assert.equal(day.solar_band, solarScoreBand(day.solar_score));
    }
  });

  it("serves the top production hours in kWh, never in Wh", () => {
    const context = incidentContext();
    const top = context.today.top_production_hours;
    assert.equal(top.length, 3);
    assert.deepEqual(top[0], {
      hour: "2026-11-15T12:00:00+01:00",
      estimated_pv_kwh: 1.22,
    });
    for (const row of top) {
      assert.ok("estimated_pv_kwh" in row);
      assert.ok(!("estimated_pv_wh" in row));
    }
    assert.deepEqual(
      top.map((row) => row.estimated_pv_kwh),
      [1.22, 1.18, 0.98]
    );
  });

  it("keeps topProductionHours sorted by production, converted server-side", () => {
    const top = topProductionHours(INCIDENT_HOURLY.hours, 2);
    assert.deepEqual(
      top.map((row) => row.estimated_pv_kwh),
      [1.22, 1.18]
    );
  });
});

describe("the weather box validator: the incident pins", () => {
  it("rejects the first incident text with the band and appliance reasons named", () => {
    const verdict = validateWeatherInsight(INCIDENT_TEXT_1, incidentContext());
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((problem) =>
        problem.includes('positive evaluative phrase "good"')
      ),
      `expected the band reason, got: ${verdict.problems.join("; ")}`
    );
    assert.ok(
      verdict.problems.some((problem) =>
        problem.includes('mentions "appliances"')
      ),
      `expected the appliance reason, got: ${verdict.problems.join("; ")}`
    );
  });

  it("rejects the second incident text with the band and appliance reasons named", () => {
    const verdict = validateWeatherInsight(INCIDENT_TEXT_2, incidentContext());
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((problem) =>
        problem.includes('positive evaluative phrase "very good"')
      ),
      `expected the band reason, got: ${verdict.problems.join("; ")}`
    );
    assert.ok(
      verdict.problems.some((problem) =>
        problem.includes('mentions "appliances"')
      ),
      `expected the appliance reason, got: ${verdict.problems.join("; ")}`
    );
  });

  it("rejects price vocabulary while no price facts are served", () => {
    const verdict = validateWeatherInsight(
      "Tomorrow is the cheapest day at EUR 0.12 per kWh for your usage.",
      incidentContext()
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((problem) =>
        problem.includes('price vocabulary ("cheapest")')
      )
    );
    assert.ok(
      verdict.problems.some((problem) => problem.includes('price vocabulary ("EUR")'))
    );
  });

  it("accepts a band-consistent text on the little-sun context", () => {
    const text =
      "The coming days are little sun for solar production, with the " +
      "highest output on November 19th. Today, production peaks at " +
      "12:00 with an estimated 1.22 kWh.";
    const verdict = validateWeatherInsight(text, incidentContext());
    assert.deepEqual(verdict, { ok: true, problems: [] });
  });

  it("allows the word good exactly when a served day has band good", () => {
    const daily = INCIDENT_DAILY.map((day, index) =>
      index === 3 ? { ...day, solar_score: 75 } : day
    );
    const context = buildWeatherContext(daily, INCIDENT_HOURLY);
    assert.equal(context.days[3].solar_band, "good");
    const verdict = validateWeatherInsight(
      "Thursday is a good solar day, peaking at 13:00 with 1.4 kWh.",
      context
    );
    assert.deepEqual(verdict, { ok: true, problems: [] });
  });

  it("still rejects a good-claim when the best served day is only moderate", () => {
    const daily = INCIDENT_DAILY.map((day) => ({ ...day, solar_score: 55 }));
    const context = buildWeatherContext(daily, INCIDENT_HOURLY);
    assert.equal(context.days[0].solar_band, "moderate");
    const verdict = validateWeatherInsight(
      "The coming days are good for solar production.",
      context
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.problems.some((problem) => problem.includes('phrase "good"'))
    );
  });
});

describe("WEATHER_SYSTEM_PROMPT: no judgment request, no usage tip", () => {
  it("asks for the served band labels and the peak, nothing evaluative", () => {
    assert.match(WEATHER_SYSTEM_PROMPT, /little sun, moderate, good/);
    assert.match(WEATHER_SYSTEM_PROMPT, /when production peaks today/);
    assert.doesNotMatch(WEATHER_SYSTEM_PROMPT, /how good/i);
    assert.doesNotMatch(WEATHER_SYSTEM_PROMPT, /\btip\b/i);
  });

  it("forbids appliance advice and price talk", () => {
    assert.match(WEATHER_SYSTEM_PROMPT, /Do not advise on running appliances/);
    assert.match(WEATHER_SYSTEM_PROMPT, /do not mention prices or costs/i);
  });
});
