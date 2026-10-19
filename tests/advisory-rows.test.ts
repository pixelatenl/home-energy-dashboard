import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAdvisoryContent } from "../src/lib/advisoryRows.ts";
import type { SummaryInsight } from "../src/lib/api.ts";

function makeInsight(overrides: Partial<SummaryInsight> = {}): SummaryInsight {
  const tomorrow = "2026-10-15";
  const friday = "2026-10-16";
  const sunday = "2026-10-18";
  return {
    primary_action: {
      what: "Run your large appliances between 13:00 and 16:00",
      when: "13:00-16:00 today",
      saving_eur: 0.11,
      confidence: "high",
    },
    supporting_facts: [],
    warning: null,
    no_opportunity: false,
    candidates: [
      {
        label: "Dishwasher energy",
        load_kwh: 1.07,
        window: "13:00-16:00 today",
        saving_eur: 0.11,
        below_threshold: false,
        basis: "your dishwasher used 1.07 kWh so far today",
      },
    ],
    guidance: {
      window: "13:00-16:00 today",
      cheapest_window_average_eur: 0.262,
      peak_hour: "08:00",
      peak_price_eur: 0.51,
      spread_per_kwh_eur: 0.25,
      practical: true,
      window_start_hour: 13,
      hours_remaining: 2.5,
      day_average_eur: 0.36,
      day_cheapest_window: "12:00-15:00",
      day_cheapest_average_eur: 0.2574,
      peak_ahead: false,
      day_cheapest_passed: false,
      remaining_average_eur: 0.39,
      delay: null,
      line: "",
    },
    advisory: {
      type: "advance",
      triggered: false,
      tomorrow_average_eur: 0.36,
      tomorrow_solar_kwh: 4,
      tomorrow_solar_score: 28,
      tomorrow_low_solar: false,
      compare_day: "today",
      compare_average_eur: 0.36,
      compare_solar_kwh: 14.4,
      price_difference_per_kwh: 0,
      horizon_note: "",
      line: "",
    },
    outlook: {
      days: [
        {
          date: tomorrow,
          weekday: "Thursday",
          weekday_short: "Thu",
          solar_kwh: 4,
          solar_score: 28,
          condition: "cloudy",
          average_price_eur: 0.36,
        },
        {
          date: friday,
          weekday: "Friday",
          weekday_short: "Fri",
          solar_kwh: 5.73,
          solar_score: 15,
          condition: "rain",
          average_price_eur: null,
        },
        {
          date: sunday,
          weekday: "Sunday",
          weekday_short: "Sun",
          solar_kwh: 12.55,
          solar_score: 29,
          condition: "cloudy",
          average_price_eur: null,
        },
      ],
      best_solar_day: {
        date: sunday,
        weekday: "Sunday",
        weekday_short: "Sun",
        solar_kwh: 12.55,
        solar_score: 29,
        good: false,
      },
      poor_day: {
        date: friday,
        weekday: "Friday",
        weekday_short: "Fri",
        solar_kwh: 5.73,
        condition: "rain",
      },
    },
    generated_at: "2026-10-14T12:00:00.000Z",
    insight_as_of: "2026-10-14T12:00:00.000Z",
    stale: false,
    error: null,
    ...overrides,
  };
}

