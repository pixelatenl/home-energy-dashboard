import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coalesceHourlyRows,
  dailySolarDispositions,
  hourlySolarDispositions,
  splitSolarHour,
} from "../server/solar-split.mjs";

// A continuous-aggregate bucket row, in the shape the SQL layer
// returns.
const bucket = (iso, kwh) => ({ bucket: new Date(iso), kwh });

describe("splitSolarHour: the disposition clamps", () => {
  it("splits a normal sunny hour across home and grid", () => {
    // PV 2.0, of which 0.8 exported, none charging.
    const split = splitSolarHour(2.0, 0.8, 0);
    assert.equal(split.solarToGridKwh, 0.8);
    assert.equal(split.solarToBatteryKwh, 0);
    assert.equal(split.solarToHomeKwh, 1.2);
  });

  it("clamps the battery to the solar remaining after the export", () => {
    // PV 2.0 with 1.5 exported and 1.0 charging: the battery only
    // gets the 0.5 the export left behind, the home nothing.
    const split = splitSolarHour(2.0, 1.5, 1.0);
    assert.equal(split.solarToGridKwh, 1.5);
    assert.equal(split.solarToBatteryKwh, 0.5);
    assert.equal(split.solarToHomeKwh, 0);
  });

  it("charges the battery before the export when both fit", () => {
    // The rule order is grid first: PV 2.0 with 0.5 exported and
    // 1.2 charging leaves 0.3 for the home.
    const split = splitSolarHour(2.0, 0.5, 1.2);
    assert.equal(split.solarToGridKwh, 0.5);
    assert.equal(split.solarToBatteryKwh, 1.2);
    assert.ok(Math.abs(split.solarToHomeKwh - 0.3) < 1e-9);
  });

  it("splits a night hour with grid charging as all-zero", () => {
    // PV 0: no solar exists to disposition, whatever the grid and
    // the battery did that hour.
    const split = splitSolarHour(0, 0, 2.5);
    assert.equal(split.solarToHomeKwh, 0);
    assert.equal(split.solarToGridKwh, 0);
    assert.equal(split.solarToBatteryKwh, 0);
  });

  it("caps the grid share at PV during peak-hour battery export", () => {
    // The documented estimate behavior: the battery discharges into
    // the grid during peak hours, so the net export (4.0) exceeds PV
    // (1.0). The clamp attributes only up to PV to solar - the
    // remaining export is battery discharge, not solar.
    const split = splitSolarHour(1.0, 4.0, 0);
    assert.equal(split.solarToGridKwh, 1.0);
    assert.equal(split.solarToHomeKwh, 0);
    assert.equal(split.solarToBatteryKwh, 0);
  });

  it("returns all-zero for zero production with export", () => {
    const split = splitSolarHour(0, 3.0, 1.0);
    assert.deepEqual(split, {
      solarToHomeKwh: 0,
      solarToGridKwh: 0,
      solarToBatteryKwh: 0,
    });
  });

  it("clamps negative and null inputs at 0, never dropping the hour", () => {
    const split = splitSolarHour(-1, -2, null);
    assert.deepEqual(split, {
      solarToHomeKwh: 0,
      solarToGridKwh: 0,
      solarToBatteryKwh: 0,
    });
  });

  it("always sums back to exactly the hour's PV", () => {
    for (const [pv, exportKwh, charge] of [
      [2.0, 0.8, 0],
      [2.0, 1.5, 1.0],
      [1.0, 4.0, 0],
      [0.36, 0, 0.4],
      [5.5, 2.2, 3.3],
    ]) {
      const split = splitSolarHour(pv, exportKwh, charge);
      assert.ok(Math.abs(split.solarToHomeKwh + split.solarToGridKwh + split.solarToBatteryKwh - pv) < 1e-9);
    }
  });
});

