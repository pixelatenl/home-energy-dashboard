import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADVISORY_CARD_STYLE_BRIEF,
  advisorySectionsContext,
  prepareAdvisoryRequest,
  serveAdvisoryCard,
} from "../server/advisory-adapter.mjs";
import { getSummaryInsight } from "../server/ai.mjs";
import { localIsoWithOffset } from "../server/time.mjs";

// The advisory adapter: the style brief, the sections context
// projection and the transport merge. The merge serves the core's
// composed card content with the transport fields the summary insight
// path owns, composing from the live facts so the rows never go stale
// between generations.

// A plan-mode request fixture: the A1-shaped facts with the day-cheapest
// average the facts layer supplies, and a quiet-day narrative.
function requestFixture({
  warning = null,
  contextNote = "No appliance run-up clears the bar today, so there is nothing to schedule.",
  corruptLowPrice = false,
  recap = false,
} = {}) {
  const now = recap ? "2026-10-20T19:00:00+02:00" : "2026-10-20T15:30:00+02:00";
  const facts = {
    lowPrice: corruptLowPrice
      ? { timestamp: "12:00", price: Number.NaN }
      : { timestamp: "12:00", price: 0.25 },
    peakPrice: { timestamp: "19:00", price: 0.47 },
    battery: { socPct: 72, state: "charging", todayInKwh: 4.3, todayOutKwh: 2.4 },
    dayAverageEur: 0.38,
    cheapestWindow: { start: "14:00", end: "17:00", averageEur: 0.26 },
    spreadPerKwhEur: 0.12,
    practicalBenefitEur: 0.12,
    co2IntensityGPerKwh: 133,
    solarToday: { actualKwh: 8.6, forecastKwh: 14.4 },
    candidates: [],
    dayCheapestWindow: "12:00-15:00",
    dayCheapestPassed: false,
    dayCheapestAverageEur: 0.26,
    solar_share_pct: recap ? 52 : null,
    battery_earned_eur: recap ? 1.4 : null,
    remainingWindow: {
      start: "21:00",
      end: "00:00",
      averageEur: 0.3,
      practicalBenefitEur: 0.02,
    },
    remainingAverageEur: 0.33,
    dayUsageKwh: 17.5,
    dayCostEur: 2.9,
    tomorrow: {
      pricesPublished: false,
      prices: null,
      solarKwh: 11.99,
      solarScore: 28,
      lowSolar: false,
      compareSolarKwh: 14.4,
    },
    comingDays: [
      {
        weekday: "Wednesday",
        date: "2026-10-21",
        solarKwh: 8.4,
        solarScore: 20,
        condition: "cloudy",
      },
    ],
  };
  return {
    facts,
    nowIso: now,
    styleBrief: ADVISORY_CARD_STYLE_BRIEF,
    narrative: { warning, contextNote },
  };
}

function insightFixture(narrative) {
  return {
    narrative,
    generatedAt: "2026-10-20T15:30:00.000Z",
    asOf: "2026-10-20T15:28:00.000Z",
    state: "fresh",
    stale: false,
    error: null,
  };
}

describe("the style brief", () => {
  it("states the two model-authored slots and the register rules", () => {
    assert.match(ADVISORY_CARD_STYLE_BRIEF, /"warning"/);
    assert.match(ADVISORY_CARD_STYLE_BRIEF, /"contextNote"/);
    assert.match(ADVISORY_CARD_STYLE_BRIEF, /second person/);
    assert.match(ADVISORY_CARD_STYLE_BRIEF, /No figures/);
    assert.match(ADVISORY_CARD_STYLE_BRIEF, /No exclamation marks/);
    assert.match(ADVISORY_CARD_STYLE_BRIEF, /never restate/i);
    assert.match(ADVISORY_CARD_STYLE_BRIEF, /only imperative voice/);
    assert.match(ADVISORY_CARD_STYLE_BRIEF, /quiet days/);
    // The brief itself carries no exclamation mark.
    assert.ok(!ADVISORY_CARD_STYLE_BRIEF.includes("!"));
  });
});

