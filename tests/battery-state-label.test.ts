import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BATTERY_IDLE_MESSAGE, batteryStateLabel } from "../src/lib/batteryStateLabel.ts";

describe("batteryStateLabel: the display-layer state-to-label mapping", () => {
  it("spells out the flowing states verbatim", () => {
    assert.equal(batteryStateLabel("charging"), "Charging");
    assert.equal(batteryStateLabel("discharging"), "Discharging");
  });

  it("reads idle as the household message, not a bare word", () => {
    assert.equal(BATTERY_IDLE_MESSAGE, "Awaiting its moment");
    assert.equal(batteryStateLabel("idle"), BATTERY_IDLE_MESSAGE);
  });

  it("keeps an honest unknown for unavailable and missing input", () => {
    assert.equal(batteryStateLabel("unavailable"), "unknown");
    assert.equal(batteryStateLabel(null), "unknown");
    assert.equal(batteryStateLabel(undefined), "unknown");
  });

  it("never throws on partial or unrecognized snapshots, and never fabricates the message", () => {
    for (const odd of ["", "IDLE", "charging ", "idle-state"]) {
      assert.doesNotThrow(() => batteryStateLabel(odd));
      assert.equal(batteryStateLabel(odd), "unknown");
    }
  });
});
