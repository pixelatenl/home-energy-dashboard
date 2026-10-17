// The hourly solar disposition split: how each hour's PV production
// was divided between the home, the grid export and the battery
// charging, in kWh, from the five hourly counter series (PV, grid
// import, grid export, battery charge, battery discharge).
//
// Split rules, the same clamping discipline as the live flow model
// (src/lib/flowDiagram.ts) applied to hourly energy instead of
// instantaneous power:
//   solarToGrid    = min(grid export, PV)
//   solarToBattery = min(battery charge, PV - solarToGrid)
//   solarToHome    = PV - solarToGrid - solarToBattery
// Every term clamped at 0, so the three always sum back to exactly
// the hour's PV. The battery discharge and grid import series do not
// shape the split; they ride along for the balance checks.
//
// Known limitations - all split numbers are estimates:
// - The P1 meter is net per hour: it cannot see simultaneous import
//   and export within one hour, so an hour that both imported and
//   exported has its export understated and the grid share of the
//   split with it.
// - The battery discharges into the grid during peak hours; that
//   discharge rides the same net export figure, inflating
//   solarToGrid (up to the PV cap) and deflating the battery's
//   discharge attribution for those hours.
// - The battery's charging counter includes energy from the unit's
//   own solar input, which neither the PV counter nor the grid
//   import counter sees. In such an hour the five-term balance
//   (home = import + PV + discharge - export - charge) goes
//   negative and the split's solarToBattery credits charging the
//   other counters cannot fully account for.
//
// The module is pure: no database, no clock. The caller fetches the
// hourly series rows and coalesces them here; an hour absent from a
// series coalesces to 0 and is never dropped.

import { localDateKey } from "./time.mjs";

// The zero split, for callers walking hour rows that predate one of
// the series.
export const ZERO_SPLIT = {
  solarToHomeKwh: 0,
  solarToGridKwh: 0,
  solarToBatteryKwh: 0,
};

// Clamps a nullable kWh figure to a non-negative number.
const clamp0 = (value) => Math.max(0, Number(value ?? 0));

// The disposition of one hour's PV production across home, grid
// export and battery charging. Pure; null or negative inputs count
// as 0, so no term can ever be negative or exceed PV.
export function splitSolarHour(pvKwh, gridExportKwh, batteryChargeKwh) {
  const pv = clamp0(pvKwh);
  const solarToGridKwh = Math.min(clamp0(gridExportKwh), pv);
  const solarToBatteryKwh = Math.min(
    clamp0(batteryChargeKwh),
    clamp0(pv - solarToGridKwh)
  );
  const solarToHomeKwh = clamp0(pv - solarToGridKwh - solarToBatteryKwh);
  return { solarToHomeKwh, solarToGridKwh, solarToBatteryKwh };
}

// Merges the five hourly series into one coalesced record per hour:
// the union of all series' buckets, ts-ascending, each carrying all
// five kWh figures with the series that have no row in that hour
// coalesced to 0 (energy_hourly rows are sparse - an hour without
// energy has no row). Pure; seriesRows values are arrays of SQL-shape
// { bucket: Date, kwh } rows and may be empty.
export function coalesceHourlyRows(seriesRows) {
  const FIELDS = {
    pv: "pvKwh",
    gridImport: "gridImportKwh",
    gridExport: "gridExportKwh",
    batteryCharge: "batteryChargeKwh",
    batteryDischarge: "batteryDischargeKwh",
  };
  const hours = new Map();
  for (const [series, field] of Object.entries(FIELDS)) {
    for (const row of seriesRows[series] ?? []) {
      const tsMs = row.bucket.getTime();
      let hour = hours.get(tsMs);
      if (hour === undefined) {
        hour = {
          tsMs,
          pvKwh: 0,
          gridImportKwh: 0,
          gridExportKwh: 0,
          batteryChargeKwh: 0,
          batteryDischargeKwh: 0,
        };
        hours.set(tsMs, hour);
      }
      hour[field] += Number(row.kwh ?? 0);
    }
  }
  return [...hours.values()].sort((a, b) => a.tsMs - b.tsMs);
}

// The coalesced hours with the split attached: each hour gains the
// solarToHomeKwh / solarToGridKwh / solarToBatteryKwh disposition of
// its PV. Pure.
export function hourlySolarDispositions(hours) {
  return hours.map((hour) => ({
    ...hour,
    ...splitSolarHour(hour.pvKwh, hour.gridExportKwh, hour.batteryChargeKwh),
  }));
}

// Sums the hourly dispositions per local calendar day
// (Europe/Amsterdam, via the shared localDateKey helper), so daily
// intervals can aggregate the hourly split of their local day. Pure;
// returns a Map from local date key to the day's split sums plus the
// day's hour records themselves (the daily self-consumption cost is
// priced bottom-up and needs each hour's own timestamp).
export function dailySolarDispositions(dispositions) {
  const byDay = new Map();
  for (const hour of dispositions) {
    const key = localDateKey(new Date(hour.tsMs));
    const day =
      byDay.get(key) ??
      {
        solarToHomeKwh: 0,
        solarToGridKwh: 0,
        solarToBatteryKwh: 0,
        hours: [],
      };
    day.solarToHomeKwh += hour.solarToHomeKwh;
    day.solarToGridKwh += hour.solarToGridKwh;
    day.solarToBatteryKwh += hour.solarToBatteryKwh;
    day.hours.push(hour);
    byDay.set(key, day);
  }
  return byDay;
}
