import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatGridWatts,
  gridPulsePeriodS,
  gridPulseStep,
  GRID_PULSE_DEADBAND_W,
  GRID_PULSE_MAX_STEP,
  GRID_PULSE_STEP_W,
} from "../src/lib/gridPulse.ts";

describe("gridPulseStep: the discrete pulse steps", () => {
  it("rests at step 0 below and at the deadband, with no animation", () => {
    for (const draw of [0, 5, 25]) {
      assert.equal(gridPulseStep(draw), 0);
    }
    assert.equal(gridPulsePeriodS(0), null);
  });

  it("starts pulsing at the first step above the deadband", () => {
    assert.equal(gridPulseStep(26), 1);
    assert.equal(gridPulseStep(499), 1);
    assert.equal(gridPulseStep(900), 1);
  });

  it("keeps steps discrete: 499 W and 900 W behave identically, 1000 W jumps one step", () => {
    assert.equal(gridPulseStep(499), gridPulseStep(900));
    assert.equal(gridPulseStep(1000), gridPulseStep(900) + 1);
  });

  it("caps at the max step, however high the draw climbs", () => {
    assert.equal(gridPulseStep(3000), GRID_PULSE_MAX_STEP);
    assert.equal(gridPulseStep(12000), GRID_PULSE_MAX_STEP);
    assert.equal(GRID_PULSE_STEP_W, 500);
    assert.equal(GRID_PULSE_DEADBAND_W, 25);
  });
});

describe("gridPulsePeriodS: one linear mapping from step to period", () => {
  it("breathes once per 4 s at the first step, 0.8 s at the max step", () => {
    assert.equal(gridPulsePeriodS(1), 4);
    assert.ok(Math.abs(gridPulsePeriodS(GRID_PULSE_MAX_STEP) - 0.8) < 1e-12);
  });

  it("decreases linearly between the steps, never hardcoded per step", () => {
    const span = 4 - 0.8;
    for (let step = 1; step <= GRID_PULSE_MAX_STEP; step += 1) {
      const expected = 4 - (span * (step - 1)) / (GRID_PULSE_MAX_STEP - 1);
      assert.ok(Math.abs(gridPulsePeriodS(step) - expected) < 1e-12);
    }
    // Every step is strictly faster than the one before.
    for (let step = 2; step <= GRID_PULSE_MAX_STEP; step += 1) {
      assert.ok(gridPulsePeriodS(step) < gridPulsePeriodS(step - 1));
    }
  });
});

describe("formatGridWatts: the human label", () => {
  it("shows watts below 1000 W, kilowatts with one decimal from 1000 up", () => {
    assert.equal(formatGridWatts(420), "420 W");
    assert.equal(formatGridWatts(999), "999 W");
    assert.equal(formatGridWatts(1000), "1.0 kW");
    assert.equal(formatGridWatts(2380), "2.4 kW");
  });
});
