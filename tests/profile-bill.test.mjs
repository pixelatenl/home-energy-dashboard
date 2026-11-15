// Unit tests for the estimated-bill model (server/bill.mjs and
// server/bill-constants.mjs, node:test). The pure helpers: month
// windows, status markers, the export credit rate, the priced grid
// figures, the gas bill with its correction factor, the fixed-cost
// breakdown reproducing the invoice constants, the total identity and
// the assumptions block.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BILL_DATA_START,
  DEFAULT_BILL_CONSTANTS,
  billConstants,
} from "../server/bill-constants.mjs";
import {
  billAssumptions,
  billMonthStatus,
  billTotalEur,
  exportCreditRateEur,
  fixedCostBreakdown,
  gasBillFromDailyRows,
  monthDateKeys,
  pricedBillFigures,
} from "../server/bill.mjs";

// A fixed "now" in November 2026 (Amsterdam local day 2026-11-15), so
// the status markers are deterministic: current month 2026-11.
const NOW = new Date("2026-11-15T12:00:00Z");

test("monthDateKeys: calendar month windows", () => {
  assert.deepEqual(monthDateKeys("2026-11"), {
    startKey: "2026-11-01",
    endKey: "2026-11-30",
  });
  assert.deepEqual(monthDateKeys("2026-02"), {
    startKey: "2026-02-01",
    endKey: "2026-02-28",
  });
  // December rolls into the next year.
  assert.deepEqual(monthDateKeys("2026-12"), {
    startKey: "2026-12-01",
    endKey: "2026-12-31",
  });
  assert.equal(monthDateKeys("2026-13"), null);
  assert.equal(monthDateKeys("2026-1"), null);
  assert.equal(monthDateKeys("2026-00"), null);
  assert.equal(monthDateKeys("not-a-month"), null);
});

test("billMonthStatus: empty, partial, in-progress and complete months", () => {
  // Before the data start: honest empty state.
  const empty = billMonthStatus("2026-09", NOW);
  assert.equal(empty.status, "empty");
  assert.equal(empty.has_data, false);
  assert.equal(empty.in_progress, false);
  assert.equal(empty.partial_month, false);
  // A future month has no data either.
  assert.equal(billMonthStatus("2026-12", NOW).has_data, false);
  // The data-start month: complete (it is over) but partial.
  const october = billMonthStatus("2026-10", NOW);
  assert.equal(october.status, "complete");
  assert.equal(october.has_data, true);
  assert.equal(october.in_progress, false);
  assert.equal(october.partial_month, true);
  // The current month: month-to-date with the in-progress marker.
  const november = billMonthStatus("2026-11", NOW);
  assert.equal(november.status, "in_progress");
  assert.equal(november.has_data, true);
  assert.equal(november.in_progress, true);
  assert.equal(november.partial_month, false);
  assert.equal(BILL_DATA_START, "2026-10-10");
});

test("exportCreditRateEur: served tariff minus energy tax, floored at zero", () => {
  const tax = 0.11085;
  // September invoice shape: 0.2308 served -> about 0.1195 credited.
  assert.ok(Math.abs(exportCreditRateEur(0.2308, tax) - 0.11995) < 1e-9);
  // Below the energy tax the credit floors at zero, never negative.
  assert.equal(exportCreditRateEur(0.05, tax), 0);
  assert.equal(exportCreditRateEur(0.11085, tax), 0);
  // Unknown price: null, never a silent 0.
  assert.equal(exportCreditRateEur(null, tax), null);
  assert.equal(exportCreditRateEur(undefined, tax), null);
  assert.equal(exportCreditRateEur(Number.NaN, tax), null);
});

test("pricedBillFigures: import at all-in tariff, export credit plus bonus", () => {
  const constants = billConstants();
  const importByHour = new Map([
    [1000, 2],
    [2000, 1],
  ]);
  const exportByHour = new Map([[1000, 3]]);
  const priceRows = [
    { ts: new Date(1000), price_eur: 0.3 },
    { ts: new Date(2000), price_eur: null },
  ];
  const figures = pricedBillFigures(importByHour, exportByHour, priceRows, constants);
  // kWh counts in every hour, priced or not.
  assert.equal(figures.importKwh, 3);
  assert.equal(figures.exportKwh, 3);
  // Import cost only in the priced hour: 2 kWh * EUR 0.30.
  assert.ok(Math.abs(figures.importCostEur - 0.6) < 1e-9);
  // Export credit: 3 kWh * (0.30 - 0.11085).
  const expectedCredit = 3 * (0.3 - 0.11085);
  assert.ok(Math.abs(figures.exportCreditEur - expectedCredit) < 1e-9);
  // The bonus is exactly the zonnebonus fraction of the credit.
  assert.ok(
    Math.abs(figures.exportBonusEur - expectedCredit * constants.zonnebonus) < 1e-9
  );
  assert.equal(constants.zonnebonus, 0.1);
  // The unpriced hour carried import kWh, so the unknown-price flag is set.
  assert.equal(figures.hasUnknownPrice, true);
});

