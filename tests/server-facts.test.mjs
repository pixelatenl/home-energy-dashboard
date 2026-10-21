import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFacts } from "../server/context.mjs";

// The grounding facts for the advisory: today's lowest and peak price
// with their own timestamps and the battery state verbatim from the
// summary values, each null when its data is missing - never guessed.

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
  });});
