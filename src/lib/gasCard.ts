// The hub's Gas/heating card view model (the Today stats grid): the
// pure mapping from the three /api/heat/gas responses (period=day,
// week and month, all anchored on today's local date key) to the
// card's rendered figures. The day response drives the headline
// (m3) and today's cost; the week and month responses drive the two
// period sub-lines. Each response fails soft on its own, so a missing
// period reads as the shared dash placeholder. An unknown price
// renders as the same dash, never 0 or a fabricated figure.

import type { GasUsageData } from "@/lib/api"

// The stat cards' shared unknown-value placeholder.
const PLACEHOLDER = "\u2014"

// A gas volume as the card's unit: two decimals, cubic meters.
export function formatM3(m3: number | null): string {
  return m3 === null ? PLACEHOLDER : `${m3.toFixed(2)} m\u00b3`
}

// Today's gas cost label: the euro figure per the project's euro-sign
// convention, or the dash when the price is unknown
// (hasUnknownPrice) or the cost figure cannot be trusted. Never 0.
export function gasCostLabel(
  totals: { cost_eur: number; hasUnknownPrice: boolean } | null,
): string {
  if (
    totals === null ||
    totals.hasUnknownPrice ||
    typeof totals.cost_eur !== "number" ||
    !Number.isFinite(totals.cost_eur)
  ) {
    return PLACEHOLDER
  }
  return `\u20ac${totals.cost_eur.toFixed(2)}`
}

export interface GasCardFigures {
  // Today's gas usage as the headline.
  headlineM3: string
  // Today's cost, or the dash on an unknown price.
  costLabel: string
  // The week-to-date and month-to-date sub-line figures.
  weekM3: string
  monthM3: string
}

// The card's four figures from the three period responses; a null
// response (failed request) contributes dashes only.
export function gasCardFigures(
  day: GasUsageData | null,
  week: GasUsageData | null,
  month: GasUsageData | null,
): GasCardFigures {
  return {
    headlineM3: formatM3(day === null ? null : day.totals.m3),
    costLabel: gasCostLabel(day === null ? null : day.totals),
    weekM3: formatM3(week === null ? null : week.totals.m3),
    monthM3: formatM3(month === null ? null : month.totals.m3),
  }
}

export interface GasCardView extends GasCardFigures {
  // True only until the first load of the three responses has
  // settled; the skeleton owns the card meanwhile, and refreshes keep
  // the previous content visible instead.
  loading: boolean
}

export function gasCardView({
  day,
  week,
  month,
  status,
}: {
  day: GasUsageData | null
  week: GasUsageData | null
  month: GasUsageData | null
  status: "loading" | "ok" | "error"
}): GasCardView {
  return {
    loading: status === "loading",
    ...gasCardFigures(day, week, month),
  }
}
