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
