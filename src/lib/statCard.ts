// The hub stat cards' shared headline scale: one responsive size for
// every big figure, never per-card values. Tablet widths (the
// two-column grid between md and lg) take a smaller step so the
// value and its unit fit the narrow cells; phones (one column, wide
// cells) and large desktops (four columns) keep the full size.
// whitespace-nowrap keeps the value and its unit on one line as a
// single non-breaking unit at every step.
export const STAT_HEADLINE =
  "whitespace-nowrap text-[2.5rem] leading-snug tabular-nums md:text-[2rem] lg:text-[2.5rem]"
