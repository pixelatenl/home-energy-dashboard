import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DATA_STALE_AFTER_MS,
  isDataStale,
  snapshotAgeMs,
} from "../src/lib/time.ts";

// A fixed clock so the age arithmetic is deterministic.
const NOW = Date.parse("2026-10-20T14:35:00Z");

describe("snapshotAgeMs: the snapshot's age against a given clock", () => {
  it("measures a stamp five minutes before now as about 300000 ms", () => {
    const asOf = new Date(NOW - 5 * 60_000).toISOString();
    assert.equal(snapshotAgeMs(asOf, NOW), 300_000);
  });

  it("returns null for missing or invalid stamps without throwing", () => {
    assert.equal(snapshotAgeMs(null, NOW), null);
    assert.equal(snapshotAgeMs(undefined, NOW), null);
    assert.equal(snapshotAgeMs("", NOW), null);
    assert.equal(snapshotAgeMs("not a timestamp", NOW), null);
  });

  it("clamps a future-dated stamp to zero age", () => {
    const asOf = new Date(NOW + 60_000).toISOString();
    assert.equal(snapshotAgeMs(asOf, NOW), 0);
  });
});

describe("isDataStale: the 15-minute boundary", () => {
  it("flags stale exactly at the threshold (inclusive)", () => {
    const asOf = new Date(NOW - DATA_STALE_AFTER_MS).toISOString();
    assert.equal(snapshotAgeMs(asOf, NOW), DATA_STALE_AFTER_MS);
    assert.equal(isDataStale(DATA_STALE_AFTER_MS), true);
  });

  it("stays fresh one millisecond below the threshold", () => {
    const asOf = new Date(NOW - DATA_STALE_AFTER_MS + 1).toISOString();
    assert.equal(snapshotAgeMs(asOf, NOW), DATA_STALE_AFTER_MS - 1);
    assert.equal(isDataStale(DATA_STALE_AFTER_MS - 1), false);
  });
});
