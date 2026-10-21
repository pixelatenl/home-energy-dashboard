import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGuidance } from "../server/context.mjs";
import {
  GUIDANCE_MIN_SPREAD_EUR,
  PRACTICAL_MIN_ADVANTAGE_EUR,
} from "../server/advisory-constants.mjs";

// The C17 evening-window gate: an evening window (roughly 21:00 to
// 00:00) whose expected benefit against the day's average sits below
// the practicality threshold (0.05, the minimum benefit worth acting
// on - never the 0.03 minimum detectable spread) is stated in the
// served guidance as a plain fact, never with imperative wording.
// The gate's inputs (`evening_window`, `expected_benefit_eur`) ride
// the guidance object; the advisory core composes the line from them.

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
  });});
