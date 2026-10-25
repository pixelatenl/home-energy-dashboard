import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amsterdamDayStartMs,
  amsterdamSlotHourOf,
  dateKeyPlus,
  localDateOf,
} from "../src/lib/time.ts";

// The frontend twin of the server's local-day helper: identical
// Europe/Amsterdam semantics, so daily bucket instants compare the
// same on both sides.

describe("localDateOf: daily day keys in Amsterdam", () => {
  it("rolls at summer midnight 22:00Z and winter midnight 23:00Z", () => {
    assert.equal(localDateOf("2026-07-15T22:00:00Z"), "2026-07-16");
    assert.equal(localDateOf("2026-07-15T21:59:59Z"), "2026-07-15");
    assert.equal(localDateOf("2026-01-15T23:00:00Z"), "2026-01-16");
    assert.equal(localDateOf("2026-01-15T22:59:59Z"), "2026-01-15");
  });

  it("keeps the DST fall-back day coherent across its 25 hours", () => {
    assert.equal(localDateOf("2026-10-24T22:00:00Z"), "2026-10-25");
    assert.equal(localDateOf("2026-10-25T01:00:00Z"), "2026-10-25");
    assert.equal(localDateOf("2026-10-25T22:59:59Z"), "2026-10-25");
    assert.equal(localDateOf("2026-10-25T23:00:00Z"), "2026-10-26");
  });
});

describe("amsterdamDayStartMs: the localDayStartUtcMs twin", () => {
  it("matches the energy_daily bucket instants at both offsets", () => {
    assert.equal(
      amsterdamDayStartMs("2026-10-15"),
      Date.parse("2026-10-14T22:00:00Z"),
    );
    assert.equal(
      amsterdamDayStartMs("2026-11-15"),
      Date.parse("2026-11-14T23:00:00Z"),
    );
  });

  it("round-trips through localDateOf across the DST transitions", () => {
    const days = [
      "2026-01-15",
      "2026-03-28",
      "2026-03-29",
      "2026-06-15",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-12-31",
    ];
    for (const day of days) {
      assert.equal(localDateOf(new Date(amsterdamDayStartMs(day)).toISOString()), day);
    }
  });
});

describe("dateKeyPlus: the evening before both DST transitions", () => {
  it("steps onto the 25-hour fall-back day", () => {
    assert.equal(dateKeyPlus("2026-10-24", 1), "2026-10-25");
  });

  it("steps onto the 23-hour spring-forward day", () => {
    assert.equal(dateKeyPlus("2026-03-28", 1), "2026-03-29");
  });
});

describe("amsterdamSlotHourOf: the wall hour of a chronological slot", () => {
  it("reads 02 for both repeated slots of the fall-back day", () => {
    assert.equal(amsterdamSlotHourOf("2026-10-25", 2), 2);
    assert.equal(amsterdamSlotHourOf("2026-10-25", 3), 2);
    assert.equal(amsterdamSlotHourOf("2026-10-25", 4), 3);
    assert.equal(amsterdamSlotHourOf("2026-10-25", 24), 23);
  });

  it("matches the clock on ordinary days", () => {
    assert.equal(amsterdamSlotHourOf("2026-07-15", 3), 3);
    assert.equal(amsterdamSlotHourOf("2026-03-29", 2), 3);
  });
});