describe("the row builder: the chronological timeline", () => {
  it("renders today, tomorrow, then the noteworthy days by date", () => {
    // The best day (Sunday) earns its designation on the LAST
    // noteworthy date while the poor rain day (Friday) falls earlier:
    // the cards must follow the calendar, not the prominence.
    const content = buildAdvisoryContent(makeInsight());
    assert.deepEqual(
      content.cards.map((card) => card.chip),
      ["Today", "Tomorrow", "Fri", "Sun"],
    );
  });

  it("keeps the best-day designation attached to its own day", () => {
    const content = buildAdvisoryContent(makeInsight());
    const sunday = content.cards.find((card) => card.chip === "Sun");
    assert.ok(sunday);
    assert.equal(
      sunday.items[0].sentence,
      "Sunday brings the week's best solar: score 29, 12.55 kWh expected",
    );
    const friday = content.cards.find((card) => card.chip === "Fri");
    assert.ok(friday);
    assert.match(friday.items[0].sentence, /^Friday brings rain/);
  });

  it("orders the noteworthy days ascending whatever earns which title", () => {
    // The reverse prominence: the best day falls before the poor day -
    // still calendar order.
    const insight = makeInsight();
    if (insight.outlook) {
      insight.outlook.days = [
        insight.outlook.days[0],
        insight.outlook.days[1],
        {
          date: "2026-10-17",
          weekday: "Saturday",
          weekday_short: "Sat",
          solar_kwh: 12.55,
          solar_score: 68,
          condition: "sunny",
          average_price_eur: null,
        },
        insight.outlook.days[2],
      ];
      insight.outlook.best_solar_day = {
        date: "2026-10-17",
        weekday: "Saturday",
        weekday_short: "Sat",
        solar_kwh: 12.55,
        solar_score: 68,
        good: true,
      };
      insight.outlook.poor_day = {
        date: "2026-10-18",
        weekday: "Sunday",
        weekday_short: "Sun",
        solar_kwh: 2,
        condition: "rain",
      };
    }
    const content = buildAdvisoryContent(insight);
    const beyond = content.cards
      .map((card) => card.chip)
      .filter((chip) => chip !== "Today" && chip !== "Tomorrow");
    assert.deepEqual(beyond, ["Sat", "Sun"]);
  });

  it("suppresses the guidance item when the action carries its window", () => {
    const content = buildAdvisoryContent(makeInsight());
    const today = content.cards.find((card) => card.chip === "Today");
    assert.ok(today);
    assert.equal(today.items.length, 1);
    const action = today.items[0];
    assert.equal(action.sentence, "Run your large appliances between 13:00 and 16:00 for the best price left today");
    assert.equal(action.valueChip, "\u20AC0.11 potential savings");
  });

  it("groups the defer advice and the noteworthy fact into one day card", () => {
    // A defer to Sunday while Sunday also carries the best-solar
    // designation: one Sun card in calendar order (after Friday),
    // never two.
    const content = buildAdvisoryContent(
      makeInsight({
        no_opportunity: true,
        advisory: {
          type: "defer",
          triggered: true,
          tomorrow_average_eur: 0.36,
          tomorrow_solar_kwh: 4,
          tomorrow_solar_score: 28,
          tomorrow_low_solar: false,
          compare_day: "Sunday",
          compare_average_eur: 0.3,
          compare_solar_kwh: 12.55,
          price_difference_per_kwh: -0.06,
          horizon_note: "",
          line: "",
        },
      }),
    );
    assert.deepEqual(
      content.cards.map((card) => card.chip),
      ["Today", "Fri", "Sun"],
    );
    const sunday = content.cards.filter((card) => card.chip === "Sun");
    assert.equal(sunday.length, 1);
    assert.equal(sunday[0].items.length, 2);
    assert.equal(sunday[0].items[0].valueChip, "\u20AC0.06/kWh cheaper");
    assert.equal(sunday[0].items[1].valueChip, null);
  });

  it("renders the quiet-day summary as Today items, not loose lines", () => {
    const content = buildAdvisoryContent(
      makeInsight({
        no_opportunity: true,
        candidates: [
          {
            label: "Washing machine energy",
            load_kwh: 0.8,
            window: "09:00-12:00 today",
            saving_eur: -0.05,
            below_threshold: true,
            basis: "your washing machine used 0.8 kWh so far today",
          },
        ],
        context_note:
          "Your appliances have already used most of their daily power at low rates",
      }),
    );
    const today = content.cards.find((card) => card.chip === "Today");
    assert.ok(today);
    const sentences = today.items.map((item) => item.sentence);
    assert.ok(
      sentences.some((sentence) =>
        sentence.startsWith("Largest opportunity today: Washing machine energy")
      ),
    );
    assert.ok(
      sentences.includes(
        "Your appliances have already used most of their daily power at low rates"
      ),
    );
    const largest = today.items.find((item) =>
      item.sentence.startsWith("Largest opportunity today:")
    );
    assert.ok(largest);
    assert.equal(largest.valueChip, "\u20AC-0.05");
  });
});

