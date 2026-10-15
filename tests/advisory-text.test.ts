import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  delaySentence,
  eveningPriceSentence,
  humanEur,
  humanNumber,
  humanizeEurInText,
  LOW_SOLAR_MARKET_NOTE,
  peakAvoidanceLine,
  sentenceForAdvisory,
  todayImperative,
  windowIsDayCheapest,
  type AdvisoryLine,
  type GuidanceLine,
} from "../src/lib/advisoryText.ts";

function makeGuidance(overrides: Partial<GuidanceLine> = {}): GuidanceLine {
  return {
    window: "12:00-15:00 today",
    cheapest_window_average_eur: 0.2574,
    peak_hour: "08:00",
    peak_price_eur: 0.5068,
    spread_per_kwh_eur: 0.2494,
    practical: true,
    window_start_hour: 12,
    hours_remaining: 3,
    day_average_eur: 0.3645,
    day_cheapest_window: null,
    day_cheapest_average_eur: null,
    peak_ahead: false,
    day_cheapest_passed: false,
    remaining_average_eur: null,
    delay: null,
    line: "",
    ...overrides,
  };
}

function makeAdvisory(overrides: Partial<AdvisoryLine> = {}): AdvisoryLine {
  return {
    type: "advance",
    triggered: true,
    tomorrow_average_eur: 0.24,
    tomorrow_solar_kwh: 14.4,
    tomorrow_solar_score: 68,
    tomorrow_low_solar: false,
    compare_day: "today",
    compare_average_eur: 0.36,
    compare_solar_kwh: 3.8,
    price_difference_per_kwh: -0.12,
    horizon_note: "",
    line: "",
    ...overrides,
  };
}

const countToday = (text: string) =>
  (text.match(/\btoday\b/gi) ?? []).length;

describe("money format", () => {
  it("always carries the euro sign", () => {
    assert.equal(humanEur(0.16), "\u20AC0.16");
    assert.equal(humanEur(12), "\u20AC12.00");
  });

  it("uses two decimals at 0.10 and above", () => {
    assert.equal(humanEur(0.1), "\u20AC0.10");
    assert.equal(humanEur(12.3456), "\u20AC12.35");
  });

  it("renders two decimals whenever the value is nonzero at two decimals", () => {
    assert.equal(humanEur(0.0629), "\u20AC0.06");
    assert.equal(humanEur(0.06), "\u20AC0.06");
    assert.equal(humanEur(1.07), "\u20AC1.07");
    assert.equal(humanEur(0.09), "\u20AC0.09");
  });

  it("keeps tiny nonzero values visible when two decimals would show 0.00", () => {
    assert.equal(humanEur(0.0035), "\u20AC0.0035");
    assert.equal(humanEur(0.004), "\u20AC0.004");
    assert.notEqual(humanEur(0.0035), "\u20AC0.00");
  });

  it("renders zero honestly", () => {
    assert.equal(humanEur(0), "\u20AC0.00");
  });

  it("formats numbers at human precision", () => {
    assert.equal(humanNumber(0.364494), "0.364");
    assert.equal(humanNumber(14.29), "14.29");
    assert.equal(humanNumber(13.5), "13.5");
  });

  it("humanizes euro amounts inside precomposed strings", () => {
    assert.equal(
      humanizeEurInText("EUR 0.2671/kWh against EUR 0.2574/kWh"),
      "\u20AC0.27/kWh against \u20AC0.26/kWh"
    );
    // Bare four-decimal numbers clamp only when two decimals stay
    // nonzero; a tiny value keeps its exact digits.
    assert.equal(
      humanizeEurInText("saved 0.4043 and 0.0035 respectively"),
      "saved 0.40 and 0.0035 respectively"
    );
  });

  it("renders a NaN token as an honest dash, never as a price", () => {
    assert.equal(
      humanizeEurInText("an average of \u20ACNaN per kWh"),
      "an average of \u2014 per kWh"
    );
    assert.equal(
      humanizeEurInText("the lowest at NaN"),
      "the lowest at \u2014"
    );
  });
});

