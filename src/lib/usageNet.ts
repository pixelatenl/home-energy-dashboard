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
