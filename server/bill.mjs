// GET /api/profile/bill data: the estimated bill for one local calendar
// month (Europe/Amsterdam), computed from existing data only, following
// the bill model extracted from the Zonneplan invoices (see
// server/bill-constants.mjs):
//
// - Import cost: the grid import counter's hourly energy_delta joined
//   to the price table; the price table's price_eur is the all-in
//   served tariff, so no tax components are added on top.
// - Export credit: the grid export counter's hourly energy_delta times
//   the served tariff minus the energy tax constant, floored at zero,
//   plus the Zonnebonus (10 percent of the credit). Hours without a
//   price row count toward kWh but not toward money, the same rule as
//   the rest of the server.
// - Gas cost: daily gas deltas joined to gas_price (last known price on
//   or before the day, forward-filled), multiplied by the calorific
//   correction factor.
// - Fixed costs: the monthly constants from bill-constants.mjs.
//
// The total is import + gas + fixed - export credit - bonus, computed
// from the rounded component values so the identity holds exactly at
// two decimals. The current month returns month-to-date with an
// in-progress marker; the data-start month carries a partial-month
// marker; months before the data start return an honest empty state
// (components null, never zeros).
//
// The module's pure functions take rows and constants in and return
// figures out; the caller (getProfileBill) fetches the rows. All month
// and day math runs on local day keys through server/time.mjs, so no
// wall-clock keying and DST-safe windows.

import {
  dbHourlyPrices,
  gasCounterEntityIds,
  gasDaily,
  gasPrices,
  gridCounterHourlyRows,
} from "./queries.mjs";
import { localDateKey, nextDateKey } from "./time.mjs";
import { BILL_DATA_START, billConstants } from "./bill-constants.mjs";

export { BILL_DATA_START };

const round2 = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;

// First and last local day key of a "YYYY-MM" month. Null for an
// unknown or impossible month (2026-13, 2026-1).
export function monthDateKeys(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return null;
  }
  const [year, monthNum] = month.split("-").map(Number);
  if (monthNum < 1 || monthNum > 12) {
    return null;
  }
  const pad = (value) => String(value).padStart(2, "0");
  const nextFirst =
    monthNum === 12
      ? `${year + 1}-01-01`
      : `${year}-${pad(monthNum + 1)}-01`;
  return {
    startKey: `${month}-01`,
    endKey: nextDateKey(nextFirst, -1),
  };
}

// The month's bill status against the data start and the current local
// month: "empty" before any data exists, "in_progress" for the current
// month (month-to-date totals), "complete" for a finished month with
// data. partialMonth marks the data-start month, whose window begins
// before the data does. Pure: now is passed in.
export function billMonthStatus(month, now, dataStart = BILL_DATA_START) {
  const currentMonth = localDateKey(now).slice(0, 7);
  const dataStartMonth = dataStart.slice(0, 7);
  if (month < dataStartMonth || month > currentMonth) {
    return {
      status: "empty",
      has_data: false,
      in_progress: false,
      partial_month: false,
    };
  }
  const inProgress = month === currentMonth;
  return {
    status: inProgress ? "in_progress" : "complete",
    has_data: true,
    in_progress: inProgress,
    partial_month: month === dataStartMonth,
  };
}

// The export credit rate for one hour, EUR/kWh: the served (all-in)
// tariff minus the energy tax, floored at zero. Null when the hour's
// price is unknown - never a silent 0.
export function exportCreditRateEur(priceEur, energyTaxEur) {
  if (priceEur === null || priceEur === undefined || !Number.isFinite(priceEur)) {
    return null;
  }
  return Math.max(priceEur - energyTaxEur, 0);
}