describe("serveAdvisoryCard: the transport merge", () => {
  it("serves the composed card content with the transport fields", () => {
    const request = requestFixture();
    const payload = serveAdvisoryCard(request, insightFixture(request.narrative));
    assert.equal(payload.warning, null);
    assert.equal(payload.context_note, request.narrative.contextNote);
    assert.equal(payload.no_opportunity, true);
    assert.ok(Array.isArray(payload.achievements));
    assert.equal(payload.guidance.window, "14:00-17:00");
    assert.equal(payload.guidance.cheapest_window_average_eur, 0.26);
    assert.equal(payload.priceSentence.includes("€0.25"), true);
    assert.equal(payload.generated_at, "2026-10-20T15:30:00.000Z");
    assert.equal(payload.insight_as_of, "2026-10-20T15:28:00.000Z");
    assert.equal(payload.state, "fresh");
    assert.equal(payload.stale, false);
    assert.equal(payload.error, null);
  });

  it("folds the facts layer's day-cheapest average into the guidance", () => {
    const request = requestFixture();
    const payload = serveAdvisoryCard(request, insightFixture(request.narrative));
    assert.equal(payload.guidance.day_cheapest_average_eur, 0.26);
  });

  it("serves the achievements in recap mode when the facts qualify", () => {
    const request = requestFixture({ recap: true });
    const payload = serveAdvisoryCard(request, insightFixture(request.narrative));
    assert.deepEqual(payload.achievements, [
      "Your own solar covered 52% of today's usage.",
      "Your battery earned €1.40 today.",
    ]);
  });

  it("serves no achievements in plan mode", () => {
    const request = requestFixture();
    const payload = serveAdvisoryCard(request, insightFixture(request.narrative));
    assert.deepEqual(payload.achievements, []);
  });

  it("re-validates the narrative against the live sections on every serve", () => {
    // A contextNote while an action exists is invalid (contract section
    // 4); the recomposition drops it instead of serving it stale.
    const request = requestFixture();
    request.facts.candidates = [
      {
        label: "Dishwasher",
        kwh: 1.07,
        savingEur: 0.12,
        window: "14:00-17:00 today",
        worthwhile: true,
      },
    ];
    const payload = serveAdvisoryCard(request, insightFixture(request.narrative));
    assert.equal(payload.context_note, null);
    assert.equal(payload.primary_action.what, "Run the Dishwasher");
  });

  it("drops a corrupt lowPrice object entirely, never serves it as null", () => {
    const request = requestFixture({ corruptLowPrice: true });
    const payload = serveAdvisoryCard(request, insightFixture(request.narrative));
    assert.ok(!("lowPrice" in payload));
    // The low is missing, so the price sentence carries the peak only.
    assert.equal(payload.priceSentence, "The peak price so far is €0.47 at 19:00.");
  });

  it("serves the empty transport state without a narrative", () => {
    const payload = serveAdvisoryCard(requestFixture(), {
      narrative: null,
      generatedAt: null,
      asOf: null,
      state: "error",
      stale: false,
      error: "ai_unavailable",
    });
    assert.equal(payload.warning, null);
    assert.equal(payload.context_note, null);
    assert.equal(payload.generated_at, null);
    assert.equal(payload.state, "error");
    assert.equal(payload.error, "ai_unavailable");
  });
});

describe("advisorySectionsContext: the read-only model input", () => {
  it("projects now_local, today_date and the sections", () => {
    const request = requestFixture();
    const context = advisorySectionsContext(request);
    assert.equal(context.now_local, request.nowIso);
    assert.equal(context.today_date, "2026-10-20");
    const ids = context.sections.map((section) => section.id);
    assert.ok(ids.includes("today"));
    assert.ok(ids.includes("tomorrow"));
    assert.ok(ids.includes("coming_days"));
    assert.ok(
      context.sections.every((section) => typeof section.guidance === "string")
    );
  });
});

describe("prepareAdvisoryRequest", () => {
  it("injects nowIso and the style brief alongside the facts", async () => {
    const request = await prepareAdvisoryRequest(
      { summary: null, weatherDaily: null, priceParts: null, extras: {} },
      {
        batteryArbitrageEur: async () => null,
        tomorrowHourlyPrices: async () => [],
      }
    );
    assert.equal(request.styleBrief, ADVISORY_CARD_STYLE_BRIEF);
    assert.match(request.nowIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.equal(request.nowIso, localIsoWithOffset(new Date()));
    assert.equal(request.facts.lowPrice, null);
    assert.equal(request.facts.solar_share_pct, null);
  });
});

describe("getSummaryInsight with the advisory request", () => {
  it("degrades to the narrative-shaped empty state when the budget is exhausted", async () => {
    process.env.MISTRAL_DAILY_CALL_LIMIT = "0";
    try {
      const result = await getSummaryInsight(
        {
          summary: null,
          weatherDaily: null,
          priceParts: null,
          extras: {},
          signature: "test-signature",
          asOf: "2026-10-20T15:28:00.000Z",
        },
        { advisory: requestFixture() }
      );
      assert.equal(result.narrative, null);
      assert.equal(result.generatedAt, null);
      assert.equal(result.state, "error");
      assert.equal(result.error, "daily_limit_reached");
    } finally {
      delete process.env.MISTRAL_DAILY_CALL_LIMIT;
    }
  });

  it("fails soft without an advisory request", async () => {
    const result = await getSummaryInsight(
      {
        summary: null,
        weatherDaily: null,
        priceParts: null,
        extras: {},
        signature: "test-signature",
        asOf: "2026-10-20T15:28:00.000Z",
      },
      { force: true }
    );
    assert.equal(result.narrative, null);
    assert.equal(result.state, "error");
    assert.equal(result.error, "ai_unavailable");
  });
});
