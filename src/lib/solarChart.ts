import type { ReturnPricing, SolarProductionPoint } from "@/lib/api"
import { periodEnd, periodStart, type Period } from "./period.ts"
import { localDateOf, localHourOf } from "./time.ts"

// Pure logic for the Solar Production chart: the slot model that
// places the API's interval series on a full-period axis, the peak
// label, and the interval price derivation. No React; everything is
// testable with plain data.

const DAY_MS = 86_400_000

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) / DAY_MS
}

function daysInPeriod(period: Period): number {
  return dayNumber(periodEnd(period)) - dayNumber(periodStart(period)) + 1
}

// One axis slot: its index on the full-period axis, the series point
// that falls inside it (null when no production was recorded), and
// the slot's kWh (0 when unrecorded - PV produces nothing at night,
// and slots entirely without data render empty, never fabricated).
export interface SolarSlot {
  index: number
  point: SolarProductionPoint | null
  kwh: number
}

// The full-period slot axis. Hourly resolution (day and week): one
// slot per local hour of the window - 24 for a day, 7 * 24 for a
// week. Daily resolution (month and year): one slot per calendar
// day of the window. Points are placed by their local hour (hourly)
// or the local date of their bucket start (daily); a point outside
// the window (a UTC bucket straddling the window edge) is dropped
// rather than forced onto the axis.
export function solarSlots(
  points: SolarProductionPoint[],
  period: Period
): SolarSlot[] {
  const start = periodStart(period)
  const hourly = period.kind === "day" || period.kind === "week"
  const count = hourly
    ? period.kind === "day"
      ? 24
      : 7 * 24
    : daysInPeriod(period)
  const slots: SolarSlot[] = Array.from({ length: count }, (_, index) => ({
    index,
    point: null,
    kwh: 0,
  }))
  for (const point of points) {
    let index: number
    if (hourly) {
      const dayOffset = dayNumber(localDateOf(point.ts)) - dayNumber(start)
      index = dayOffset * 24 + localHourOf(point.ts)
    } else {
      index = dayNumber(localDateOf(point.ts)) - dayNumber(start)
    }
    if (index < 0 || index >= count) {
      continue
    }
    slots[index] = { index, point, kwh: point.kwh }
  }
  return slots
}

// The slot label for tooltips and the peak line: "09:00" for an
// hourly slot's hour, "Sat 17 Oct" for a daily slot's day.
export function solarSlotLabel(ts: string, hourly: boolean): string {
  if (hourly) {
    return `${String(localHourOf(ts)).padStart(2, "0")}:00`
  }
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(ts))
}

// The interval's electricity price, derived bottom-up from the
// interval's own figures: avoided cost / kWh. Null when either figure
// is unknown (the tooltip then reads the price as unknown, never 0).
// Derived from the payload's two-decimal cost, so displays carry the
// approximation sign.
export function intervalPriceOf(point: SolarProductionPoint): number | null {
  if (point.avoidedCostEur === null || point.kwh <= 0) {
    return null
  }
  return point.avoidedCostEur / point.kwh
}

// The interval's solar disposition split for the cost-mode tooltip:
// how the interval's production was divided across the home, the
// grid export and the battery charging. Null when the split is
// unknown (the hourly aggregate lagged the interval away), so the
// tooltip reads unknown, never 0.
export interface SolarSplit {
  homeKwh: number
  gridKwh: number
  batteryKwh: number
}

export function solarSplitOf(point: SolarProductionPoint): SolarSplit | null {
  const { solarToHomeKwh, solarToGridKwh, solarToBatteryKwh } = point
  if (
    solarToHomeKwh === null ||
    solarToGridKwh === null ||
    solarToBatteryKwh === null
  ) {
    return null
  }
  return {
    homeKwh: solarToHomeKwh,
    gridKwh: solarToGridKwh,
    batteryKwh: solarToBatteryKwh,
  }
}

// The weather forecast panel's visibility rule: only the current day,
// week or month carries a forecast; previous periods and every year
// period (the current year included) show the production chart alone.
export function forecastPanelVisible(
  period: Period,
  isCurrent: boolean
): boolean {
  return isCurrent && period.kind !== "year"
}

// The feed-in tariff as the footnote's label in cents per kWh:
// 0.12 reads "12 ct/kWh", 0.125 "12.5 ct/kWh". The tariff is
// EUR/kWh in the payload; the cents wording matches how Dutch
// tariffs are quoted.
export function feedInTariffCentsLabel(tariffEur: number): string {
  const cents = Number((tariffEur * 100).toFixed(2))
  return `${cents} ct/kWh`
}

// The footnote's export-pricing sentence, reflecting the payload's
// meta.returnPricing: the dynamic construction's wording, or the
// flat-override wording when the explicit tariff is set.
export function exportPricingLabel(pricing: ReturnPricing): string {
  if (pricing.mode === "flat-override" && pricing.flatTariffEur !== null) {
    return `Export is paid at a flat feed-in tariff of ${feedInTariffCentsLabel(pricing.flatTariffEur)}.`
  }
  const bonus = Math.round(pricing.solarBonus * 100)
  return (
    "Export is paid at the dynamic return price: the market price excluding taxes plus the feed-in fee" +
    (bonus > 0
      ? `, plus a ${bonus}% Zonnebonus during daytime hours`
      : "") +
    "."
  )
}