describe("coalesceHourlyRows: absent rows coalesce to 0", () => {
  it("merges the five sparse series into one record per hour", () => {
    // PV only at 07:00, only import at 06:00, both at 08:00; every
    // other series' figure for those hours is an honest 0.
    const hours = coalesceHourlyRows({
      pv: [bucket("2026-10-17T07:00:00Z", 0.36), bucket("2026-10-17T08:00:00Z", 0.58)],
      gridImport: [bucket("2026-10-17T06:00:00Z", 0.48), bucket("2026-10-17T08:00:00Z", 0.61)],
      gridExport: [bucket("2026-10-17T08:00:00Z", 0.19)],
      batteryCharge: [],
      batteryDischarge: [],
    });
    assert.equal(hours.length, 3);
    assert.deepEqual(hours[0], {
      tsMs: new Date("2026-10-17T06:00:00Z").getTime(),
      pvKwh: 0,
      gridImportKwh: 0.48,
      gridExportKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
    });
    assert.equal(hours[1].pvKwh, 0.36);
    assert.equal(hours[1].gridImportKwh, 0);
    assert.equal(hours[2].pvKwh, 0.58);
    assert.equal(hours[2].gridExportKwh, 0.19);
    // Union ordering is ts-ascending regardless of input order.
    assert.ok(hours[0].tsMs < hours[1].tsMs && hours[1].tsMs < hours[2].tsMs);
  });

  it("returns an empty list for empty series", () => {
    assert.deepEqual(
      coalesceHourlyRows({
        pv: [],
        gridImport: [],
        gridExport: [],
        batteryCharge: [],
        batteryDischarge: [],
      }),
      []
    );
  });
});

describe("hourlySolarDispositions: the split over coalesced hours", () => {
  it("attaches the split to each hour without dropping any", () => {
    // A sunny morning: 07:00 all home, 08:00 charging clamps to the
    // remaining solar, 06:00 night grid charging stays all-zero.
    const hours = hourlySolarDispositions([
      {
        tsMs: new Date("2026-10-17T06:00:00Z").getTime(),
        pvKwh: 0,
        gridImportKwh: 0.48,
        gridExportKwh: 0,
        batteryChargeKwh: 0.5,
        batteryDischargeKwh: 0,
      },
      {
        tsMs: new Date("2026-10-17T07:00:00Z").getTime(),
        pvKwh: 0.36,
        gridImportKwh: 0,
        gridExportKwh: 0,
        batteryChargeKwh: 0,
        batteryDischargeKwh: 0,
      },
      {
        tsMs: new Date("2026-10-17T08:00:00Z").getTime(),
        pvKwh: 0.58,
        gridImportKwh: 0,
        gridExportKwh: 0.4,
        batteryChargeKwh: 0.9,
        batteryDischargeKwh: 0,
      },
    ]);
    // The night hour with grid charging: no solar to disposition.
    assert.equal(hours[0].solarToHomeKwh, 0);
    assert.equal(hours[0].solarToGridKwh, 0);
    assert.equal(hours[0].solarToBatteryKwh, 0);
    assert.equal(hours[1].solarToHomeKwh, 0.36);
    assert.equal(hours[2].solarToGridKwh, 0.4);
    assert.ok(Math.abs(hours[2].solarToBatteryKwh - 0.18) < 1e-9);
    assert.equal(hours[2].solarToHomeKwh, 0);
  });
});

describe("dailySolarDispositions: local-day aggregation", () => {
  // Amsterdam is UTC+2 on these October dates, so local midnight of
  // 2026-10-17 is 22:00Z on 2026-10-16: an hour bucketed at 22:00Z
  // belongs to local day 2026-10-17, not 2026-10-16.
  const dispositions = hourlySolarDispositions([
    {
      tsMs: new Date("2026-10-16T21:00:00Z").getTime(),
      pvKwh: 0.4,
      gridImportKwh: 0,
      gridExportKwh: 0.1,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
    },
    {
      tsMs: new Date("2026-10-16T22:00:00Z").getTime(),
      pvKwh: 0.5,
      gridImportKwh: 0,
      gridExportKwh: 0.2,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
    },
  ]);

  it("groups the hours by the local day they fall in", () => {
    const byDay = dailySolarDispositions(dispositions);
    assert.equal(byDay.size, 2);
    const sixteenth = byDay.get("2026-10-16");
    const seventeenth = byDay.get("2026-10-17");
    assert.ok(Math.abs(sixteenth.solarToHomeKwh - 0.3) < 1e-9);
    assert.equal(sixteenth.solarToGridKwh, 0.1);
    assert.ok(Math.abs(seventeenth.solarToHomeKwh - 0.3) < 1e-9);
    assert.equal(seventeenth.solarToGridKwh, 0.2);
    assert.equal(seventeenth.hours.length, 1);
    assert.equal(seventeenth.hours[0].tsMs, new Date("2026-10-16T22:00:00Z").getTime());
  });
});
