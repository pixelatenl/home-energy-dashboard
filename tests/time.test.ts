import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amsterdamDayHourCount,
  amsterdamDayStartMs,
  amsterdamElapsedHoursOf,
  amsterdamHourIndexOf,
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

describe("amsterdamDayHourCount: the true length of a local day", () => {
  it("is 25 on the fall-back day, 23 on the spring-forward day", () => {
    assert.equal(amsterdamDayHourCount("2026-10-25"), 25);
    assert.equal(amsterdamDayHourCount("2026-03-29"), 23);
    assert.equal(amsterdamDayHourCount("2026-07-15"), 24);
  });
});

describe("amsterdamHourIndexOf and amsterdamElapsedHoursOf: DST-true positions", () => {
  it("counts the repeated 02:00 hour of the fall-back day", () => {
    // 00:30Z is 02:30 CEST, chronological slot 2.
    assert.equal(
      amsterdamHourIndexOf(Date.parse("2026-10-25T00:30:00Z"), "2026-10-25"),
      2,
    );
    // 01:30Z is 02:30 CET, the repeated hour: chronological slot 3,
    // where the wall-clock hour would have pointed back at slot 2.
    assert.equal(
      amsterdamHourIndexOf(Date.parse("2026-10-25T01:30:00Z"), "2026-10-25"),
      3,
    );
    assert.equal(
      amsterdamElapsedHoursOf(Date.parse("2026-10-25T01:30:00Z")),
      3.5,
    );
  });

  it("matches the wall clock on ordinary days", () => {
    assert.equal(
      amsterdamElapsedHoursOf(Date.parse("2026-07-15T13:30:00Z")),
      15.5,
    );
  });
});
