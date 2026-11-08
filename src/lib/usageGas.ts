// The Usage tab's gas view models: the Gas/heating stat card's figures
// (docs/spec.md section 7.1) and the gas slot chart's slot series
// (docs/spec.md section 8.1). Pure: the /api/heat/gas responses in,
// the rendered figures out. The unknown-price rule is shared with the
// hub's gas card: a window whose totals carry hasUnknownPrice (or a
// non-finite cost) reads the dash placeholder, never 0.

import type { GasInterval, GasUsageData } from "@/lib/api"
import { formatM3, knownGasCost } from "./gasCard.ts"
import { formatEur, signedEur } from "./statCard.ts"
import {
  amsterdamDayStartMs,
  dateKeyPlus,
  localDateOf,
  localHourOf,
} from "./time.ts"

// The stat cards' shared unknown-value placeholder.
export const GAS_DASH = "\u2014"

// Signed like the summary strip's delta lines: "+1.23 m³" / "−0.50 m³".
export function signedM3(value: number): string {
  return `${value >= 0 ? "+" : "\u2212"}${Math.abs(value).toFixed(2)} m\u00b3`
}

// One window's honest totals: the m3 always (it is physical), the
// cost only when the price is known - never 0 on an unknown price.
export interface GasWindowTotals {
  m3: number
  costEur: number | null
}

export function gasWindowTotals(
  data: GasUsageData | null,
): GasWindowTotals | null {
  if (data === null) {
    return null
  }
  return { m3: data.totals.m3, costEur: knownGasCost(data.totals) }
}

// An empty window (no intervals at all) is the card's honest empty
// state, distinct from a failed fetch.
export function gasWindowEmpty(data: GasUsageData | null): boolean {
  return data !== null && data.series.length === 0
}

export interface GasStatFigures {
  // The mode's primary metric large: m3 in energy mode, the cost in
  // cost mode (the dash on an unknown price).
  headline: string
  // The mode's other metric beneath.
  secondary: string
  // The previous-period deltas of the detail line: the m3 delta
  // always (a dash when either window is missing), the cost delta
  // only when both windows have a known price, else the dash.
  deltaM3: string
  deltaCost: string
}

// The Gas/heating stat card's four rendered figures from the current
// and previous period's /api/heat/gas responses. A null window (a
// failed fetch) contributes dashes only, so one failed fetch never
// disturbs the other window's figures.
export function gasStatFigures(
  current: GasUsageData | null,
  previous: GasUsageData | null,
  mode: "energy" | "cost",
): GasStatFigures {
  const cur = gasWindowTotals(current)
  const prev = gasWindowTotals(previous)
  const energyFirst = mode === "energy"
  const costLabel =
    cur === null || cur.costEur === null ? GAS_DASH : formatEur(cur.costEur)
  const headline =
    cur === null ? GAS_DASH : energyFirst ? formatM3(cur.m3) : costLabel
  const secondary =
    cur === null ? GAS_DASH : energyFirst ? costLabel : formatM3(cur.m3)
  const deltaM3 =
    cur === null || prev === null ? GAS_DASH : signedM3(cur.m3 - prev.m3)
  const deltaCost =
    cur !== null &&
    prev !== null &&
    cur.costEur !== null &&
    prev.costEur !== null
      ? signedEur(cur.costEur - prev.costEur)
      : GAS_DASH
  return { headline, secondary, deltaM3, deltaCost }
}

// ---- The gas slot chart's view model (docs/spec.md section 8.1) ----

export type GasChartGranularity = "hour" | "day" | "month"

export interface GasChartSlot {
  // ISO instant of the slot's local start.
  ts: string
  m3: number
  // Null when the slot has no price row (never 0).
  costEur: number | null
  priceEurPerM3: number | null
  // False for slots the period spans but the series does not carry
  // (the days ahead of an in-progress month): on the axis, no bar.
  hasData: boolean
}

// The slot key a series interval joins on, mirroring the per-slot
// chart's keys: the UTC hour start for hours (unique across a DST
// fall-back day's repeated 02:00), the local date key for days, the
// "YYYY-MM" key for months.
export function gasSlotKey(
  ts: string,
  granularity: GasChartGranularity,
): string {
  if (granularity === "hour") {
    return String(Math.floor(Date.parse(ts) / 3_600_000) * 3_600_000)
  }
  const dateKey = localDateOf(ts)
  return granularity === "day" ? dateKey : dateKey.slice(0, 7)
}