describe("the row builder: the served narrative descriptions", () => {
  it("renders the served narrative as the Tomorrow description, with the unchanged comparison beneath", () => {
    const base = makeInsight();
    const content = buildAdvisoryContent({
      ...base,
      advisory: {
        ...base.advisory!,
        line: "Grid power should cost you less than today, with more of your own solar.",
      },
    });
    const tomorrow = content.cards.find((card) => card.chip === "Tomorrow");
    assert.ok(tomorrow);
    assert.equal(
      tomorrow.items[0].sentence,
      "Grid power should cost you less than today, with more of your own solar.",
    );
    // The subtext comparison line is unchanged and still carries the
    // exact figures the narrative leaves out.
    assert.deepEqual(tomorrow.items[0].supporting, [
      {
        text: "Tomorrow \u20ac0.36 avg \u00b7 4 kWh solar vs today \u20ac0.36 avg \u00b7 14.4 kWh solar",
        tabular: true,
      },
    ]);
  });

  it("keeps the delay imperative as the Tomorrow lead even when a narrative is served", () => {
    const base = makeInsight();
    const content = buildAdvisoryContent({
      ...base,
      no_opportunity: true,
      guidance: {
        ...base.guidance!,
        practical: false,
        delay: {
          tomorrow_window: "02:00-05:00 tomorrow",
          tomorrow_window_average_eur: 0.19,
          today_window_average_eur: 0.25,
        },
      },
      advisory: {
        ...base.advisory!,
        line: "Grid power should cost you less than today, with more of your own solar.",
      },
    });
    const tomorrow = content.cards.find((card) => card.chip === "Tomorrow");
    assert.ok(tomorrow);
    assert.equal(
      tomorrow.items[0].sentence,
      "Delay your large appliances until tomorrow's cheaper hours, from \u20ac0.19 average",
    );
    assert.equal(tomorrow.items[0].valueChip, "prefer tomorrow");
  });

  it("renders the served outlook lines for the best and poor day cards", () => {
    const base = makeInsight();
    const content = buildAdvisoryContent({
      ...base,
      outlook: {
        ...base.outlook!,
        best_solar_day: {
          ...base.outlook!.best_solar_day!,
          line: "A genuinely good solar day: score 68, 12.55 kWh expected.",
        },
        poor_day: {
          ...base.outlook!.poor_day!,
          line: "Rain and almost no solar of your own: 0.8 kWh expected.",
        },
      },
    });
    const sunday = content.cards.find((card) => card.chip === "Sun");
    assert.ok(sunday);
    assert.equal(
      sunday.items[0].sentence,
      "A genuinely good solar day: score 68, 12.55 kWh expected.",
    );
    const friday = content.cards.find((card) => card.chip === "Fri");
    assert.ok(friday);
    assert.equal(
      friday.items[0].sentence,
      "Rain and almost no solar of your own: 0.8 kWh expected.",
    );
    // The poor day's supporting advice line is the capitalized
    // fallback when the payload carries no served advice.
    assert.deepEqual(friday.items[0].supporting, [
      { text: "Avoid planning large appliances then" },
    ]);
  });

  it("carries the compact comparison on the solar-alone card", () => {
    const base = makeInsight();
    const content = buildAdvisoryContent({
      ...base,
      advisory: {
        ...base.advisory!,
        tomorrow_average_eur: null,
        tomorrow_low_solar: false,
        horizon_note:
          "Grid prices for tomorrow are not yet published; a fuller comparison follows once they are available.",
        line: "More of your own solar is expected than today.",
      },
    });
    const tomorrow = content.cards.find((card) => card.chip === "Tomorrow");
    assert.ok(tomorrow);
    assert.equal(
      tomorrow.items[0].sentence,
      "More of your own solar is expected than today.",
    );
    // The narrative no longer restates the solar figures, so the
    // numbers line carries the exact comparison on this card too.
    assert.deepEqual(tomorrow.items[0].supporting, [
      {
        text: "Tomorrow 4 kWh solar vs today \u20ac0.36 avg \u00b7 14.4 kWh solar",
        tabular: true,
      },
    ]);
    assert.equal(tomorrow.items[0].footer?.kind, "note");
  });
});

