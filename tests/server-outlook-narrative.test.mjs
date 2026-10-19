import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeAdvisoryLine } from "../server/ai.mjs";
import { buildOutlook } from "../server/context.mjs";

// The outlook card descriptions, composed server-side as short
// narrative sentences about what the figures MEAN - cheaper or
// pricier, more or less or similar solar - in household voice. The
// description complements the card's subtext (the exact comparison),
// never restates the figures and never opens with the card title;
// missing data omits its half rather than guessing.

// A minimal advisory object; only the fields the narrative derives
// its branches from.
function advisoryFixture(overrides = {}) {
  return {
    type: "advance",
    triggered: true,
    tomorrow_average_eur: null,
    tomorrow_solar_kwh: null,
    tomorrow_solar_score: null,
    tomorrow_low_solar: false,
    compare_day: "today",
    compare_average_eur: null,
    compare_solar_kwh: null,
    price_difference_per_kwh: null,
    horizon_note: null,
    ...overrides,
  };
}

describe("composeAdvisoryLine: the narrative branches", () => {
  it("narrates a cheaper day with more solar, without restating figures", () => {
    const line = composeAdvisoryLine(
      advisoryFixture({
        tomorrow_average_eur: 0.2,
        compare_average_eur: 0.36,
        tomorrow_solar_kwh: 15,
        compare_solar_kwh: 10,
      })
    );
    assert.equal(
      line,
      "Grid power should cost you less than today, with more of your own solar."
    );
    // Meaning, not figures: the narrative carries no numbers.
    assert.equal(/\d/.test(line), false);
  });

  it("narrates a pricier day with less solar, visibly different", () => {
    const line = composeAdvisoryLine(
      advisoryFixture({
        tomorrow_average_eur: 0.5,
        compare_average_eur: 0.36,
        tomorrow_solar_kwh: 6,
        compare_solar_kwh: 10,
      })
    );
    assert.equal(
      line,
      "Grid power will cost you more than today, with less of your own solar."
    );
  });

  it("narrates a similar day as plain information", () => {
    const line = composeAdvisoryLine(
      advisoryFixture({
        tomorrow_average_eur: 0.37,
        compare_average_eur: 0.36,
        tomorrow_solar_kwh: 10.5,
        compare_solar_kwh: 10,
      })
    );
    assert.equal(
      line,
      "Grid power should cost about the same as today, with about as much of your own solar."
    );
  });

  it("branches the price at the threshold exactly, deterministically", () => {
    // 0.36 - 0.31 = 0.05 at the threshold: cheaper.
    assert.match(
      composeAdvisoryLine(
        advisoryFixture({
          tomorrow_average_eur: 0.31,
          compare_average_eur: 0.36,
        })
      ),
      /cost you less than today/
    );
    // 0.34 - 0.36 = -0.02 below it: about the same.
    assert.match(
      composeAdvisoryLine(
        advisoryFixture({
          tomorrow_average_eur: 0.34,
          compare_average_eur: 0.36,
        })
      ),
      /about the same as today/
    );
    // 0.41 - 0.36 = 0.05 at the threshold: pricier.
    assert.match(
      composeAdvisoryLine(
        advisoryFixture({
          tomorrow_average_eur: 0.41,
          compare_average_eur: 0.36,
        })
      ),
      /cost you more than today/
    );
  });

  it("branches the solar at a 20 percent swing, deterministically", () => {
    // Exactly 1.2x reads as more; exactly 0.8x as less.
    assert.match(
      composeAdvisoryLine(
        advisoryFixture({
          tomorrow_average_eur: 0.3,
          compare_average_eur: 0.36,
          tomorrow_solar_kwh: 12,
          compare_solar_kwh: 10,
        })
      ),
      /with more of your own solar/
    );
    assert.match(
      composeAdvisoryLine(
        advisoryFixture({
          tomorrow_average_eur: 0.3,
          compare_average_eur: 0.36,
          tomorrow_solar_kwh: 8,
          compare_solar_kwh: 10,
        })
      ),
      /with less of your own solar/
    );
  });

  it("omits the price half when prices are unavailable", () => {
    const line = composeAdvisoryLine(
      advisoryFixture({
        tomorrow_solar_kwh: 15,
        compare_solar_kwh: 10,
      })
    );
    assert.equal(line, "More of your own solar is expected than today.");
  });

  it("omits the solar half when the solar forecast is unavailable", () => {
    const line = composeAdvisoryLine(
      advisoryFixture({
        tomorrow_average_eur: 0.2,
        compare_average_eur: 0.36,
      })
    );
    assert.equal(line, "Grid power should cost you less than today.");
  });

  it("narrates the low-solar day as grid reliance", () => {
    const solarOnly = composeAdvisoryLine(
      advisoryFixture({
        tomorrow_solar_kwh: 2,
        compare_solar_kwh: 10,
        tomorrow_low_solar: true,
      })
    );
    assert.equal(
      solarOnly,
      "Little sun is expected - you'll lean mostly on grid power."
    );
    const withPrice = composeAdvisoryLine(
      advisoryFixture({
        tomorrow_average_eur: 0.5,
        compare_average_eur: 0.36,
        tomorrow_solar_kwh: 2,
        compare_solar_kwh: 10,
        tomorrow_low_solar: true,
      })
    );
    assert.equal(
      withPrice,
      "Grid power will cost you more than today, with little sun expected."
    );
  });

  it("names the compare day for a defer", () => {
    const line = composeAdvisoryLine(
      advisoryFixture({
        compare_day: "Sunday",
        tomorrow_solar_kwh: 4,
        compare_solar_kwh: 12.55,
      })
    );
    assert.equal(
      line,
      "Less of your own solar is expected than on Sunday."
    );
  });

  it("returns null when no honest narrative exists", () => {
    assert.equal(composeAdvisoryLine(advisoryFixture()), null);
    // Solar present but nothing to compare it against, and no
    // score-derived meaning: no narrative, never a guess.
    assert.equal(
      composeAdvisoryLine(
        advisoryFixture({ tomorrow_solar_kwh: 5, compare_solar_kwh: null })
      ),
      null
    );
  });

  it("never opens by restating the card title", () => {
    const lines = [
      composeAdvisoryLine(
        advisoryFixture({
          tomorrow_average_eur: 0.2,
          compare_average_eur: 0.36,
          tomorrow_solar_kwh: 15,
          compare_solar_kwh: 10,
        })
      ),
      composeAdvisoryLine(
        advisoryFixture({ tomorrow_solar_kwh: 15, compare_solar_kwh: 10 })
      ),
      composeAdvisoryLine(
        advisoryFixture({
          tomorrow_solar_kwh: 2,
          compare_solar_kwh: 10,
          tomorrow_low_solar: true,
        })
      ),
    ];
    for (const line of lines) {
      assert.doesNotMatch(line, /^tomorrow/i);
      assert.doesNotMatch(line, /^thursday/i);
    }
  });
});

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
      "almost no solar of your own: 2 kWh expected."
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
