import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solarScoreLabel, todaySolarScore } from "../src/lib/solarScore.ts";

// The Solar today card's score chip: today's solar score read from
// the daily weather response (fetchWeatherDaily(1)). The chip shows
// when today's row carries a score and hides when it does not; the
// score is never fabricated.

const DATE_KEY = "2026-10-20";

describe("todaySolarScore: today's entry of the daily forecast", () => {
  it("reads the score of the entry matching today's date key", () => {
    const days = [
      { date: "2026-10-19", solar_score: 30 },
      { date: DATE_KEY, solar_score: 72 },
      { date: "2026-10-21", solar_score: 80 },
    ];
    assert.equal(todaySolarScore(days, DATE_KEY), 72);
  });

  it("returns null when the response has no entry for today", () => {
    assert.equal(
      todaySolarScore([{ date: "2026-10-19", solar_score: 30 }], DATE_KEY),
      null,
    );
    assert.equal(todaySolarScore([], DATE_KEY), null);
  });

  it("returns null when today's entry carries no usable score", () => {
    assert.equal(todaySolarScore([{ date: DATE_KEY }], DATE_KEY), null);
    assert.equal(
      todaySolarScore([{ date: DATE_KEY, solar_score: null }], DATE_KEY),
      null,
    );
    assert.equal(
      todaySolarScore(
        [{ date: DATE_KEY, solar_score: Number.NaN }],
        DATE_KEY,
      ),
      null,
    );
  });
});

describe("solarScoreLabel: the chip's label", () => {
  it("reads Solar score {n}/100, rounded to a whole number", () => {
    assert.equal(solarScoreLabel(72), "Solar score 72/100");
    assert.equal(solarScoreLabel(72.6), "Solar score 73/100");
  });

  it("returns null without a score, so the chip hides", () => {
    assert.equal(solarScoreLabel(null), null);
  });
});