// Import cost and export credit (plus bonus) for a window from the
// role-keyed hourly kWh maps (hour start ms -> kWh) and the window's
// price rows. kWh counts in every hour; money only in hours with a
// known price. The bonus is the zonnebonus fraction of the credit.
export function pricedBillFigures(importByHour, exportByHour, priceRows, constants) {
  let importKwh = 0;
  let exportKwh = 0;
  for (const kwh of importByHour.values()) {
    importKwh += kwh;
  }
  for (const kwh of exportByHour.values()) {
    exportKwh += kwh;
  }
  let importCostEur = 0;
  let exportCreditEur = 0;
  let unpricedKwh = 0;
  const pricedHours = new Set();
  for (const row of priceRows) {
    const hour = row.ts.getTime();
    pricedHours.add(hour);
    const price =
      row.price_eur === null || row.price_eur === undefined
        ? null
        : Number(row.price_eur);
    if (price === null) {
      unpricedKwh += (importByHour.get(hour) ?? 0) + (exportByHour.get(hour) ?? 0);
      continue;
    }
    const imp = importByHour.get(hour) ?? 0;
    const exp = exportByHour.get(hour) ?? 0;
    importCostEur += imp * price;
    exportCreditEur += exp * exportCreditRateEur(price, constants.energyTaxEurInclVat);
  }
  for (const [hour, kwh] of importByHour) {
    if (!pricedHours.has(hour)) {
      unpricedKwh += kwh;
    }
  }
  for (const [hour, kwh] of exportByHour) {
    if (!pricedHours.has(hour)) {
      unpricedKwh += kwh;
    }
  }
  return {
    importKwh,
    exportKwh,
    importCostEur,
    exportCreditEur,
    exportBonusEur: exportCreditEur * constants.zonnebonus,
    hasUnknownPrice: unpricedKwh > 0,
  };
}

// Gas cost for a window from the daily gas delta rows (bucket, kwh
// holding m3) and the gas_price rows (day text, price_eur_per_m3),
// forward-filled per local day exactly like the heat gas month
// intervals. The billed volume is the measured m3 times the
// correction factor; the cost is per-day m3 * price * factor.
export function gasBillFromDailyRows(dailyRows, priceRows, correctionFactor) {
  let m3 = 0;
  let costEur = 0;
  let hasUnknownPrice = false;
  const buckets = [...dailyRows].sort(
    (a, b) => a.bucket.getTime() - b.bucket.getTime()
  );
  let index = 0;
  let price = null;
  for (const row of buckets) {
    const bucketMs = row.bucket.getTime();
    const volume = Number(row.kwh) || 0;
    const day = localDateKey(new Date(bucketMs));
    while (index < priceRows.length && priceRows[index].day <= day) {
      price = Number(priceRows[index].price_eur_per_m3);
      index += 1;
    }
    m3 += volume;
    if (price === null) {
      if (volume > 0) {
        hasUnknownPrice = true;
      }
    } else {
      costEur += volume * price * correctionFactor;
    }
  }
  return {
    m3,
    billedM3: m3 * correctionFactor,
    costEur,
    hasUnknownPrice,
  };
}

// The fixed monthly components split stroom/gas with per-side totals
// and the combined total, all rounded to cents. Derived from the
// constants so the invoice's 12.34 / 71.34 / 83.68 reproduce exactly.
export function fixedCostBreakdown(constants) {
  const f = constants.fixedMonthlyEur;
  const side = (energyTax, supply, reduction, grid) => {
    const side_ = {
      energy_tax: round2(energyTax),
      supply: round2(supply),
      energy_tax_reduction: round2(reduction),
      grid: round2(grid),
    };
    return { ...side_, total: round2(side_.energy_tax + side_.supply + side_.energy_tax_reduction + side_.grid) };
  };
  const electricity = side(
    f.energyTaxElectricity,
    f.supplyCostsElectricity,
    f.energyTaxReductionElectricity,
    f.gridCostsElectricity
  );
  const gas = side(
    f.energyTaxGas,
    f.supplyCostsGas,
    f.energyTaxReductionGas,
    f.gridCostsGas
  );
  return {
    electricity,
    gas,
    totalEur: round2(electricity.total + gas.total),
  };
}

