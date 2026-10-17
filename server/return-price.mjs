// The dynamic return (feed-in) price per hour, per Zonneplan's
// documented tariff construction:
//
//   consumption price (the price table's sensor, the all-in
//   consumption price) = market price + handling fee + energy tax,
//   including 21% VAT
//     => market price = consumption / (1 + VAT)
//                        - energy tax - handling fee
//   return price ex VAT = market price + feed-in handling fee
//   return price = return price ex VAT x (1 + solar bonus)
//     when the market price is positive and the hour is daytime
//     (the Zonnebonus; Zonneplan publishes the bonus as daytime-only
//     and excluding home-battery export)
//
// The return price excludes energy tax and VAT by construction, so
// the per-hour earnings figures are ex VAT and ex energy tax. The
// energy tax refund under saldering is a fixed monthly advance
// reconciled annually; it is not a per-kWh export component and
// never appears here. Negative market prices are valid: the return
// price can go negative and is never clamped.
//
// Constants come from the environment with 2026 defaults (VAT 21%,
// energy tax EUR 0.11085/kWh excl. VAT per Belastingplan 2026 -
// Zonneplan's own page quotes 0.1108; the consumption handling fee
// is Zonneplan's EUR 0.02/kWh incl. VAT = 0.0165 excl.; the feed-in
// handling fee is Zonneplan's documented EUR 0.02/kWh; the Zonnebonus
// is the invoice-confirmed 10%). The energy tax changes every 1
// January: review EMS_RETURN_ENERGY_TAX_EUR (and the handling fees
// against Zonneplan's published rates) each January, and cross-check
// the model against the annual settlement invoice.
//
// The module is pure: no database, no clock. The caller resolves the
// hour's consumption price (with its last-known-price fallback) and
// the local hour index, then prices here. EMS_FEED_IN_TARIFF_EUR
// stays available as an explicit flat override that takes precedence
// over the dynamic construction whenever it is set to a positive
// value.

// The 2026 defaults.
export const DEFAULT_RETURN_CONSTANTS = {
  vatRate: 0.21,
  energyTaxEur: 0.11085,
  handlingFeeConsumptionEur: 0.0165,
  handlingFeeFeedInEur: 0.02,
  solarBonus: 0.1,
  // The bonus applies during daytime local hours
  // [bonusStartHour, bonusEndHour); Zonneplan publishes no exact
  // window, so this is an assumption to calibrate against the first
  // annual settlement (jaarafrekening).
  bonusStartHour: 7,
  bonusEndHour: 18,
};

// The flat override tariff from EMS_FEED_IN_TARIFF_EUR, EUR/kWh:
// a positive finite value configures the override, anything else
// (unset, empty, zero, negative, invalid) leaves the dynamic
// construction in charge.
function flatOverrideTariffEur() {
  const raw = process.env.EMS_FEED_IN_TARIFF_EUR;
  const parsed = raw === undefined || raw === "" ? null : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// A finite positive-or-zero number from an env var, or the default
// when unset, empty or invalid.
function envNumber(name, fallback) {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === "" ? null : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// The full return-pricing configuration: the mode ("flat-override"
// when EMS_FEED_IN_TARIFF_EUR is set to a positive value, "dynamic"
// otherwise) and every constant the derivation uses, so the API can
// expose them for honest frontend footnotes.
export function returnPriceConfig() {
  const flatTariffEur = flatOverrideTariffEur();
  return {
    mode: flatTariffEur === null ? "dynamic" : "flat-override",
    flatTariffEur,
    vatRate: envNumber(
      "EMS_RETURN_VAT_RATE",
      DEFAULT_RETURN_CONSTANTS.vatRate
    ),
    energyTaxEur: envNumber(
      "EMS_RETURN_ENERGY_TAX_EUR",
      DEFAULT_RETURN_CONSTANTS.energyTaxEur
    ),
    handlingFeeConsumptionEur: envNumber(
      "EMS_RETURN_HANDLING_FEE_CONSUMPTION_EUR",
      DEFAULT_RETURN_CONSTANTS.handlingFeeConsumptionEur
    ),
    handlingFeeFeedInEur: envNumber(
      "EMS_RETURN_HANDLING_FEE_FEED_IN_EUR",
      DEFAULT_RETURN_CONSTANTS.handlingFeeFeedInEur
    ),
    solarBonus: envNumber(
      "EMS_RETURN_SOLAR_BONUS",
      DEFAULT_RETURN_CONSTANTS.solarBonus
    ),
    bonusStartHour: envNumber(
      "EMS_RETURN_BONUS_START_HOUR",
      DEFAULT_RETURN_CONSTANTS.bonusStartHour
    ),
    bonusEndHour: envNumber(
      "EMS_RETURN_BONUS_END_HOUR",
      DEFAULT_RETURN_CONSTANTS.bonusEndHour
    ),
  };
}

// The dynamic return price for one hour, EUR/kWh ex VAT and ex
// energy tax. consumptionPriceEur is the all-in consumption price of
// the hour (EUR/kWh incl. VAT and energy tax), localHour the hour's
// local (Europe/Amsterdam) hour index; config is a returnPriceConfig
// shape. The flat override takes precedence whenever it is
// configured, independent of the price and the hour. Null when the
// consumption price is unknown (null, undefined or not finite) and
// no override is set - never a silent 0. Negative results are valid
// and never clamped.
export function deriveReturnPrice(consumptionPriceEur, localHour, config) {
  if (config.flatTariffEur !== null) {
    return config.flatTariffEur;
  }
  if (
    consumptionPriceEur === null ||
    consumptionPriceEur === undefined ||
    !Number.isFinite(consumptionPriceEur)
  ) {
    return null;
  }
  const marketPrice =
    consumptionPriceEur / (1 + config.vatRate) -
    config.energyTaxEur -
    config.handlingFeeConsumptionEur;
  let returnPrice = marketPrice + config.handlingFeeFeedInEur;
  const daytime =
    localHour >= config.bonusStartHour && localHour < config.bonusEndHour;
  if (marketPrice > 0 && daytime) {
    returnPrice *= 1 + config.solarBonus;
  }
  return returnPrice;
}