describe("the dynamic reservation", () => {
  it("uses the strong phrase when the window is the day's absolute cheapest", () => {
    const guidance = makeGuidance({
      day_cheapest_window: "12:00-15:00",
      day_cheapest_average_eur: 0.2574,
    });
    assert.equal(
      todayImperative("12:00-15:00 today", guidance),
      "Run your large appliances between 12:00 and 15:00 to pay today's lowest price"
    );
  });

  it("falls back to left today when the window is only the cheapest remaining", () => {
    const guidance = makeGuidance({
      day_cheapest_window: "09:00-12:00",
      day_cheapest_average_eur: 0.24,
    });
    assert.equal(
      todayImperative("14:00-17:00 today", guidance),
      "Run your large appliances between 14:00 and 17:00 for the best price left today"
    );
  });

  it("detects the day's cheapest by average when the window label is absent", () => {
    const guidance = makeGuidance({ day_cheapest_average_eur: 0.2574 });
    assert.equal(windowIsDayCheapest("14:00-17:00 today", guidance), true);
  });

  it("is false without guidance", () => {
    assert.equal(windowIsDayCheapest("12:00-15:00 today", null), false);
    assert.equal(
      todayImperative("12:00-15:00 today", null),
      "Run your large appliances between 12:00 and 15:00 for the best price left today"
    );
  });

  it("carries exactly one today per sentence", () => {
    const strong = todayImperative(
      "12:00-15:00 today",
      makeGuidance({
        day_cheapest_window: "12:00-15:00",
        day_cheapest_average_eur: 0.2574,
      })
    );
    const weak = todayImperative(
      "14:00-17:00 today",
      makeGuidance({
        day_cheapest_window: "09:00-12:00",
        day_cheapest_average_eur: 0.24,
      })
    );
    assert.equal(countToday(strong), 1);
    assert.equal(countToday(weak), 1);
  });
});

describe("the advisory sentence", () => {
  it("reads as planning by default", () => {
    const sentence = sentenceForAdvisory(makeAdvisory(), false);
    assert.match(sentence, /^If you can wait: tomorrow brings 14\.4 kWh/);
    assert.equal(countToday(sentence), 1);
  });

  it("carries the imperative only when today offers nothing actionable", () => {
    const sentence = sentenceForAdvisory(makeAdvisory(), true);
    assert.equal(
      sentence,
      "Run your large appliances tomorrow to make the most of 14.4 kWh of your own solar"
    );
  });

  it("commands the compare day on a defer advisory", () => {
    const sentence = sentenceForAdvisory(
      makeAdvisory({
        type: "defer",
        compare_day: "Thursday",
        compare_average_eur: 0.24,
        compare_solar_kwh: 4.5,
        tomorrow_solar_kwh: 1.2,
      }),
      true
    );
    assert.equal(
      sentence,
      "Run your large appliances Thursday instead of tomorrow to save on energy"
    );
  });

  it("falls back to the price comparison without solar numbers", () => {
    const sentence = sentenceForAdvisory(
      makeAdvisory({
        tomorrow_solar_kwh: null,
        compare_solar_kwh: null,
      }),
      false
    );
    assert.equal(
      sentence,
      "If you can wait: tomorrow's grid price averages \u20AC0.24 against \u20AC0.36 today"
    );
  });

  it("renders the informational row on solar alone when prices are unpublished", () => {
    const sentence = sentenceForAdvisory(
      makeAdvisory({
        triggered: false,
        tomorrow_average_eur: null,
        tomorrow_solar_kwh: 8.2,
        compare_solar_kwh: 14.4,
      }),
      true
    );
    assert.equal(
      sentence,
      "8.2 kWh of your own solar expected against today's 14.4"
    );
    assert.equal(countToday(sentence), 1);
  });

  it("renders the informational row without a today comparison when today's forecast is missing", () => {
    const sentence = sentenceForAdvisory(
      makeAdvisory({
        triggered: false,
        tomorrow_average_eur: null,
        tomorrow_solar_kwh: 8.2,
        compare_solar_kwh: null,
      }),
      true
    );
    assert.equal(sentence, "8.2 kWh of your own solar expected");
  });

  it("renders the neutral sentence for the informational row with published prices", () => {
    const sentence = sentenceForAdvisory(
      makeAdvisory({
        triggered: false,
        tomorrow_solar_kwh: 11.99,
        compare_solar_kwh: 14.47,
        tomorrow_average_eur: 0.36,
        compare_average_eur: 0.36,
      }),
      true
    );
    // No trigger, no invitation: neutral information only, even
    // when the imperative would be allowed.
    assert.equal(
      sentence,
      "Tomorrow: \u20AC0.36 average grid price with 11.99 kWh of your own solar expected"
    );
    assert.equal(sentence.includes("If you can wait"), false)
  });

  it("renders the neutral price-only sentence without solar numbers", () => {
    const sentence = sentenceForAdvisory(
      makeAdvisory({
        triggered: false,
        tomorrow_solar_kwh: null,
        compare_solar_kwh: null,
      }),
      false
    );
    assert.equal(sentence, "Tomorrow: \u20AC0.24 average grid price")
  });
});

