import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eurFactText, priceFallbackText } from "../server/ai.mjs";
import {
  buildAdvisory,
  buildCandidates,
  buildOutlook,
} from "../server/context.mjs";

// The served-sentence audit: every sentence the server composes for
// the card opens with a capital letter (or a legitimate figure or
// currency symbol) and states amounts with the flush euro sign,
// never the three-letter code - both applied at server composition
// time, never by frontend substitution. The advisory card's own
// sentences are audited by the core (server/advisory/); this file
// covers the sentences the facts layer and the price box compose.

function partsFixture({
  windowStart = "2027-06-15T12:00:00+02:00",
  windowEnd = "2027-06-15T15:00:00+02:00",
  windowAvg = 0.25,
  dayAverage = 0.36,
  dayMax = 0.51,
} = {}) {
  return {
    cheapestByDay: {
      today: { start: windowStart, end: windowEnd, average_price: windowAvg },
    },
    priceData: {
      today: { average: dayAverage, max: dayMax, peak_hour: "08:00" },
    },
    dayCheapestWindow: null,
  };
}

// Every served sentence type, composed once for the audit.
function servedSentences() {
  const outlook = buildOutlook(
    [
      { date: "2027-06-16", estimated_kwh: 15.3, solar_score: 68, weather_code: 0 },
      { date: "2027-06-17", estimated_kwh: 0.8, solar_score: 8, weather_code: 63 },
      { date: "2027-06-18", estimated_kwh: 2, solar_score: 10, weather_code: 3 },
    ],
    null
  );
  const candidates = buildCandidates(
    [{ appliance: "Dishwasher energy", kwh: 1.07, cost_eur: 0.4815 }],
    {},
    partsFixture(),
    []
  );
  const advisory = buildAdvisory(
    {
      priceData: { today: { average: 0.3 }, tomorrow: { average: 0.42 } },
      tomorrowPricesAvailable: true,
      dayAfterPricesAvailable: false,
    },
    []
  );
  return [
    priceFallbackText({
      priceData: {
        current_price: 0.123,
        today: { average: 0.36, peak_hour: "08:00" },
      },
      tomorrowPricesAvailable: false,
    }),
    outlook.best_solar_day?.line,
    outlook.poor_day?.line,
    outlook.poor_day?.advice,
    candidates[0]?.basis,
    advisory?.horizon_note,
  ].filter((sentence) => typeof sentence === "string");
}

describe("the served-sentence audit", () => {
  it("covers every served sentence type", () => {
    // Six sentence types: the price fallback, the best and poor
    // outlook lines, the poor day's advice, the candidate basis and
    // the defer horizon note. The advisory card's own sentences are
    // audited by the core's served-text audit.
    assert.equal(servedSentences().length, 6);
  });

  it("opens every served sentence with a capital letter, or a figure or symbol", () => {
    for (const sentence of servedSentences()) {
      assert.match(sentence, /^[A-Z0-9€]/);
    }
  });

  it("never uses the three-letter currency code", () => {
    for (const sentence of servedSentences()) {
      assert.doesNotMatch(sentence, /EUR/);
    }
  });

  it("keeps the euro sign flush, in the subtext spacing style", () => {
    for (const sentence of servedSentences()) {
      if (sentence.includes("€")) {
        assert.doesNotMatch(sentence, /€\s/, `${sentence}: spaced euro sign`);
      }
    }
  });

  it("capitalizes the poor-day line that once opened lowercase", () => {
    const outlook = buildOutlook(
      [
        { date: "2027-06-16", estimated_kwh: 15.3, solar_score: 68, weather_code: 0 },
        { date: "2027-06-17", estimated_kwh: 2, solar_score: 10, weather_code: 3 },
      ],
      null
    );
    assert.equal(
      outlook.poor_day.line,
      "Almost no solar of your own: 2 kWh expected."
    );
  });
});

describe("eurFactText: the one money format for composed sentences", () => {
  it("renders the flush euro sign at the pinned precision", () => {
    assert.equal(eurFactText(0.19), "€0.19");
    assert.equal(eurFactText(0.36), "€0.36");
  });

  it("keeps a sub-cent value nonzero", () => {
    assert.equal(eurFactText(0.0035), "€0.0035");
  });});