// The bill total from the rounded component values: import plus gas
// plus fixed minus export credit minus bonus. The identity holds
// exactly at two decimals because every operand is already rounded.
export function billTotalEur(components) {
  return round2(
    components.import.cost_eur +
      components.gas.cost_eur +
      components.fixed.total_eur -
      components.export.credit_eur -
      components.export.bonus_eur
  );
}

// The assumptions block, echoed in every payload and rendered in the
// card's expandable section. The strings are the model's honesty notes;
// the numbers ride along so the card can show the constants in use.
export function billAssumptions(constants) {
  return {
    tariff_composition:
      "Import is billed at the all-in served tariff from the price table (market price plus sourcing fee plus energy tax plus VAT); no tax components are added on top.",
    export_credit_hypothesis:
      "Export is credited at the served tariff minus energy tax, floored at zero, plus a Zonnebonus of 10 percent of the credit. The minus-energy-tax fit is a v1 assumption to validate in the first calibration session.",
    energy_tax_year: constants.energyTaxYear,
    energy_tax_eur_incl_vat: constants.energyTaxEurInclVat,
    zonnebonus: constants.zonnebonus,
    gas_correction_factor: constants.gasCorrectionFactor,
    gas_correction_note:
      "Billed gas m3 is the measured m3 times the constant calorific correction factor; the jaarafrekening shows per-period factors between 1.01868 and 1.01984 for this connection.",
    fixed_costs_basis:
      "Fixed monthly components are billed on Zonneplan's estimated annual consumption (jaarverbruik), not on measured monthly usage.",
    annual_energy_tax_true_up:
      "The annual settlement refunds energy tax on net kWh (import minus export, saldering); the monthly energy tax line is provisional by design and trued up at year end.",
    excluded:
      "Zonneplan netverdiensten (small unpredictable monthly credits) and voorschot prediction mechanics are excluded from the estimate.",
    data_completeness:
      "Data collection started on 10 October 2026; known ingest gaps understate import by roughly 0.2 to 0.5 kWh per day; months before October 2026 have no data.",
  };
}

// The bill for one month window [fromMs, toMs). Empty months skip the
// database entirely and return components null. now is passed in so
// the status markers are pure and testable.
export async function getProfileBill(month, fromMs, toMs, now = new Date()) {
  const constants = billConstants();
  const status = billMonthStatus(month, now);
  const assumptions = billAssumptions(constants);
  if (!status.has_data) {
    return { ...status, components: null, assumptions };
  }
  const endDay = localDateKey(new Date(toMs - 1));
  const [grid, priceRows, gasEntityIds, gasPriceRows] = await Promise.all([
    gridCounterHourlyRows(fromMs, toMs),
    dbHourlyPrices(fromMs, toMs),
    gasCounterEntityIds(),
    gasPrices(endDay),
  ]);
  const figures = pricedBillFigures(
    grid.import,
    grid.export,
    priceRows,
    constants
  );
  const dailyRows =
    gasEntityIds.length > 0 ? await gasDaily(gasEntityIds, fromMs, toMs) : [];
  const gas = gasBillFromDailyRows(
    dailyRows,
    gasPriceRows,
    constants.gasCorrectionFactor
  );
  const fixed = fixedCostBreakdown(constants);
  const components = {
    import: {
      kwh: round3(figures.importKwh),
      cost_eur: round2(figures.importCostEur),
      has_unknown_price: figures.hasUnknownPrice,
    },
    export: {
      kwh: round3(figures.exportKwh),
      credit_eur: round2(figures.exportCreditEur),
      bonus_eur: round2(figures.exportBonusEur),
      has_unknown_price: figures.hasUnknownPrice,
    },
    gas: {
      m3: round3(gas.m3),
      billed_m3: round3(gas.billedM3),
      cost_eur: round2(gas.costEur),
      has_unknown_price: gas.hasUnknownPrice,
    },
    fixed: {
      electricity: fixed.electricity,
      gas: fixed.gas,
      total_eur: fixed.totalEur,
    },
  };
  components.total_eur = billTotalEur(components);
  return { ...status, components, assumptions };
}
