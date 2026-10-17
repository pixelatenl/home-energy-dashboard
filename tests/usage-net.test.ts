import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pricedGridFigures } from "../server/queries.mjs";
import { netFigures } from "../src/lib/usageNet.ts";
import type { UsageBreakdown } from "../src/lib/api.ts";

// An hour map: bucket start ms -> kWh.
const hour = (ms: number, kwh: number) => [ms, kwh] as const;

function priceRow(ms: number, eur: number | null) {
  return { ts: new Date(ms), price_eur: eur };
}

describe("pricedGridFigures: the hourly-priced grid fields", () => {
  it("prices each hour's import and export at that hour's price", () => {
    const t0 = Date.UTC(2026, 9, 15, 10);
    const t1 = Date.UTC(2026, 9, 15, 11);
    const priced = pricedGridFigures(
      new Map([hour(t0, 2), hour(t1, 1.5)]),
      new Map([hour(t0, 1), hour(t1, 3)]),
      [priceRow(t0, 0.3), priceRow(t1, 0.4)]
    );
    assert.ok(Math.abs(priced.importCost - (2 * 0.3 + 1.5 * 0.4)) < 1e-9);
    assert.ok(Math.abs(priced.exportCredit - (1 * 0.3 + 3 * 0.4)) < 1e-9);
  });

  it("skips hours without a price row", () => {
    const t0 = Date.UTC(2026, 9, 15, 10);
    const t1 = Date.UTC(2026, 9, 15, 11);
    const priced = pricedGridFigures(
      new Map([hour(t0, 2), hour(t1, 5)]),
      new Map(),
      [priceRow(t0, 0.3), priceRow(t1, null)]
    );
    assert.ok(Math.abs(priced.importCost - 0.6) < 1e-9);
    assert.equal(priced.exportCredit, 0);
  });

  it("returns zeros without any price rows", () => {
    const priced = pricedGridFigures(new Map([[1, 2]]), new Map(), []);
    assert.deepEqual(priced, { importCost: 0, exportCredit: 0 });
  });
});

// A minimal breakdown payload for the net view.
function payload({
  totalKwh = 19.25,
  totalCost = 6.77,
  importKwh = 15.16,
  exportKwh = 8.01,
  importCost = 5.15,
  exportCredit = 3.06,
}: {
  totalKwh?: number;
  totalCost?: number | null;
  importKwh?: number;
  exportKwh?: number;
  importCost?: number | null;
  exportCredit?: number | null;
}): UsageBreakdown {
  return {
    period: "day",
    date: "2026-10-15",
    window: { start: "", end: "" },
    previous: { period: "day", window: { start: "", end: "" } },
    total: {
      kwh: totalKwh,
      cost_eur: totalCost,
      previous_kwh: 0,
      previous_cost_eur: null,
    },
    categories: [],
    split: {
      measured_kwh: 0,
      estimated_kwh: 0,
      remainder_kwh: 0,
      measured_cost_eur: null,
      estimated_cost_eur: null,
      remainder_cost_eur: null,
      previous_measured_kwh: 0,
      previous_estimated_kwh: 0,
      previous_remainder_kwh: 0,
    },
    avg_price_eur: 0.35,
    grid_import_kwh: importKwh,
    grid_export_kwh: exportKwh,
    import_cost_eur: importCost,
    export_credit_eur: exportCredit,
    home_model: {
      days: 1,
      modeled_kwh: 0,
      unexplained_kwh: 0,
      entries: [],
    },
    assumptions: {
      flat_cop: 3,
      heating_gas_m3: 0,
      heating_days: 0,
      gas_non_heating_baseline_m3_per_month: 20,
      setpoint_staleness_hours: 24,
    },
  };
}

describe("netFigures: the with-and-without comparison", () => {
  it("computes the 15 Oct reference case", () => {
    const net = netFigures(payload({}));
    assert.ok(Math.abs(net.netKwh - 7.15) < 1e-9);
    assert.ok(Math.abs(net.netCostEur! - 2.09) < 1e-9);
    assert.ok(Math.abs(net.savedEur! - 4.68) < 1e-9);
    assert.ok(Math.abs(net.selfSuppliedKwh - 12.1) < 1e-9);
  });

  it("reads negative on a net-exporter period", () => {
    const net = netFigures(
      payload({
        totalKwh: 5,
        totalCost: 1.5,
        importKwh: 2,
        exportKwh: 8,
        importCost: 0.6,
        exportCredit: 2.4,
      })
    );
    assert.ok(Math.abs(net.netKwh - -6) < 1e-9);
    assert.ok(Math.abs(net.netCostEur! - -1.8) < 1e-9);
    assert.ok(Math.abs(net.savedEur! - 3.3) < 1e-9);
    assert.ok(Math.abs(net.selfSuppliedKwh - 11) < 1e-9);
  });

  it("marks the priced figures null without price data", () => {
    const net = netFigures(
      payload({ totalCost: null, importCost: null, exportCredit: null })
    );
    // The net kWh is physical and stays available.
    assert.ok(Math.abs(net.netKwh - 7.15) < 1e-9);
    assert.equal(net.netCostEur, null);
    assert.equal(net.savedEur, null);
  });
});
