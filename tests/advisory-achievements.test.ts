import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAdvisoryContent } from "../src/lib/advisoryRows.ts";
import type { SummaryInsight } from "../src/lib/api.ts";

// The achievements rendering (contract section 4, the Stage 3a named
// frontend exception): the server-composed achievement sentences render
// verbatim as muted recap rows in the Today block - no chips, no icons,
// no punctuation changes - and an empty or absent array renders
// nothing. Additive only: the existing advisoryRows and advisoryText
// suites stay untouched.

const ACHIEVEMENTS = [
  "Your own solar covered 52% of today's usage.",
  "Your battery earned €1.40 today.",
];

function recapInsight(
  overrides: Partial<SummaryInsight> = {},
): SummaryInsight {
  return {
    primary_action: {
      what: "No action worth taking today",
      when: "",
      saving_eur: 0,
      confidence: "medium",
    },
    supporting_facts: [],
    warning: null,
    context_note: null,
    no_opportunity: true,
    candidates: [
      {
        label: "Dishwasher energy",
        load_kwh: 1.07,
        window: "21:00-00:00 today",
        saving_eur: 0.02,
        below_threshold: true,
        basis: "your dishwasher used 1.07 kWh so far today",
      },
    ],
    priceSentence: "Today's lowest price is €0.31 at 13:00 and the peak is €0.44 at 08:00.",
    batterySentence: null,
    achievements: [],
    guidance: {
      window: "21:00-00:00 today",
      cheapest_window_average_eur: 0.3,
      peak_hour: "08:00",
      peak_price_eur: 0.44,
      spread_per_kwh_eur: 0.14,
      practical: false,
      window_start_hour: 21,
      hours_remaining: 3,
      day_average_eur: 0.36,
      day_cheapest_window: "13:00-16:00",
      day_cheapest_average_eur: 0.31,
      peak_ahead: false,
      day_cheapest_passed: true,
      remaining_average_eur: 0.33,
      delay: null,
      line: "",
    },
    outlook: null,
    advisory: null,
    generated_at: "2026-10-20T19:05:00.000Z",
    insight_as_of: "2026-10-20T19:05:00.000Z",
    state: "fresh",
    error: null,
    ...overrides,
  };
}

describe("achievements rendering", () => {
  it("renders the sentences verbatim as muted rows in the Today card", () => {
    const content = buildAdvisoryContent(
      recapInsight({ achievements: [...ACHIEVEMENTS] }),
    );
    const today = content.cards.find((card) => card.chip === "Today");
    assert.ok(today !== undefined);
    const rows = today.items.filter((item) =>
      ACHIEVEMENTS.includes(item.sentence),
    );
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.muted, true);
      assert.equal(row.valueChip, null);
      assert.deepEqual(row.supporting, []);
    }
    // Verbatim and in order: the sentences carry their own periods.
    assert.deepEqual(
      today.items
        .map((item) => item.sentence)
        .filter((s) => ACHIEVEMENTS.includes(s)),
      ACHIEVEMENTS,
    );
  });

  it("renders nothing for an empty array, with no layout shift", () => {
    const withRows = buildAdvisoryContent(recapInsight({ achievements: [] }));
    const withoutField = buildAdvisoryContent(
      recapInsight({ achievements: undefined }),
    );
    const todayWith = withRows.cards.find((card) => card.chip === "Today");
    const todayWithout = withoutField.cards.find((card) => card.chip === "Today");
    assert.ok(todayWith !== undefined && todayWithout !== undefined);
    assert.equal(todayWith.items.length, todayWithout.items.length);
    assert.ok(
      todayWith.items.every((item) => !item.sentence.includes("solar covered")),
    );
  });

  it("keeps the achievements out of the other day cards", () => {
    const content = buildAdvisoryContent(
      recapInsight({
        achievements: [...ACHIEVEMENTS],
        outlook: {
          days: [
            {
              date: "2026-10-21",
              weekday: "Wednesday",
              weekday_short: "Wed",
              solar_kwh: 6.4,
              solar_score: 25,
              condition: "cloudy",
              average_price_eur: null,
            },
            {
              date: "2026-10-23",
              weekday: "Friday",
              weekday_short: "Fri",
              solar_kwh: 1.2,
              solar_score: 5,
              condition: "rain",
              average_price_eur: null,
            },
          ],
          best_solar_day: null,
          poor_day: {
            date: "2026-10-23",
            weekday: "Friday",
            weekday_short: "Fri",
            solar_kwh: 1.2,
            condition: "rain",
            line: "Friday looks like the week's weakest solar day at 1.2 kWh.",
            advice:
              "With rain expected, it is not a good day to run your large appliances.",
          },
        },
      }),
    );
    assert.equal(content.cards.length, 2);
    const other = content.cards.find((card) => card.chip !== "Today");
    assert.ok(other !== undefined);
    assert.ok(
      other.items.every(
        (item) => !ACHIEVEMENTS.includes(item.sentence),
      ),
    );
  });
});

describe("the quiet-day card without a primary action", () => {
  it("renders the honest rows the payload carries", () => {
    // The advisory core serves no primary action on quiet days; the
    // rows still render - the same rows the legacy card shows.
    const content = buildAdvisoryContent(
      recapInsight({
        primary_action: null,
        context_note: "An ordinary day: the house drew steadily from the grid.",
        achievements: ["Your own solar covered 52% of today's usage."],
      }),
    );
    const today = content.cards.find((card) => card.chip === "Today");
    assert.ok(today !== undefined);
    const sentences = today.items.map((item) => item.sentence);
    assert.ok(sentences.includes("Largest opportunity today: Dishwasher energy"));
    assert.ok(
      sentences.includes(
        "An ordinary day: the house drew steadily from the grid.",
      ),
    );
    assert.ok(sentences.includes("Your own solar covered 52% of today's usage."));
    assert.ok(sentences.includes("Today's cheap hours (13:00-16:00) have passed"));
    // No action row: there is no action to command.
    assert.ok(!sentences.some((s) => s.startsWith("Run your")));
  });
});
