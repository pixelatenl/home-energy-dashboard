import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimsBatteryState,
  composeBatterySentence,
  composePriceSentence,
  SUMMARY_SYSTEM_PROMPT_STRUCTURED,
} from "../server/ai.mjs";
import { buildFacts } from "../server/context.mjs";

// The grounding facts for the advisory's price and battery sentences:
// today's lowest and peak price with their own timestamps and the
// battery state verbatim from the summary values, each null when its
// data is missing, and the deterministic sentences composed from
// those fields - never by the model.

// A synthetic priced day: the low and the peak with their own hours.
function pricedDay({
  lowHour = "02:00",
  lowPrice = 0.19,
  peakHour = "08:00",
  peakPrice = 0.41,
} = {}) {
  return {
    priceData: {
      today: {
        average: 0.3,
        min: lowPrice,
        max: peakPrice,
        low_hour: lowHour,
        peak_hour: peakHour,
      },
    },
  };
}

// A synthetic battery summary: the SOC percentage and the state.
function batterySummary({ soc = 72, state = "idle" } = {}) {
  return { battery_soc_pct: soc, battery_state: state };
}

describe("buildFacts", () => {
  it("pairs today's low and peak with their own timestamps", () => {
    const facts = buildFacts(pricedDay(), batterySummary());
    assert.deepEqual(facts.lowPrice, { timestamp: "02:00", price: 0.19 });
    assert.deepEqual(facts.peakPrice, { timestamp: "08:00", price: 0.41 });
  });

  it("carries the battery state verbatim from the context values", () => {
    const facts = buildFacts(pricedDay(), batterySummary());
    assert.deepEqual(facts.battery, { soc_pct: 72, state: "idle" });
  });

  it("carries charging and discharging states verbatim", () => {
    assert.deepEqual(
      buildFacts(pricedDay(), batterySummary({ soc: 45, state: "charging" }))
        .battery,
      { soc_pct: 45, state: "charging" }
    );
    assert.deepEqual(
      buildFacts(pricedDay(), batterySummary({ soc: 12, state: "discharging" }))
        .battery,
      { soc_pct: 12, state: "discharging" }
    );
  });

  it("nulls every price fact when there is no price curve", () => {
    const facts = buildFacts(null, batterySummary());
    assert.equal(facts.lowPrice, null);
    assert.equal(facts.peakPrice, null);
  });

  it("nulls the price facts when the day statistics are missing", () => {
    const facts = buildFacts({ priceData: { today: null } }, batterySummary());
    assert.equal(facts.lowPrice, null);
    assert.equal(facts.peakPrice, null);
  });

  it("nulls the battery fact when the battery data is missing", () => {
    assert.equal(buildFacts(pricedDay(), null).battery, null);
    assert.equal(
      buildFacts(pricedDay(), batterySummary({ soc: null, state: "idle" }))
        .battery,
      null
    );
    assert.equal(
      buildFacts(
        pricedDay(),
        batterySummary({ soc: 72, state: "unavailable" })
      ).battery,
      null
    );
  });
});

describe("composePriceSentence: the low/peak pairing", () => {
  it("names 02:00 as the low and 08:00 as the peak, always paired", () => {
    const sentence = composePriceSentence(buildFacts(pricedDay(), null));
    assert.equal(
      sentence,
      "Lowest price around 02:00 (€0.19); peak around 08:00 (€0.41)."
    );
  });

  it("keeps the pairing on a different synthetic day", () => {
    const sentence = composePriceSentence(
      buildFacts(
        pricedDay({
          lowHour: "03:00",
          lowPrice: 0.11,
          peakHour: "21:00",
          peakPrice: 0.52,
        }),
        null
      )
    );
    assert.equal(
      sentence,
      "Lowest price around 03:00 (€0.11); peak around 21:00 (€0.52)."
    );
  });

  it("is omitted entirely when the price data is missing", () => {
    assert.equal(composePriceSentence(null), null);
    assert.equal(composePriceSentence(buildFacts(null, null)), null);
  });

  it("is omitted when either half of the pairing is missing", () => {
    const facts = buildFacts(pricedDay(), null);
    assert.equal(composePriceSentence({ ...facts, lowPrice: null }), null);
    assert.equal(composePriceSentence({ ...facts, peakPrice: null }), null);
  });

  it("renders a sub-cent price without approximating it to 0.00", () => {
    const sentence = composePriceSentence({
      lowPrice: { timestamp: "04:00", price: 0.0035 },
      peakPrice: { timestamp: "19:00", price: 0.28 },
    });
    assert.equal(sentence, "Lowest price around 04:00 (€0.0035); peak around 19:00 (€0.28).");
  });
});

describe("composeBatterySentence", () => {
  it("states the SOC and the state from the context values", () => {
    const facts = buildFacts(pricedDay(), batterySummary());
    assert.equal(composeBatterySentence(facts), "The battery is at 72% and is idle.");
  });

  it("states the charging state", () => {
    const facts = buildFacts(
      pricedDay(),
      batterySummary({ soc: 45, state: "charging" })
    );
    assert.equal(
      composeBatterySentence(facts),
      "The battery is at 45% and is charging."
    );
  });

  it("is omitted entirely when the battery data is missing", () => {
    assert.equal(composeBatterySentence(null), null);
    assert.equal(composeBatterySentence(buildFacts(pricedDay(), null)), null);
  });
});

describe("claimsBatteryState: the model's battery guard", () => {
  it("flags a fully charged claim", () => {
    assert.equal(claimsBatteryState("The battery is fully charged"), true);
  });

  it("flags a percentage claim", () => {
    assert.equal(claimsBatteryState("The battery is at 95%"), true);
    assert.equal(claimsBatteryState("Your battery sits at 40 percent"), true);
  });

  it("flags empty, idle and discharging claims", () => {
    assert.equal(
      claimsBatteryState("the battery has stayed empty and idle"),
      true
    );
    assert.equal(
      claimsBatteryState("The battery is discharging into the evening peak"),
      true
    );
  });

  it("allows abstract battery references", () => {
    assert.equal(
      claimsBatteryState(
        "The battery needs attention before tonight's peak; check its settings"
      ),
      false
    );
    assert.equal(
      claimsBatteryState(
        "No appliance used enough power today to make shifting worthwhile"
      ),
      false
    );
  });

  it("ignores sentences that do not name the battery", () => {
    assert.equal(claimsBatteryState("Solar covered 45% of usage today"), false);
    assert.equal(claimsBatteryState(null), false);
  });
});

describe("the summary prompt restricts the model", () => {
  it("restricts battery-state claims to abstract references", () => {
    assert.match(
      SUMMARY_SYSTEM_PROMPT_STRUCTURED,
      /reference the battery only abstractly/
    );
  });

  it("keeps the lowest and peak price hours out of the model's words", () => {
    assert.match(
      SUMMARY_SYSTEM_PROMPT_STRUCTURED,
      /Never name today's lowest or peak price or their hours in your own words/
    );
  });
});
