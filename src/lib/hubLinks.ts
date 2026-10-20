import { todayTabUrl } from "./period.ts"

// The Today hub's stat cards and the navigation target of each.
// Every card opens its tab with the "today" period preset, so a card
// always lands on today's view of that tab. The live card opens the
// live energy flow page, which has no period.
export const HUB_LINKS = {
  live: "/live",
  savedEarned: todayTabUrl("/usage"),
  fromGrid: todayTabUrl("/usage"),
  homeUsage: todayTabUrl("/usage"),
  solarForecast: todayTabUrl("/solar"),
  solarToday: todayTabUrl("/solar"),
  batteryStatus: todayTabUrl("/battery"),
  batteryToday: todayTabUrl("/battery"),
} as const
