import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveBatteryState } from "../server/live.mjs";

// The live snapshot's battery state (GET /api/live batteryState): net
// charge power at the shared 25 W deadband (POWER_DEADBAND_W in
// queries.mjs, the same threshold batteryStateFromPower reads idle
// at). The server is the single writer; these tests pin the boundary
// so the widget's label can render it verbatim.

const entry = (value, source = "ha", at = 0) => ({ value, source, at });

describe("deriveBatteryState: the shared 25 W deadband", () => {
  it("reads idle within the deadband, including an exact boundary and a zero", () => {
    assert.equal(deriveBatteryState(entry(0), entry(0))?.state, "idle");
    assert.equal(deriveBatteryState(entry(25), entry(0))?.state, "idle");
    assert.equal(deriveBatteryState(entry(0), entry(25))?.state, "idle");
    assert.equal(deriveBatteryState(entry(12), entry(9))?.state, "idle");
    // A stale zero is a valid reading: idle stays idle.
    assert.equal(deriveBatteryState(entry(0), entry(0))?.state, "idle");
  });

  it("reads charging only when net charge power exceeds the deadband", () => {
    assert.equal(deriveBatteryState(entry(26), entry(0))?.state, "charging");
    assert.equal(deriveBatteryState(entry(3000), entry(0))?.state, "charging");
    assert.equal(deriveBatteryState(entry(2600), entry(5))?.state, "charging");
  });

  it("reads discharging only when net discharge power exceeds the deadband", () => {
    assert.equal(deriveBatteryState(entry(0), entry(26))?.state, "discharging");
    assert.equal(
      deriveBatteryState(entry(0), entry(1080))?.state,
      "discharging"
    );
    assert.equal(
      deriveBatteryState(entry(10), entry(2600))?.state,
      "discharging"
    );
  });

  it("is unavailable whenever either power reading is missing - never guessed", () => {
    assert.equal(deriveBatteryState(null, entry(800)), null);
    assert.equal(deriveBatteryState(entry(800), null), null);
    assert.equal(deriveBatteryState(null, null), null);
  });

  it("carries the honest source and the older input's age", () => {
    assert.equal(deriveBatteryState(entry(100), entry(50))?.source, "ha");
    const mixed = deriveBatteryState(
      entry(100, "db", 1000),
      entry(50, "ha", 2000)
    );
    assert.equal(mixed?.source, "db");
    assert.equal(mixed?.at, 1000);
    const both = deriveBatteryState(entry(100, "ha", 5000), entry(50, "ha", 4000));
    assert.equal(both?.source, "ha");
    assert.equal(both?.at, 4000);
  });
});