// The full slot list of the window at the endpoint's granularity:
// every hour of a day period (25 on a fall-back day), every calendar
// day of a week or month (the days ahead included), all twelve months
// of a year. Series intervals join by key; a slot without an
// interval sits on the axis without a bar.
export function gasChartSlots(data: GasUsageData): GasChartSlot[] {
  const granularity = data.granularity
  const byKey = new Map<string, GasInterval>()
  for (const interval of data.series) {
    byKey.set(gasSlotKey(interval.ts, granularity), interval)
  }
  const fromMs = Date.parse(data.window.start)
  const toMs = Date.parse(data.window.end)
  const slots: GasChartSlot[] = []
  const push = (tsMs: number, key: string) => {
    const hit = byKey.get(key)
    slots.push({
      ts: new Date(tsMs).toISOString(),
      m3: hit?.m3 ?? 0,
      costEur: hit?.cost_eur ?? null,
      priceEurPerM3: hit?.price_eur_per_m3 ?? null,
      hasData: hit !== undefined,
    })
  }
  if (granularity === "hour") {
    for (let ms = fromMs; ms < toMs; ms += 3_600_000) {
      push(ms, String(ms))
    }
    return slots
  }
  if (granularity === "day") {
    let day = localDateOf(new Date(fromMs).toISOString())
    const endDay = localDateOf(new Date(toMs - 1).toISOString())
    while (day <= endDay) {
      push(amsterdamDayStartMs(day), day)
      day = dateKeyPlus(day, 1)
    }
    return slots
  }
  const year = Number(localDateOf(new Date(fromMs).toISOString()).slice(0, 4))
  for (let month = 1; month <= 12; month += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`
    push(amsterdamDayStartMs(`${key}-01`), key)
  }
  return slots
}

// The bar's value in the mode: m3 in energy mode, the slot's cost in
// cost mode. A slot without its price row has no bar (the dash lives
// in the tooltip), never a 0 bar.
export function gasSlotBarValue(
  slot: GasChartSlot,
  mode: "energy" | "cost",
): number {
  return mode === "energy" ? slot.m3 : (slot.costEur ?? 0)
}

// The tooltip's cost line: the dash when the slot has no price row.
export function gasSlotCostLabel(slot: GasChartSlot): string {
  return slot.costEur === null ? GAS_DASH : formatEur(slot.costEur)
}

// The tooltip's price line: the dash when the slot has no price row.
export function gasSlotPriceLabel(slot: GasChartSlot): string {
  return slot.priceEurPerM3 === null
    ? GAS_DASH
    : `\u20ac${slot.priceEurPerM3.toFixed(4)}/m\u00b3`
}

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  weekday: "short",
  day: "numeric",
  month: "short",
})
const WEEKDAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  weekday: "short",
})
const DAY_NUMBER_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  day: "numeric",
})
const MONTH_SHORT_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  month: "short",
})
const MONTH_LONG_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  month: "long",
})

// The slot's tooltip label: "14:00", "Mon 12 Oct", "October".
export function gasSlotLabel(
  slot: GasChartSlot,
  granularity: GasChartGranularity,
): string {
  if (granularity === "hour") {
    return `${String(localHourOf(slot.ts)).padStart(2, "0")}:00`
  }
  if (granularity === "day") {
    return DAY_LABEL.format(new Date(slot.ts))
  }
  return MONTH_LONG_LABEL.format(new Date(slot.ts))
}

// The x-axis label beneath a slot, per the per-slot chart's
// conventions: every third hour, the week's first weekday then the
// day-of-month, the month abbreviation.
export function gasAxisLabel(
  slot: GasChartSlot,
  index: number,
  granularity: GasChartGranularity,
): string {
  if (granularity === "hour") {
    return index % 3 === 0 ? String(localHourOf(slot.ts)).padStart(2, "0") : ""
  }
  if (granularity === "day") {
    const date = new Date(slot.ts)
    if (index === 0) {
      return WEEKDAY_LABEL.format(date)
    }
    return DAY_NUMBER_LABEL.format(date)
  }
  return MONTH_SHORT_LABEL.format(new Date(slot.ts))
}