describe("the Phase E today modes", () => {
  it("composes the peak-avoidance line with hour and price", () => {
    const guidance = makeGuidance({ peak_ahead: true });
    assert.equal(peakAvoidanceLine(guidance), "Avoid the 08:00 peak at \u20AC0.51");
  });

  it("states the evening situation as high against the day's live average", () => {
    const guidance = makeGuidance({
      practical: false,
      day_cheapest_passed: false,
      remaining_average_eur: 0.41,
      day_average_eur: 0.36,
    });
    assert.equal(
      eveningPriceSentence(guidance),
      "This evening's prices stay high, \u20AC0.41 average until midnight"
    );
  });

  it("states the evening average without the high claim when it is not high", () => {
    const guidance = makeGuidance({
      practical: false,
      day_cheapest_passed: false,
      remaining_average_eur: 0.3,
      day_average_eur: 0.36,
    });
    assert.equal(
      eveningPriceSentence(guidance),
      "This evening's prices average \u20AC0.30 until midnight"
    );
  });

  it("composes the evening delay advice with tomorrow's window average", () => {
    assert.equal(
      delaySentence({ tomorrow_window_average_eur: 0.19 }),
      "Delay your large appliances until tomorrow's cheaper hours, from \u20AC0.19 average"
    );
  });
});

describe("the hedged low-solar expectation", () => {
  it("reads as grid reliance with little sun below LOW_SOLAR_SCORE", () => {
    const sentence = sentenceForAdvisory(
      makeAdvisory({
        triggered: false,
        tomorrow_average_eur: null,
        tomorrow_solar_kwh: 2.1,
        tomorrow_solar_score: 12,
        tomorrow_low_solar: true,
        compare_solar_kwh: 14.4,
      }),
      true
    );
    assert.equal(
      sentence,
      "Tomorrow you'll rely mostly on grid energy: little sun is expected"
    );
  });

  it("keeps the hedged market note with the usually qualifier", () => {
    assert.match(LOW_SOLAR_MARKET_NOTE, /usually higher/);
    assert.match(LOW_SOLAR_MARKET_NOTE, /once tomorrow's prices are published/);
  });

  it("keeps the solar comparison above LOW_SOLAR_SCORE", () => {
    const sentence = sentenceForAdvisory(
      makeAdvisory({
        triggered: false,
        tomorrow_average_eur: null,
        tomorrow_solar_kwh: 8.2,
        tomorrow_solar_score: 45,
        tomorrow_low_solar: false,
        compare_solar_kwh: 14.4,
      }),
      true
    );
    assert.equal(
      sentence,
      "8.2 kWh of your own solar expected against today's 14.4"
    );
  });
});
