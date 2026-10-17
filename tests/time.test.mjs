import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localDateKey, localDayStartUtcMs } from "../server/time.mjs";

// The local-day helper behind every daily bucket decision: localDateKey
// derives the Europe/Amsterdam calendar day of an instant, and
// localDayStartUtcMs the instant of a local midnight - the values the
// energy_daily buckets (migration 002) and the period windows use.
// Never a UTC-serialized string: 22:00Z is midnight in summer but
// 23:00 local in winter.

const utc = (iso) => new Date(iso);

describe("localDateKey: instants near local midnight (summer, CEST +2)", () => {
  it("rolls to the next local day at 22:00Z", () => {
    assert.equal(localDateKey(utc("2026-07-15T22:00:00Z")), "2026-07-16");
  });

  it("stays on the local day at 21:59Z", () => {
    assert.equal(localDateKey(utc("2026-07-15T21:59:59Z")), "2026-07-15");
  });

  it("is on the next local day at 22:01Z", () => {
    assert.equal(localDateKey(utc("2026-07-15T22:01:00Z")), "2026-07-16");
  });
});

describe("localDateKey: instants near local midnight (winter, CET +1)", () => {
  it("rolls to the next local day at 23:00Z", () => {
    assert.equal(localDateKey(utc("2026-01-15T23:00:00Z")), "2026-01-16");
  });

  it("stays on the local day at 22:59Z", () => {
    assert.equal(localDateKey(utc("2026-01-15T22:59:59Z")), "2026-01-15");
  });

  it("is on the next local day at 23:01Z", () => {
    assert.equal(localDateKey(utc("2026-01-15T23:01:00Z")), "2026-01-16");
  });

  it("reads 22:00Z as 23:00 local, an hour before midnight", () => {
    assert.equal(localDateKey(utc("2026-01-15T22:00:00Z")), "2026-01-15");
  });
});

describe("localDateKey: month and year boundaries", () => {
  it("rolls into the next month at the summer midnight 22:00Z", () => {
    assert.equal(localDateKey(utc("2026-06-30T22:00:00Z")), "2026-07-01");
  });

  it("stays in the old month at 21:59Z", () => {
    assert.equal(localDateKey(utc("2026-06-30T21:59:59Z")), "2026-06-30");
  });

  it("rolls into the next month at the winter midnight 23:00Z", () => {
    assert.equal(localDateKey(utc("2026-11-30T23:00:00Z")), "2026-12-01");
  });

  it("rolls into the next year at the winter midnight 23:00Z", () => {
    assert.equal(localDateKey(utc("2026-12-31T23:00:00Z")), "2027-01-01");
  });
});

describe("localDateKey: the DST fall-back day", () => {
  // The clocks fall back on Sunday 2026-10-25 (03:00 CEST to 02:00 CET
  // at 01:00Z), making local 25 October 25 hours long: it starts at
  // 22:00Z on 24 October and ends just before 23:00Z on 25 October.

  it("starts the 25-hour day at 22:00Z the evening before", () => {
    assert.equal(localDateKey(utc("2026-10-24T22:00:00Z")), "2026-10-25");
  });

  it("spans the transition instant itself", () => {
    assert.equal(localDateKey(utc("2026-10-25T01:00:00Z")), "2026-10-25");
  });

  it("still reads 25 October at 22:59Z, an hour before the day ends", () => {
    assert.equal(localDateKey(utc("2026-10-25T22:59:59Z")), "2026-10-25");
  });

  it("ends the day at 23:00Z, the later winter midnight", () => {
    assert.equal(localDateKey(utc("2026-10-25T23:00:00Z")), "2026-10-26");
  });
});

describe("localDayStartUtcMs: daily bucket starts at local midnight", () => {
  it("matches the energy_daily bucket convention from migration 002", () => {
    // Local midnight on 2026-10-15 is 2026-10-14T22:00:00Z in CEST.
    assert.equal(
      localDayStartUtcMs("2026-10-15"),
      Date.parse("2026-10-14T22:00:00Z")
    );
  });

  it("uses the winter offset after the fall-back", () => {
    assert.equal(
      localDayStartUtcMs("2026-11-15"),
      Date.parse("2026-11-14T23:00:00Z")
    );
  });

  it("round-trips through localDateKey at both offsets and transitions", () => {
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
      assert.equal(localDateKey(new Date(localDayStartUtcMs(day))), day);
    }
  });

  it("makes the fall-back day 25 hours and the spring day 23", () => {
    const fallBack =
      localDayStartUtcMs("2026-10-26") - localDayStartUtcMs("2026-10-25");
    const spring =
      localDayStartUtcMs("2026-03-30") - localDayStartUtcMs("2026-03-29");
    assert.equal(fallBack, 25 * 3_600_000);
    assert.equal(spring, 23 * 3_600_000);
  });
});
