// Appliance display colors, shared by the usage widget, its breakdown
// bars and the hourly chart on the usage page. Keys are the normalized
// appliance names the API returns (the entity name without its trailing
// "energy"/"power" word).

const APPLIANCE_COLORS: Record<string, string> = {
  Dishwasher: "#3b82f6",
  Dryer: "#f97316",
  "Washing machine": "#8b5cf6",
}

// Neutral gray for the rest-of-home residual and unknown appliances.
export const REST_COLOR = "#94a3b8"

export function applianceColor(name: string): string {
  return APPLIANCE_COLORS[name] ?? REST_COLOR
}

// Fixed colors for the usage breakdown categories, keyed by the
// breakdown API's category keys, so a category keeps its color across
// periods, metrics and tiles. The plug categories reuse their
// appliance colors so the whole Usage tab reads consistently; "other"
// is the darker neutral of the collapsed sliver tiles.
const USAGE_CATEGORY_COLORS: Record<string, string> = {
  dishwasher: "#3b82f6",
  dryer: "#f97316",
  washing_machine: "#8b5cf6",
  heat_pump: "#e11d48",
  remainder: "#94a3b8",
  other: "#64748b",
}

export function usageCategoryColor(key: string): string {
  return USAGE_CATEGORY_COLORS[key] ?? REST_COLOR
}
