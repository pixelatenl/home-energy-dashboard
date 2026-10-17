import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReturnPricing, SolarProductionPoint } from "../src/lib/api.ts";
import type { Period } from "../src/lib/period.ts";
import {
  exportPricingLabel,
  feedInTariffCentsLabel,
  forecastPanelVisible,
  intervalPriceOf,
  solarSlots,
  solarSplitOf,
} from "../src/lib/solarChart.ts";

// A series point at its bucket start: hourly points at UTC whole
// hours (energy_hourly), daily points at local midnights
// (energy_daily, Europe/Amsterdam). The split defaults to a fully
// home-consumed hour; pass nulls to model an unknown split. The
// export counter defaults to nothing exported with the earnings
// unconfigured (the payload's null-never-0 convention).
const point = (
  iso: string,
  kwh: number,
  cost: number | null = null,
  split: { home: number; grid: number; battery: number } | null = {
    home: kwh,
    grid: 0,
    battery: 0,
  },
  exportFigures: { exportKwh: number | null; exportEarningsEur: number | null } = {
    exportKwh: 0,
    exportEarningsEur: null,
  }
): SolarProductionPoint => ({
  ts: iso,
  kwh,
  avoidedCostEur: cost,
  solarToHomeKwh: split === null ? null : split.home,
  solarToGridKwh: split === null ? null : split.grid,
  solarToBatteryKwh: split === null ? null : split.battery,
  selfConsumptionAvoidedCostEur: null,
  exportKwh: exportFigures.exportKwh,
  exportEarningsEur: exportFigures.exportEarningsEur,
});

// Amsterdam is UTC+2 on these October dates, so a daily bucket for
// local day N starts at 22:00Z on N-1.
describe("solarSlots: the full-period axis", () => {
  it("places hourly points on the day's 24-slot axis by local hour", () => {
    const period: Period = { kind: "day", date: "2026-10-17" };
    const slots = solarSlots(
      [point("2026-10-16T22:00:00Z", 0.03, 0.01), point("2026-10-17T07:00:00Z", 0.36, 0.12)],
      period
    );
    assert.equal(slots.length, 24);
    assert.equal(slots[0].kwh, 0.03);
    assert.equal(slots[9].kwh, 0.36);
    // Night hours without a recorded point are real zeros, not
    // fabricated data.
    assert.equal(slots[1].kwh, 0);
    assert.equal(slots[1].point, null);
  });

  it("places the week's hourly points across 7 * 24 slots", () => {
    const period: Period = { kind: "week", date: "2026-10-15" };
    const slots = solarSlots(
      [point("2026-10-16T22:00:00Z", 1.2), point("2026-10-18T05:00:00Z", 0.8)],
      period
    );
    assert.equal(slots.length, 7 * 24);
    // The week starts Monday 2026-10-12; 2026-10-17 00:00 local is
    // day offset 5, hour 0.
    assert.equal(slots[5 * 24 + 0].kwh, 1.2);
    assert.equal(slots[6 * 24 + 7].kwh, 0.8);
  });

  it("places the month's daily buckets one slot per calendar day", () => {
    const period: Period = { kind: "month", date: "2026-10-17" };
    const slots = solarSlots(
      [point("2026-10-10T22:00:00Z", 12.12, 2.45), point("2026-10-16T22:00:00Z", 3.12, 0.81)],
      period
    );
    assert.equal(slots.length, 31);
    assert.equal(slots[10].kwh, 12.12);
    assert.equal(slots[16].kwh, 3.12);
  });

  it("spans a full year of daily slots", () => {
    const period: Period = { kind: "year", date: "2026-06-01" };
    const slots = solarSlots([point("2026-10-10T22:00:00Z", 12.12)], period);
    assert.equal(slots.length, 365);
    assert.equal(slots[283].kwh, 12.12);
  });

  it("drops points outside the window instead of forcing them onto the axis", () => {
    const period: Period = { kind: "day", date: "2026-10-17" };
    const slots = solarSlots([point("2026-10-14T10:00:00Z", 5)], period);
    assert.equal(slots.length, 24);
    assert.ok(slots.every((slot) => slot.kwh === 0));
  });

  it("keeps unknown-price points on the axis with their kWh", () => {
    const period: Period = { kind: "day", date: "2026-10-17" };
    const slots = solarSlots([point("2026-10-17T07:00:00Z", 0.36, null)], period);
    assert.equal(slots[9].kwh, 0.36);
    assert.equal(slots[9].point?.avoidedCostEur, null);
  });
});

