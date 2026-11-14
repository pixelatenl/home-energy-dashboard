// The net view of one period's breakdown (docs/spec.md section
// 7.1): the with-and-without comparison for the period summary
// strip. Pure: the payload in, the three figures out.

import type { UsageBreakdown } from "@/lib/api";

export interface NetFigures {
  // Net grid volume in kWh: import minus export. Negative on
  // net-exporter periods (more fed in than drawn).
  netKwh: number
  // Net grid cost in EUR: import cost minus feed-in credit. Null
  // without price data; negative when the feed-in credit exceeds
  // the import cost.
  netCostEur: number | null
  // Saved and earned in EUR: the all-imported cost (the headline's
  // cost) minus the net grid cost. Null without price data; signed,
  // so a pathological period can read negative.
  savedEur: number | null
  // The kWh that never drew net from the grid: total consumption
  // minus net grid volume (self-supplied plus exported).
  selfSuppliedKwh: number
}

export function netFigures(data: UsageBreakdown): NetFigures {
  const netKwh = data.grid_import_kwh - data.grid_export_kwh
  const netCostEur =
    data.import_cost_eur === null || data.export_credit_eur === null
      ? null
      : data.import_cost_eur - data.export_credit_eur
  const savedEur =
    netCostEur === null || data.total.cost_eur === null
      ? null
      : data.total.cost_eur - netCostEur
  return {
    netKwh,
    netCostEur,
    savedEur,
    selfSuppliedKwh: data.total.kwh - netKwh,
  }
}

// True when the saved figure would display as zero or less: the
// amount rounded to whole cents is <= 0, so a computed 0.004 still
// reads as "€0.00" and is honestly a no-savings day. Only a value
// that displays as €0.01 or more headlines as a figure.
export function hasNoSavings(savedEur: number | null): boolean {
  return savedEur !== null && Math.round(savedEur * 100) <= 0;
}

// The "Saved and earned" headline text: a dash without price data,
// an honest "No savings <wording>" instead of a zero-or-negative
// amount (a battery-charging day without discharge is a pay-first
// day - the real amount stays visible in the Usage tab), otherwise
// the plain EUR figure. The wording is period-aware: the hub card
// uses the default "today", the Usage summary passes the period's
// word ("this day", "this week", ...).
export function savedHeadline(
  savedEur: number | null,
  wording: string = "today",
): string {
  if (savedEur === null) {
    return "\u2014";
  }
  if (hasNoSavings(savedEur)) {
    return `No savings ${wording}`;
  }
  return `\u20ac${savedEur.toFixed(2)}`;
}
