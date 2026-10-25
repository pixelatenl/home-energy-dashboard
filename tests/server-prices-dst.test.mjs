import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentPriceEntry,
  mergePriceCurve,
} from "../server/prices.mjs";
import { localDayStartUtcMs } from "../server/time.mjs";

// The DST correctness of the merged price curve: the curve is keyed by
// the UTC hour bucket, so the two 02:00 tariffs of the 25-hour
// fall-back day (2026-10-25) both survive, and the current-hour
// selection resolves by timestamp containment instead of the
// ambiguous wall-clock hour.

const FALL_BACK_DAY = "2026-10-25";
// The fall-back day runs from 2026-10-24T22:00Z (midnight CEST) to
// 2026-10-25T23:00Z (midnight CET): 25 hourly buckets.
const FALL_BACK_START_MS = localDayStartUtcMs(FALL_BACK_DAY);

// A completed-hour database row at hour `index` of the fall-back day.
function dbRow(index, price) {
  return {
    ts: new Date(FALL_BACK_START_MS + index * 3_600_000),
    price_eur: price,
  };
}

// A Zonneplan quarter-hourly forecast block at a UTC instant.
function haBlock(iso, amount) {
  return { start_date: iso, price_tax_included: { amount } };
}

function mergeArgs({ nowMs, dbRows, forecast }) {
  return {
    now: new Date(nowMs),
    currentHourMs: Math.floor(nowMs / 3_600_000) * 3_600_000,
    todayKey: FALL_BACK_DAY,
    tomorrowKey: "2026-10-26",
    windowEndKey: "2026-10-27",
    dbRows,
    forecast,
  };
}

describe("mergePriceCurve: the 25-hour fall-back day", () => {
  // 25 distinct hourly prices for the whole local day, the two 02:00
  // hours (UTC 00:00 and 01:00) deliberately different.
  const dbRows = Array.from({ length: 25 }, (_, index) =>
    dbRow(index, index === 2 ? 0.21 : index === 3 ? 0.22 : 0.1)
  );
  // 25 completed hours: now sits at the day's last instant, after the
  // final bucket (2026-10-25T23:00Z) has closed.
  const nowMs = FALL_BACK_START_MS + 25 * 3_600_000;

  it("keeps all 25 hours, both 02:00 tariffs included", () => {
    const { entries } = mergePriceCurve(mergeArgs({ nowMs, dbRows, forecast: [] }));
    assert.equal(entries.length, 25);
    const utc00 = entries.find(
      (entry) => entry.ts.getTime() === Date.parse("2026-10-25T00:00:00Z")
    );
    const utc01 = entries.find(
      (entry) => entry.ts.getTime() === Date.parse("2026-10-25T01:00:00Z")
    );
    assert.ok(utc00, "the 02:00 CEST hour is present");
    assert.ok(utc01, "the 02:00 CET hour is present");
    assert.equal(utc00.price, 0.21);
    assert.equal(utc01.price, 0.22);
  });

  it("buckets the quarter-hourly forecast by the UTC hour", () => {
    // Four quarter-hour blocks inside one UTC hour average into one
    // entry; on the wall-clock key they would still, but blocks in the
    // two repeated 02:00 hours would merge into one bucket.
    const forecast = [
      haBlock("2026-10-25T05:00:00Z", 20_000_000),
      haBlock("2026-10-25T05:15:00Z", 24_000_000),
      haBlock("2026-10-25T05:30:00Z", 28_000_000),
      haBlock("2026-10-25T05:45:00Z", 28_000_000),
      haBlock("2026-10-25T00:15:00Z", 10_000_000),
      haBlock("2026-10-25T00:45:00Z", 30_000_000),
    ];
    // now gates the db rows to the first five completed hours; the
    // current hour is 05:00Z, so the HA buckets cover 05:00Z onward.
    const nowMs = FALL_BACK_START_MS + 6 * 3_600_000;
    const { entries } = mergePriceCurve(
      mergeArgs({ nowMs, dbRows: dbRows.slice(0, 5), forecast })
    );
    const hour05 = entries.find(
      (entry) => entry.ts.getTime() === Date.parse("2026-10-25T05:00:00Z")
    );
    assert.equal(hour05.source, "ha");
    assert.equal(hour05.price, 2.5);
    // The two 02:00 hours both keep their distinct db tariffs.
    const utc00 = entries.find(
      (entry) => entry.ts.getTime() === Date.parse("2026-10-25T00:00:00Z")
    );
    const utc01 = entries.find(
      (entry) => entry.ts.getTime() === Date.parse("2026-10-25T01:00:00Z")
    );
    assert.equal(utc00.price, 0.21);
    assert.equal(utc01.price, 0.22);
  });

  it("reports tomorrow from the UTC-hour bucketed forecast", () => {
    const forecast = [haBlock("2026-10-26T05:00:00Z", 20_000_000)];
    const nowMs = FALL_BACK_START_MS + 6 * 3_600_000;
    const { haHasTomorrow } = mergePriceCurve(
      mergeArgs({ nowMs, dbRows: [], forecast })
    );
    assert.equal(haHasTomorrow, true);
  });
});

describe("currentPriceEntry: the repeated 02:00 hour", () => {
  const entries = [dbRow(2, 0.21), dbRow(3, 0.22)].map((row) => ({
    key: row.ts.getTime(),
    ts: row.ts,
    price: row.price_eur,
    source: "db",
  }));

  it("at 01:30 UTC (02:30 CET) selects the 01:00 UTC row, not 00:00", () => {
    const entry = currentPriceEntry(entries, Date.parse("2026-10-25T01:30:00Z"));
    assert.equal(entry.ts.getTime(), Date.parse("2026-10-25T01:00:00Z"));
    assert.equal(entry.price, 0.22);
  });

  it("at 00:30 UTC (02:30 CEST) selects the 00:00 UTC row", () => {
    const entry = currentPriceEntry(entries, Date.parse("2026-10-25T00:30:00Z"));
    assert.equal(entry.ts.getTime(), Date.parse("2026-10-25T00:00:00Z"));
    assert.equal(entry.price, 0.21);
  });

  it("returns null outside every entry's hour", () => {
    assert.equal(
      currentPriceEntry(entries, Date.parse("2026-10-25T02:00:00Z")),
      null
    );
  });
});
