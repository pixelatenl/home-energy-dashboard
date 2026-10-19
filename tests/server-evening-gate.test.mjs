import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGuidance } from "../server/context.mjs";
import { composeGuidanceLine } from "../server/ai.mjs";
import {
  GUIDANCE_MIN_SPREAD_EUR,
  PRACTICAL_MIN_ADVANTAGE_EUR,
} from "../server/advisory-constants.mjs";

// The C17 evening-window gate: an evening window (roughly 21:00 to
// 00:00) whose expected benefit against the day's average sits below
// the practicality threshold (0.05, the minimum benefit worth acting
// on - never the 0.03 minimum detectable spread) is stated in the
// served guidance line as a plain fact, never with imperative
// wording. Windows at or above the threshold keep the imperative
// advisory voice, and windows outside the evening range are
// untouched.

assert.equal(GUIDANCE_MIN_SPREAD_EUR, 0.03);
assert.equal(PRACTICAL_MIN_ADVANTAGE_EUR, 0.05);

// A future evening window so the tests stay deterministic at any hour
// of any day: 21:00-00:00 local Amsterdam, full length remaining.
function eveningParts({ windowAvg, dayAverage, dayMax = 0.41 } = {}) {
  return {
    cheapestByDay: {
      today: {
        start: "2027-06-15T21:00:00+02:00",
        end: "2027-06-16T00:00:00+02:00",
        average_price: windowAvg,
      },
    },
    priceData: {
      today: { average: dayAverage, max: dayMax, peak_hour: "08:00" },
    },
    dayCheapestWindow: null,
  };
}

// The same shape with a daytime window, for the unchanged-behavior
// control.
function daytimeParts({ windowAvg, dayAverage, dayMax = 0.41 } = {}) {
  return {
    cheapestByDay: {
      today: {
        start: "2027-06-15T12:00:00+02:00",
        end: "2027-06-15T15:00:00+02:00",
        average_price: windowAvg,
      },
    },
    priceData: {
      today: { average: dayAverage, max: dayMax, peak_hour: "08:00" },
    },
    dayCheapestWindow: null,
  };
}

describe("buildGuidance: the C17 gate inputs", () => {
  it("marks the evening window and computes its expected benefit", () => {
    const g = buildGuidance(eveningParts({ windowAvg: 0.28, dayAverage: 0.31 }));
    assert.notEqual(g, null);
    assert.equal(g.evening_window, true);
    assert.equal(g.expected_benefit_eur, 0.03);
    assert.equal(g.window, "21:00-00:00 today");
  });

  it("never marks a daytime window as evening", () => {
    const g = buildGuidance(daytimeParts({ windowAvg: 0.25, dayAverage: 0.31 }));
    assert.notEqual(g, null);
    assert.equal(g.evening_window, false);
    assert.equal(g.expected_benefit_eur, 0.06);
  });
});

describe("composeGuidanceLine: the C17 evening-window gate", () => {
  it("renders the recorded scenario (21:00-00:00, EUR 0.03 benefit) as plain fact", () => {
    const g = buildGuidance(eveningParts({ windowAvg: 0.28, dayAverage: 0.31 }));
    const line = composeGuidanceLine(g);
    assert.equal(
      line,
      "Prices are low between 21:00 and 00:00 (€0.03 below average)."
    );
    // No imperative wording below the threshold.
    assert.doesNotMatch(line, /running|run|shift|dishwasher/i);
  });

  it("keeps the imperative advisory voice for a genuinely beneficial evening window", () => {
    const g = buildGuidance(eveningParts({ windowAvg: 0.16, dayAverage: 0.31 }));
    const line = composeGuidanceLine(g);
    assert.equal(g.expected_benefit_eur, 0.15);
    assert.match(line, /running heavy appliances/);
    assert.match(line, /21:00-00:00 today/);
  });

  it("is deterministic at the threshold exactly: 0.05 commands, 0.04 does not", () => {
    // 0.31 - 0.26 rounds to exactly 0.05: at the threshold, the
    // imperative voice stays.
    const at = buildGuidance(eveningParts({ windowAvg: 0.26, dayAverage: 0.31 }));
    assert.equal(at.expected_benefit_eur, 0.05);
    assert.match(composeGuidanceLine(at), /running heavy appliances/);

    const below = buildGuidance(
      eveningParts({ windowAvg: 0.26, dayAverage: 0.3 })
    );
    assert.equal(below.expected_benefit_eur, 0.04);
    assert.equal(
      composeGuidanceLine(below),
      "Prices are low between 21:00 and 00:00 (€0.04 below average)."
    );
  });

  it("states the window plainly when an evening window has no computable benefit", () => {
    const g = buildGuidance(eveningParts({ windowAvg: 0.28, dayAverage: null }));
    const line = composeGuidanceLine(g);
    assert.equal(
      line,
      "The cheapest remaining window today is 21:00-00:00 today at €0.28 average."
    );
    assert.doesNotMatch(line, /running|run|shift|dishwasher/i);
  });

  it("demotes an evening window whose benefit is negative, without the low claim", () => {
    const g = buildGuidance(eveningParts({ windowAvg: 0.33, dayAverage: 0.31 }));
    assert.equal(g.expected_benefit_eur, -0.02);
    const line = composeGuidanceLine(g);
    assert.equal(
      line,
      "The cheapest remaining window today is 21:00-00:00 today at €0.33 average."
    );
  });

  it("leaves daytime windows untouched regardless of their benefit", () => {
    const g = buildGuidance(daytimeParts({ windowAvg: 0.28, dayAverage: 0.31 }));
    const line = composeGuidanceLine(g);
    assert.equal(g.evening_window, false);
    assert.equal(
      line,
      "Cheapest remaining window today is 12:00-15:00 today at €0.28 average; running heavy appliances then instead of the 08:00 peak saves about €0.13 per kWh."
    );
  });

  it("keeps the imperative advisory voice for an evening window above the evening pivot but below 21:00", () => {
    // An evening window is any window the pivot blocks; the gate is
    // the benefit, never the clock position past the pivot.
    const parts = {
      cheapestByDay: {
        today: {
          start: "2027-06-15T19:00:00+02:00",
          end: "2027-06-15T22:00:00+02:00",
          average_price: 0.16,
        },
      },
      priceData: {
        today: { average: 0.31, max: 0.41, peak_hour: "08:00" },
      },
      dayCheapestWindow: null,
    };
    const g = buildGuidance(parts);
    assert.equal(g.evening_window, true);
    assert.equal(g.expected_benefit_eur, 0.15);
    assert.match(composeGuidanceLine(g), /running heavy appliances/);
  });
});
