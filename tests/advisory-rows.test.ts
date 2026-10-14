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
    // the rows must follow the calendar, not the prominence.
    const content = buildAdvisoryContent(makeInsight());
    assert.deepEqual(
      content.rows.map((row) => row.chip),
      ["Today", "Tomorrow", "Fri", "Sun"],
    );
  });

  it("keeps the best-day designation attached to its own day", () => {
    const content = buildAdvisoryContent(makeInsight());
    const sunday = content.rows.find((row) => row.chip === "Sun");
    assert.ok(sunday);
    assert.equal(
      sunday.sentence,
      "Sunday brings the week's best solar: score 29, 12.55 kWh expected",
    );
    const friday = content.rows.find((row) => row.chip === "Fri");
    assert.ok(friday);
    assert.match(friday.sentence, /^Friday brings rain/);
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
    const beyond = content.rows
      .map((row) => row.chip)
      .filter((chip) => chip !== "Today" && chip !== "Tomorrow");
    assert.deepEqual(beyond, ["Sat", "Sun"]);
  });

  it("suppresses the guidance row when the action carries its window", () => {
    const content = buildAdvisoryContent(makeInsight());
    assert.equal(
      content.rows.filter((row) => row.chip === "Today").length,
      1,
    );
    const action = content.rows[0];
    assert.equal(action.sentence, "Run your large appliances between 13:00 and 16:00 for the best price left today");
    assert.equal(action.valueChip, "\u20AC 0.11 potential savings");
  });
});
