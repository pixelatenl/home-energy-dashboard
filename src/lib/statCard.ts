// The hub stat cards' shared headline scale: one responsive size for
// every big figure, never per-card values. Tablet widths (the
// two-column grid between md and lg) take a smaller step so the
// value and its unit fit the narrow cells; phones (one column, wide
// cells) and large desktops (four columns) keep the full size.
// whitespace-nowrap keeps the value and its unit on one line as a
// single non-breaking unit at every step.
export const STAT_HEADLINE =
  "whitespace-nowrap text-[2.5rem] leading-snug tabular-nums md:text-[2rem] lg:text-[2.5rem]"

// The stat cards' shared euro formatting: a null figure (unknown
// price) reads the dash placeholder, never 0.
export function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `\u20ac${value.toFixed(2)}`
}

// Signed like the summary strip's delta lines: "+€0.85" / "−€0.35".
export function signedEur(value: number): string {
  return `${value >= 0 ? "+" : "\u2212"}\u20ac${Math.abs(value).toFixed(2)}`
}

// Signed kWh delta: "+64.9 kWh" / "−12.0 kWh".
export function signedKwh(value: number): string {
  return `${value >= 0 ? "+" : "\u2212"}${Math.abs(value).toFixed(1)} kWh`
}
