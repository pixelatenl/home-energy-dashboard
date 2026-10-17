// Fixed colors for the usage breakdown categories, keyed by the
// breakdown API's category keys, so a category keeps its color across
// periods, metrics and tiles. The palette is muted and warm-leaning -
// slate, terracotta, plum, brick and warm grays - to sit with the
// dashboard's warm dark-brown glass aesthetic instead of bright
// Tailwind hues, at a depth where the treemap's white tile text
// keeps its contrast.

// Warm gray for the unexplained remainder and unknown keys.
export const REST_COLOR = "#8a7f70"

const USAGE_CATEGORY_COLORS: Record<string, string> = {
  dishwasher: "#3d6470",
  dryer: "#a86538",
  washing_machine: "#6f5d7e",
  heat_pump: "#8f4a4a",
  remainder: "#8a7f70",
  other: "#6b6157",
}

export function usageCategoryColor(key: string): string {
  return USAGE_CATEGORY_COLORS[key] ?? REST_COLOR
}