describe("the card refinement: fact prominence, battery removal, narrative advice", () => {
  it("leads the Today block with the served price sentence at fact weight", () => {
    const base = makeInsight();
    const content = buildAdvisoryContent({
      ...base,
      priceSentence:
        "Lowest price around 13:00 (\u20ac0.33); peak around 08:00 (\u20ac0.47).",
    });
    const today = content.cards.find((card) => card.chip === "Today");
    assert.ok(today);
    // The grounded price facts lead; verbatim from the served fields,
    // the frontend composes nothing.
    assert.equal(
      today.items[0].sentence,
      "Lowest price around 13:00 (\u20ac0.33); peak around 08:00 (\u20ac0.47).",
    );
    // Fact register: muted, no chip, no supporting lines.
    assert.equal(today.items[0].muted, true);
    assert.equal(today.items[0].valueChip, null);
    assert.deepEqual(today.items[0].supporting, []);
  });

  it("omits the price line cleanly when the price fields are missing", () => {
    const content = buildAdvisoryContent(makeInsight());
    const today = content.cards.find((card) => card.chip === "Today");
    assert.ok(today);
    // No placeholder, no empty row: the block starts with the action
    // as before.
    assert.match(today.items[0].sentence, /^Run your large appliances/);
  });

  it("never renders the battery sentence anywhere on the card", () => {
    const content = buildAdvisoryContent(
      makeInsight({ batterySentence: "The battery is at 100% and is idle." }),
    );
    const texts: string[] = [];
    for (const card of content.cards) {
      for (const item of card.items) {
        texts.push(item.sentence);
        for (const line of item.supporting) {
          texts.push(line.text);
        }
      }
    }
    assert.ok(
      texts.every((text) => !text.includes("The battery is at")),
    );
  });

  it("capitalizes the guidance supporting data strip", () => {
    const content = buildAdvisoryContent(
      makeInsight({
        no_opportunity: true,
        candidates: [
          {
            label: "Washing machine energy",
            load_kwh: 0.8,
            window: "09:00-12:00 today",
            saving_eur: 0.03,
            below_threshold: true,
            basis: "Your washing machine used 0.8 kWh so far today",
          },
        ],
      }),
    );
    const today = content.cards.find((card) => card.chip === "Today");
    assert.ok(today);
    const guidance = today.items.find((item) =>
      item.sentence.startsWith("Run your large appliances between 13:00"),
    );
    assert.ok(guidance);
    assert.match(
      guidance.supporting[0].text,
      /^Cheapest remaining window \u00b7 \u20ac0\.10\/kWh below the day's average of \u20ac0\.36/,
    );
  });

  it("renders the served poor-day advice as a narrative sentence", () => {
    const base = makeInsight();
    const content = buildAdvisoryContent({
      ...base,
      outlook: {
        ...base.outlook!,
        poor_day: {
          ...base.outlook!.poor_day!,
          advice:
            "With rain expected, it is not a good day to run your large appliances.",
        },
      },
    });
    const friday = content.cards.find((card) => card.chip === "Fri");
    assert.ok(friday);
    assert.deepEqual(friday.items[0].supporting, [
      {
        text: "With rain expected, it is not a good day to run your large appliances.",
      },
    ]);
  });
});
