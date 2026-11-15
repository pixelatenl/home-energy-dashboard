// The estimated-bill model's constants, defined once so they can never
// be swapped. The model is extracted from the actual Zonneplan invoices
// (261317557 and 261500937) and the jaarafrekeningen (25057492 and
// 260124139), verified arithmetically:
//
// - Import is billed at the all-in tariff already stored in the price
//   table (market price plus sourcing fee plus energy tax plus VAT).
//   No tax components are added on top.
// - Export is credited at the served tariff minus the energy tax
//   (incl. VAT), floored at zero, plus a Zonnebonus of 10 percent of
//   the credit. The minus-energy-tax fit is a v1 assumption to
//   validate in the first calibration session.
// - Gas is billed per day at the daily gas_price times a calorific
//   correction factor (billed m3 is roughly 1.9 percent above raw
//   meter m3; the jaarafrekening shows per-period factors 1.01868 to
//   1.01984 for this connection, so a constant factor is an
//   assumption).
// - Fixed costs are the monthly amounts billed every month (all EUR
//   incl. VAT), reproduced exactly from the annual figures divided
//   by 12 within rounding. The energy tax lines are billed on
//   Zonneplan's estimated annual consumption (jaarverbruik), not on
//   measured monthly usage, and trued up on the jaarafrekening.
//
// The energy tax changes every 1 January: review
// EMS_BILL_ENERGY_TAX_EUR (and the fixed components against the
// newest invoice) each January, and cross-check the model against the
// annual settlement. Invalid env values fall back to the defaults.

// First local day with any data; months before this have no bill.
export const BILL_DATA_START = "2026-10-10";

// The 2026 defaults, exactly as billed (fixed components per month,
// EUR incl. VAT).
export const DEFAULT_BILL_CONSTANTS = {
  // Energy tax electricity, EUR/kWh including VAT, 2026 value.
  energyTaxEurInclVat: 0.11085,
  energyTaxYear: 2026,
  // The Zonnebonus: 10 percent of the export credit.
  zonnebonus: 0.1,
  // Calorific correction factor applied to measured gas m3.
  gasCorrectionFactor: 1.019,
  // Fixed monthly components, split stroom/gas as on the invoice.
  fixedMonthlyEur: {
    energyTaxElectricity: 18.84,
    energyTaxGas: 42.88,
    supplyCostsElectricity: 6.24,
    supplyCostsGas: 6.24,
    energyTaxReductionElectricity: -52.42,
    energyTaxReductionGas: 0,
    gridCostsElectricity: 39.68,
    gridCostsGas: 22.22,
  },
};

// A finite number from an env var, or the default when unset, empty
// or invalid.
function envNumber(name, fallback) {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === "" ? null : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// The resolved bill constants: every value env-overridable with the
// 2026 defaults, so the API can echo them in the payload's assumptions
// block and a January tax change needs no code edit.
export function billConstants() {
  const fixed = DEFAULT_BILL_CONSTANTS.fixedMonthlyEur;
  return {
    energyTaxEurInclVat: envNumber(
      "EMS_BILL_ENERGY_TAX_EUR",
      DEFAULT_BILL_CONSTANTS.energyTaxEurInclVat
    ),
    energyTaxYear: Number.parseInt(
      process.env.EMS_BILL_ENERGY_TAX_YEAR ?? "",
      10
    ) || DEFAULT_BILL_CONSTANTS.energyTaxYear,
    zonnebonus: envNumber(
      "EMS_BILL_ZONNEBONUS",
      DEFAULT_BILL_CONSTANTS.zonnebonus
    ),
    gasCorrectionFactor: envNumber(
      "EMS_BILL_GAS_CORRECTION_FACTOR",
      DEFAULT_BILL_CONSTANTS.gasCorrectionFactor
    ),
    fixedMonthlyEur: {
      energyTaxElectricity: envNumber(
        "EMS_BILL_FIXED_ENERGY_TAX_ELECTRICITY",
        fixed.energyTaxElectricity
      ),
      energyTaxGas: envNumber(
        "EMS_BILL_FIXED_ENERGY_TAX_GAS",
        fixed.energyTaxGas
      ),
      supplyCostsElectricity: envNumber(
        "EMS_BILL_FIXED_SUPPLY_ELECTRICITY",
        fixed.supplyCostsElectricity
      ),
      supplyCostsGas: envNumber(
        "EMS_BILL_FIXED_SUPPLY_GAS",
        fixed.supplyCostsGas
      ),
      energyTaxReductionElectricity: envNumber(
        "EMS_BILL_FIXED_ENERGY_TAX_REDUCTION_ELECTRICITY",
        fixed.energyTaxReductionElectricity
      ),
      energyTaxReductionGas: envNumber(
        "EMS_BILL_FIXED_ENERGY_TAX_REDUCTION_GAS",
        fixed.energyTaxReductionGas
      ),
      gridCostsElectricity: envNumber(
        "EMS_BILL_FIXED_GRID_ELECTRICITY",
        fixed.gridCostsElectricity
      ),
      gridCostsGas: envNumber("EMS_BILL_FIXED_GRID_GAS", fixed.gridCostsGas),
    },
  };
}