test("pricedBillFigures: fully priced window has no unknown-price flag", () => {
  const constants = billConstants();
  const figures = pricedBillFigures(
    new Map([[1000, 1]]),
    new Map([[1000, 1]]),
    [{ ts: new Date(1000), price_eur: 0.25 }],
    constants
  );
  assert.equal(figures.hasUnknownPrice, false);
  assert.ok(Math.abs(figures.importCostEur - 0.25) < 1e-9);
  assert.ok(Math.abs(figures.exportCreditEur - (0.25 - 0.11085)) < 1e-9);
});

test("gasBillFromDailyRows: forward-filled daily price times correction factor", () => {
  const factor = 1.019;
  const dailyRows = [
    { bucket: new Date("2026-11-01T12:00:00Z"), kwh: 2 },
    { bucket: new Date("2026-11-02T12:00:00Z"), kwh: 3 },
  ];
  const priceRows = [
    { day: "2026-10-31 22:00:00+00", price_eur_per_m3: 1.8 },
    { day: "2026-11-01 22:00:00+00", price_eur_per_m3: 2.0 },
  ];
  const gas = gasBillFromDailyRows(dailyRows, priceRows, factor);
  assert.ok(Math.abs(gas.m3 - 5) < 1e-9);
  assert.ok(Math.abs(gas.billedM3 - 5 * factor) < 1e-9);
  // Nov 1 falls back to the Oct 31 price, Nov 2 takes its own row.
  const expectedCost = (2 * 1.8 + 3 * 2.0) * factor;
  assert.ok(Math.abs(gas.costEur - expectedCost) < 1e-9);
  assert.equal(gas.hasUnknownPrice, false);
});

test("gasBillFromDailyRows: volume without any price flags unknown, costs nothing", () => {
  const gas = gasBillFromDailyRows(
    [{ bucket: new Date("2026-11-01T12:00:00Z"), kwh: 2 }],
    [],
    1.019
  );
  assert.equal(gas.m3, 2);
  assert.equal(gas.costEur, 0);
  assert.equal(gas.hasUnknownPrice, true);
});

test("fixedCostBreakdown: reproduces the billed monthly constants exactly", () => {
  const breakdown = fixedCostBreakdown(billConstants());
  // Stroom: 18.84 + 6.24 - 52.42 + 39.68 = 12.34.
  assert.equal(breakdown.electricity.total, 12.34);
  // Gas: 42.88 + 6.24 + 0 + 22.22 = 71.34.
  assert.equal(breakdown.gas.total, 71.34);
  // Total fixed: EUR 83.68 per month.
  assert.equal(breakdown.totalEur, 83.68);
  assert.equal(
    DEFAULT_BILL_CONSTANTS.gasCorrectionFactor,
    1.019
  );
  assert.equal(DEFAULT_BILL_CONSTANTS.energyTaxEurInclVat, 0.11085);
  assert.equal(DEFAULT_BILL_CONSTANTS.energyTaxYear, 2026);
});

test("billTotalEur: import + gas + fixed - export credit - bonus equals the total", () => {
  const components = {
    import: { kwh: 246, cost_eur: 56.79, has_unknown_price: false },
    export: {
      kwh: 294,
      credit_eur: 35.11,
      bonus_eur: 3.51,
      has_unknown_price: false,
    },
    gas: { m3: 40, billed_m3: 40.76, cost_eur: 72.5, has_unknown_price: false },
    fixed: {
      electricity: { total: 12.34 },
      gas: { total: 71.34 },
      total_eur: 83.68,
    },
  };
  components.total_eur = billTotalEur(components);
  const identity =
    components.import.cost_eur +
    components.gas.cost_eur +
    components.fixed.total_eur -
    components.export.credit_eur -
    components.export.bonus_eur;
  assert.equal(components.total_eur, Math.round(identity * 100) / 100);
  assert.equal(components.total_eur, 174.35);
});

test("billAssumptions: carries every model note and the constants in use", () => {
  const assumptions = billAssumptions(billConstants());
  for (const key of [
    "tariff_composition",
    "export_credit_hypothesis",
    "energy_tax_year",
    "energy_tax_eur_incl_vat",
    "zonnebonus",
    "gas_correction_factor",
    "gas_correction_note",
    "fixed_costs_basis",
    "annual_energy_tax_true_up",
    "excluded",
    "data_completeness",
  ]) {
    assert.ok(key in assumptions, `missing assumption ${key}`);
  }
  assert.equal(assumptions.energy_tax_year, 2026);
  assert.equal(assumptions.energy_tax_eur_incl_vat, 0.11085);
  assert.equal(assumptions.zonnebonus, 0.1);
  assert.equal(assumptions.gas_correction_factor, 1.019);
  assert.match(assumptions.data_completeness, /10 October 2026/);
  assert.match(assumptions.export_credit_hypothesis, /v1 assumption/);
});