describe("intervalPriceOf: the derived interval price", () => {
  it("derives the price bottom-up from the interval's own figures", () => {
    assert.ok(Math.abs(intervalPriceOf(point("2026-10-17T07:00:00Z", 0.4, 0.12))! - 0.3) < 1e-9);
  });

  it("is null when the price or the kWh is unknown", () => {
    assert.equal(intervalPriceOf(point("2026-10-17T07:00:00Z", 0.36, null)), null);
    assert.equal(intervalPriceOf(point("2026-10-17T07:00:00Z", 0, 0.12)), null);
  });
});

describe("solarSplitOf: the cost-mode tooltip's split", () => {
  it("reads the disposition figures off the point", () => {
    const split = solarSplitOf(
      point("2026-10-17T09:00:00Z", 1.65, 0.5, { home: 0.85, grid: 0.8, battery: 0 })
    );
    assert.deepEqual(split, { homeKwh: 0.85, gridKwh: 0.8, batteryKwh: 0 });
  });

  it("is null when the split is unknown (a lagged daily interval)", () => {
    assert.equal(
      solarSplitOf(point("2026-10-16T22:00:00Z", 6.78, 1.9, null)),
      null
    );
  });
});

describe("feedInTariffCentsLabel: the footnote's tariff wording", () => {
  it("states the tariff in cents per kWh", () => {
    assert.equal(feedInTariffCentsLabel(0.12), "12 ct/kWh");
    assert.equal(feedInTariffCentsLabel(0.125), "12.5 ct/kWh");
    assert.equal(feedInTariffCentsLabel(0.0729), "7.29 ct/kWh");
  });
});

describe("exportPricingLabel: the footnote's pricing sentence", () => {
  const DYNAMIC: ReturnPricing = {
    mode: "dynamic",
    flatTariffEur: null,
    vatRate: 0.21,
    energyTaxEur: 0.11085,
    handlingFeeConsumptionEur: 0.0165,
    handlingFeeFeedInEur: 0.02,
    solarBonus: 0.1,
    bonusStartHour: 7,
    bonusEndHour: 18,
  };

  it("states the dynamic construction with the Zonnebonus", () => {
    assert.equal(
      exportPricingLabel(DYNAMIC),
      "Export is paid at the dynamic return price: the market price excluding taxes plus the feed-in fee, plus a 10% Zonnebonus during daytime hours."
    );
  });

  it("drops the bonus clause when no bonus is configured", () => {
    assert.equal(
      exportPricingLabel({ ...DYNAMIC, solarBonus: 0 }),
      "Export is paid at the dynamic return price: the market price excluding taxes plus the feed-in fee."
    );
  });

  it("states the flat override when it is configured", () => {
    assert.equal(
      exportPricingLabel({ ...DYNAMIC, mode: "flat-override", flatTariffEur: 0.125 }),
      "Export is paid at a flat feed-in tariff of 12.5 ct/kWh."
    );
  });
});

describe("forecastPanelVisible: the forecast panel gate", () => {
  const day: Period = { kind: "day", date: "2026-10-17" };
  const week: Period = { kind: "week", date: "2026-10-15" };
  const month: Period = { kind: "month", date: "2026-10-15" };
  const year: Period = { kind: "year", date: "2026-06-01" };

  it("renders for the current day, week and month", () => {
    assert.equal(forecastPanelVisible(day, true), true);
    assert.equal(forecastPanelVisible(week, true), true);
    assert.equal(forecastPanelVisible(month, true), true);
  });

  it("never renders for any previous period or any year", () => {
    assert.equal(forecastPanelVisible(day, false), false);
    assert.equal(forecastPanelVisible(week, false), false);
    assert.equal(forecastPanelVisible(month, false), false);
    assert.equal(forecastPanelVisible(year, true), false);
    assert.equal(forecastPanelVisible(year, false), false);
  });
});
