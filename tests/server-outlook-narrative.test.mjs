import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOutlook } from "../server/context.mjs";

// The outlook card descriptions, composed server-side as short
// narrative sentences about what the figures MEAN, in household
// voice. The description complements the card's subtext (the exact
// comparison), never restates the figures and never opens with the
// card title; missing data omits its half rather than guessing.

// A five-day forecast fixture with future dates, so the tests stay
// deterministic at any hour of any day. Weather codes: 0 clear,
// 3 cloudy, 63 rain.
function forecastDay(date, estimated_kwh, solar_score, weather_code) {
  return { date, estimated_kwh, solar_score, weather_code };
}

describe("buildOutlook: the sibling day cards' narrative lines", () => {
  it("describes a genuinely good best day, without the weekday opener", () => {
    const outlook = buildOutlook(
      [
        forecastDay("2027-06-16", 15.3, 68, 0),
        forecastDay("2027-06-17", 0.8, 8, 63),
      ],
      null
    );
    assert.equal(
      outlook.best_solar_day.line,
      "A genuinely good solar day: score 68, 15.3 kWh expected."
    );
    assert.equal(
      outlook.poor_day.line,
      "Rain and almost no solar of your own: 0.8 kWh expected."
    );
    // Never opens by restating the card's weekday chip.
    assert.doesNotMatch(outlook.best_solar_day.line, /^(Wednesday|Thursday)/);
    assert.doesNotMatch(outlook.poor_day.line, /^(Wednesday|Thursday)/);
  });

  it("keeps the honest not-special wording for a mediocre best day", () => {
    const outlook = buildOutlook(
      [
        forecastDay("2027-06-16", 12.55, 29, 3),
        forecastDay("2027-06-17", 5.73, 15, 63),
      ],
      null
    );
    assert.equal(
      outlook.best_solar_day.line,
      "The week's best solar day, though nothing special: score 29, 12.55 kWh expected."
    );
  });

  it("falls back to the plain solar fact when the score is missing", () => {
    const outlook = buildOutlook(
      [forecastDay("2027-06-16", 12.5, null, 3)],
      null
    );
    assert.equal(
      outlook.best_solar_day.line,
      "The week's sunniest day: 12.5 kWh of your own solar expected."
    );
  });

  it("describes a tiny-solar poor day without the rain prefix when it is not rain", () => {
    const outlook = buildOutlook(
      [
        forecastDay("2027-06-16", 12.55, 29, 3),
        forecastDay("2027-06-17", 5.73, 15, 63),
        forecastDay("2027-06-18", 2, 10, 3),
      ],
      null
    );
    // The lowest qualifying day is the 2 kWh cloudy day; under 35
    // percent of the best day it reads as almost no solar, and the
    // rain prefix only appears for a rain condition.
    assert.equal(outlook.poor_day.solar_kwh, 2);
    assert.equal(
      outlook.poor_day.line,
      "Almost no solar of your own: 2 kWh expected."
    );
  });

  it("describes a rain day that keeps decent solar", () => {
    const outlook = buildOutlook(
      [
        forecastDay("2027-06-16", 12.55, 29, 3),
        forecastDay("2027-06-17", 5.73, 15, 63),
      ],
      null
    );
    assert.equal(outlook.poor_day.date, "2027-06-17");
    assert.equal(
      outlook.poor_day.line,
      "Rain that day, with 5.73 kWh of your own solar."
    );
  });
});

describe("buildOutlook: the poor day's narrative advice line", () => {
  it("advises against large appliances on a tiny-solar day", () => {
    const outlook = buildOutlook(
      [
        forecastDay("2027-06-16", 15.3, 68, 0),
        forecastDay("2027-06-17", 0.8, 8, 63),
      ],
      null
    );
    assert.equal(
      outlook.poor_day.advice,
      "With little solar expected, it is not a good day to run your large appliances."
    );
  });

  it("advises against large appliances on a rain day with decent solar", () => {
    const outlook = buildOutlook(
      [
        forecastDay("2027-06-16", 12.55, 29, 3),
        forecastDay("2027-06-17", 5.73, 15, 63),
      ],
      null
    );
    assert.equal(
      outlook.poor_day.advice,
      "With rain expected, it is not a good day to run your large appliances."
    );
  });

  it("names the week's weakest solar for a share-poor non-rain day", () => {
    const outlook = buildOutlook(
      [
        forecastDay("2027-06-16", 15.3, 68, 0),
        // 5.8 kWh: under 40 percent of the best day (poor) but above
        // the 35 percent tiny threshold, and not rain.
        forecastDay("2027-06-17", 5.8, 20, 3),
      ],
      null
    );
    assert.equal(outlook.poor_day.solar_kwh, 5.8);
    assert.equal(
      outlook.poor_day.advice,
      "With the week's weakest solar expected, it is not a good day to run your large appliances."
    );
  });
});
