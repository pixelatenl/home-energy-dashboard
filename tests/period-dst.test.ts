import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { todayString } from "../src/lib/period.ts";

// The "today" anchor resolves in Europe/Amsterdam regardless of the
// process timezone: an instant that is Amsterdam midnight must map to
// the Amsterdam date, not the device's. The assertions use instants
// that straddle the two zones' date boundaries, so a device-local
// resolution would fail them in any timezone offset from Amsterdam by
// an odd number of hours (like UTC, where Amsterdam midnight is still
// the previous evening).

describe("todayString: the Amsterdam-anchored today", () => {
  it("resolves Amsterdam midnight to the Amsterdam date, not the device date", () => {
    // 2026-01-15T00:00 Amsterdam (CET, +1) is still 2026-01-14 in UTC.
    assert.equal(
      todayString(new Date("2026-01-14T23:00:00Z")),
      "2026-01-15",
    );
    // 2026-07-15T00:00 Amsterdam (CEST, +2) is 2026-07-14 in UTC.
    assert.equal(
      todayString(new Date("2026-07-14T22:00:00Z")),
      "2026-07-15",
    );
  });

  it("keeps the transition nights coherent", () => {
    // The fall-back day's last hour: 2026-10-25T23:00Z is Amsterdam
    // midnight of the 26th.
    assert.equal(
      todayString(new Date("2026-10-25T23:00:00Z")),
      "2026-10-26",
    );
    // The spring-forward day starts at 2026-03-28T23:00Z.
    assert.equal(
      todayString(new Date("2026-03-28T23:00:00Z")),
      "2026-03-29",
    );
  });
});
