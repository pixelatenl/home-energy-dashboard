import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HUB_LINKS } from "../src/lib/hubLinks.ts";
import { TODAY_PERIOD, decodeParams, todayTabUrl } from "../src/lib/period.ts";

// The Today hub's stat cards and their navigation targets. Every card
// must open its tab with the "today" period preset, so a card always
// lands on today's view of that tab; the live card opens the live
// energy flow page, which has no period.

// A fixed "now" so the decode fallback (missing date -> current day)
// is deterministic. A local-time constructor keeps the calendar day
// stable regardless of the machine's timezone.
const NOW = new Date("2026-10-20T12:00:00");
const TODAY = "2026-10-20";

// The tab each hub card opens, keyed by the registry's card names.
const CARD_TABS = {
  savedEarned: "/usage",
  fromGrid: "/usage",
  homeUsage: "/usage",
  solarForecast: "/solar",
  solarToday: "/solar",
  batteryStatus: "/battery",
  batteryToday: "/battery",
} as const;

describe("todayTabUrl: the hub cards' today link", () => {
  it("presets the today period (day) on the tab path", () => {
    assert.equal(todayTabUrl("/usage"), "/usage?period=day");
    assert.equal(todayTabUrl("/solar"), "/solar?period=day");
    assert.equal(todayTabUrl("/battery"), "/battery?period=day");
  });

  it("names the day period as the app's today period", () => {
    assert.equal(TODAY_PERIOD, "day");
  });
});

describe("HUB_LINKS: the hub stat cards' targets", () => {
  it("points each metric card at its tab with the today period", () => {
    for (const [card, tab] of Object.entries(CARD_TABS)) {
      assert.equal(
        HUB_LINKS[card as keyof typeof CARD_TABS],
        `${tab}?period=day`,
        `the ${card} card should open ${tab} on today`,
      );
    }
  });

  it("keeps the live card on the live flow page, which has no period", () => {
    assert.equal(HUB_LINKS.live, "/live");
    assert.ok(!HUB_LINKS.live.includes("period="));
  });

  it("decodes to the current day, so a card always lands on today", () => {
    for (const [card, tab] of Object.entries(CARD_TABS)) {
      const target = HUB_LINKS[card as keyof typeof CARD_TABS];
      // The path is the card's tab.
      assert.equal(target.slice(0, target.indexOf("?")), tab);
      // The query decodes to the day period anchored on the current day.
      const query = target.slice(target.indexOf("?") + 1);
      const period = decodeParams(new URLSearchParams(query), NOW);
      assert.equal(period.kind, "day");
      assert.equal(period.date, TODAY);
    }
  });
});
