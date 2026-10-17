import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RETURN_CONSTANTS,
  deriveReturnPrice,
  returnPriceConfig,
} from "../server/return-price.mjs";

// The default configuration with the flat override disabled - the
// pure derivation's context.
const DYNAMIC = {
  mode: "dynamic",
  flatTariffEur: null,
  ...DEFAULT_RETURN_CONSTANTS,
};

// The 2026 defaults as one place to read expectations from: with
// VAT 21%, energy tax 0.11085, consumption handling fee 0.0165 and
// feed-in fee 0.02, an all-in consumption price of 0.40 EUR/kWh
// implies market = 0.40/1.21 - 0.11085 - 0.0165 = 0.20322851...
const MARKET_AT_040 =
  0.4 / (1 + DEFAULT_RETURN_CONSTANTS.vatRate) -
  DEFAULT_RETURN_CONSTANTS.energyTaxEur -
  DEFAULT_RETURN_CONSTANTS.handlingFeeConsumptionEur;

describe("deriveReturnPrice: the dynamic construction", () => {
  it("adds the feed-in fee and the 10% Zonnebonus in positive daytime hours", () => {
    const price = deriveReturnPrice(0.4, 12, DYNAMIC);
    // (market 0.20322851 + 0.02) x 1.10.
    assert.ok(Math.abs(price - (MARKET_AT_040 + 0.02) * 1.1) < 1e-12);
    assert.ok(Math.abs(price - 0.24555) < 1e-5);
  });

  it("skips the bonus at night: market price plus the feed-in fee only", () => {
    const price = deriveReturnPrice(0.4, 3, DYNAMIC);
    assert.ok(Math.abs(price - (MARKET_AT_040 + 0.02)) < 1e-12);
    // The bonus window is [7, 18): the boundary hours decide.
    assert.ok(
      Math.abs(deriveReturnPrice(0.4, 7, DYNAMIC) - (MARKET_AT_040 + 0.02) * 1.1) <
        1e-12
    );
    assert.ok(
      Math.abs(deriveReturnPrice(0.4, 17, DYNAMIC) - (MARKET_AT_040 + 0.02) * 1.1) <
        1e-12
    );
    assert.ok(
      Math.abs(deriveReturnPrice(0.4, 18, DYNAMIC) - (MARKET_AT_040 + 0.02)) < 1e-12
    );
  });

  it("does not apply the bonus at a zero market price, daytime included", () => {
    // market = 0 at consumption (0 + 0.11085 + 0.0165) x 1.21.
    const zeroMarketConsumption = 0.1540935;
    const price = deriveReturnPrice(zeroMarketConsumption, 12, DYNAMIC);
    assert.ok(Math.abs(price - 0.02) < 1e-12);
  });

  it("keeps a negative market price negative, daytime included, never clamped", () => {
    const price = deriveReturnPrice(0.1, 12, DYNAMIC);
    // market = 0.1/1.21 - 0.11085 - 0.0165 = -0.04470537; return =
    // -0.02470537 (no bonus).
    assert.ok(price < 0);
    assert.ok(Math.abs(price - (0.1 / 1.21 - 0.11085 - 0.0165 + 0.02)) < 1e-12);
  });

  it("is null for a missing or invalid consumption price, never a silent 0", () => {
    assert.equal(deriveReturnPrice(null, 12, DYNAMIC), null);
    assert.equal(deriveReturnPrice(undefined, 12, DYNAMIC), null);
    assert.equal(deriveReturnPrice(Number.NaN, 12, DYNAMIC), null);
  });
});

describe("deriveReturnPrice: the flat override takes precedence", () => {
  const OVERRIDE = { ...DYNAMIC, mode: "flat-override", flatTariffEur: 0.12 };

  it("returns the flat tariff for any hour and any price", () => {
    assert.equal(deriveReturnPrice(0.4, 12, OVERRIDE), 0.12);
    assert.equal(deriveReturnPrice(0.1, 3, OVERRIDE), 0.12);
  });

  it("prices even hours without a known consumption price", () => {
    assert.equal(deriveReturnPrice(null, 12, OVERRIDE), 0.12);
  });
});

describe("returnPriceConfig: the env-driven configuration", () => {
  const withEnv = (values, fn) => () => {
    const names = [
      "EMS_FEED_IN_TARIFF_EUR",
      "EMS_RETURN_VAT_RATE",
      "EMS_RETURN_ENERGY_TAX_EUR",
      "EMS_RETURN_HANDLING_FEE_CONSUMPTION_EUR",
      "EMS_RETURN_HANDLING_FEE_FEED_IN_EUR",
      "EMS_RETURN_SOLAR_BONUS",
      "EMS_RETURN_BONUS_START_HOUR",
      "EMS_RETURN_BONUS_END_HOUR",
    ];
    const saved = {};
    for (const name of names) {
      saved[name] = process.env[name];
      if (values[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = values[name];
      }
    }
    try {
      fn();
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = saved[name];
        }
      }
    }
  };

  it("defaults to the dynamic mode with the 2026 constants", () => {
    withEnv({}, () => {
      assert.deepEqual(returnPriceConfig(), {
        mode: "dynamic",
        flatTariffEur: null,
        ...DEFAULT_RETURN_CONSTANTS,
      });
    })();
  });

  it("switches to the flat override when EMS_FEED_IN_TARIFF_EUR is positive", () => {
    withEnv({ EMS_FEED_IN_TARIFF_EUR: "0.15" }, () => {
      const config = returnPriceConfig();
      assert.equal(config.mode, "flat-override");
      assert.equal(config.flatTariffEur, 0.15);
    })();
  });

  it("treats unset, empty, zero, negative and invalid overrides as dynamic", () => {
    for (const value of ["", "0", "-0.1", "abc"]) {
      withEnv({ EMS_FEED_IN_TARIFF_EUR: value }, () => {
        assert.equal(returnPriceConfig().mode, "dynamic");
      })();
    }
  });

  it("reads the constants from the environment, invalid values keep the default", () => {
    withEnv(
      {
        EMS_RETURN_ENERGY_TAX_EUR: "0.1228",
        EMS_RETURN_SOLAR_BONUS: "0",
        EMS_RETURN_BONUS_END_HOUR: "16",
      },
      () => {
        const config = returnPriceConfig();
        assert.equal(config.energyTaxEur, 0.1228);
        assert.equal(config.solarBonus, 0);
        assert.equal(config.bonusEndHour, 16);
      }
    )();
    withEnv({ EMS_RETURN_ENERGY_TAX_EUR: "not-a-number" }, () => {
      assert.equal(returnPriceConfig().energyTaxEur, 0.11085);
    })();
  });
});
