// Fixed colors for the usage breakdown categories, keyed by the
// breakdown API's category keys, so a category keeps its color across
// periods, metrics and tiles.

// Neutral gray for the unexplained remainder and unknown keys.
export const REST_COLOR = "#94a3b8"

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
