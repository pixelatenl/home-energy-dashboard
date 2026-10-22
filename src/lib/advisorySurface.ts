// The advisory area's surface recipes: the class strings the advisory
// card and its section cards render in, moved here when the legacy
// advisory card retired (the owner decision of 22 October) so the
// monologue-based advisory area imports the same chrome from one
// place instead of carrying duplicates. Defined once, never per
// instance.

// The advisory day cards render in the stat cards' own surface: the
// app-wide glass pane (the .glass-card blur, saturation and edge
// seams), the 0.06 token fill, the card elevation and the token
// rounding - the same recipe as every Card in the app.
export const CARD_SURFACE =
  "glass-card glass-inset rounded-inset bg-card text-muted-foreground shadow-card";

// The structured advisory section cards: a column block whose day
// chip sits on its own line above the main text, like the compact
// widgets' label-above-content pattern, so every card's text starts
// on one vertical line.
export const GLASS_BLOCK = `flex flex-col gap-1.5 p-3 ${CARD_SURFACE}`;

// The glass chip register the advisory area's header and day chips
// share: the pill on top of the glass surfaces.
export const GLASS_CHIP =
  "rounded-full bg-white/15 text-chip-foreground backdrop-blur-sm";

// The provenance chip in the header's right cluster: the
// "Insight from HH:MM" stamp (or the honest absence), in the
// area's own glass register so it reads as the card's furniture.
export const PROVENANCE_CHIP =
  "flex shrink-0 items-center rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-xs font-medium text-chip-foreground tabular-nums backdrop-blur-sm";
