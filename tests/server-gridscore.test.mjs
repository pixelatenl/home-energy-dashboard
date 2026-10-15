import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGridScore,
  getGridScore,
  gridScoreState,
} from "../server/gridscore.mjs";

// Fixed "now": 14 October 2026, 17:30 local Amsterdam (CEST, +02:00),
// so every hour key and label is deterministic.
const NOW = new Date("2026-10-14T17:30:00+02:00");
const TODAY = "2026-10-14";
const TOMORROW = "2026-10-15";

// Quarter-hour forecast blocks, the shape of the Zonneplan tariff
// entity's forecast attribute. Each hour spec expands into
// `quarters` 15-minute blocks of one permille value.
function blocks(hourSpecs) {
  const out = [];
  const pad = (value) => String(value).padStart(2, "0");
  for (const spec of hourSpecs) {
    for (let q = 0; q < (spec.quarters ?? 4); q += 1) {
      const startMinute = q * 15;
      const endMinute = startMinute + 15;
      out.push({
        start_date: `${spec.date}T${pad(spec.hour)}:${pad(startMinute)}:00+02:00`,
        end_date: `${spec.date}T${pad(spec.hour)}:${pad(endMinute)}:00+02:00`,
        sustainability_score: { permille: spec.permille },
      });
    }
  }
  return out;
}

function tariffWith(forecast) {
  return { attributes: { forecast } };
}

describe("gridScoreState thresholds (our interpretation)", () => {
  it("is green at 75 and above, yellow from 40, grey below", () => {
    assert.equal(gridScoreState(null), null);
    assert.equal(gridScoreState(100), "green");
    assert.equal(gridScoreState(75), "green");
    assert.equal(gridScoreState(74.9), "yellow");
    assert.equal(gridScoreState(40), "yellow");
    assert.equal(gridScoreState(39.9), "grey");
    assert.equal(gridScoreState(0), "grey");
  });
});

describe("buildGridScore: permille conversion and the curve", () => {
  it("reads the current block, averages hours and caps at 100", () => {
    const score = buildGridScore(
      tariffWith(
        blocks([
          { date: TODAY, hour: 17, permille: 518 },
          { date: TODAY, hour: 18, permille: 294 },
          { date: TODAY, hour: 19, permille: 1000 },
          { date: TOMORROW, hour: 8, permille: 900 },
        ])
      ),
      null,
      null,
      NOW
    );
    assert.equal(score.current, 51.8);
    assert.equal(score.raw_current_permille, 518);
    assert.equal(score.current_source, "forecast");
    assert.equal(score.state, "yellow");
    assert.deepEqual(score.curve, [
      { hour: `${TODAY}T17`, score: 51.8 },
      { hour: `${TODAY}T18`, score: 29.4 },
      { hour: `${TODAY}T19`, score: 100 },
      { hour: `${TOMORROW}T08`, score: 90 },
    ]);
    assert.equal(score.horizon_hours, 4);
    assert.equal(score.tomorrow_available, true);
  });

  it("caps a surplus ratio at 100 but keeps the raw permille", () => {
    const score = buildGridScore(
      tariffWith(blocks([{ date: TODAY, hour: 17, permille: 1200 }])),
      null,
      null,
      NOW
    );
    assert.equal(score.current, 100);
    assert.equal(score.raw_current_permille, 1200);
    assert.deepEqual(score.curve, [{ hour: `${TODAY}T17`, score: 100 }]);
    assert.equal(score.state, "green");
  });

  it("drops past blocks and anything beyond tomorrow", () => {
    const score = buildGridScore(
      tariffWith(
        blocks([
          { date: "2026-10-13", hour: 17, permille: 400 },
          { date: TODAY, hour: 16, permille: 400 },
          { date: TODAY, hour: 17, permille: 518 },
          { date: "2026-10-16", hour: 8, permille: 400 },
        ])
      ),
      null,
      null,
      NOW
    );
    assert.deepEqual(score.curve, [{ hour: `${TODAY}T17`, score: 51.8 }]);
    assert.equal(score.horizon_hours, 1);
    assert.equal(score.tomorrow_available, false);
  });

  it("gates tomorrow on the publication status entity, like tomorrow prices", () => {
    const base = tariffWith(blocks([{ date: TODAY, hour: 17, permille: 500 }]));
    const without = buildGridScore(base, null, null, NOW);
    assert.equal(without.tomorrow_available, false);
    const withStatus = buildGridScore(
      base,
      null,
      { state: "available" },
      NOW
    );
    assert.equal(withStatus.tomorrow_available, true);
  });
});

describe("buildGridScore: the sub-caption fact", () => {
  it("mentions the largest upcoming drop with its hour", () => {
    const score = buildGridScore(
      tariffWith(
        blocks([
          { date: TODAY, hour: 17, permille: 800 },
          { date: TODAY, hour: 18, permille: 700 },
          { date: TODAY, hour: 19, permille: 300 },
        ])
      ),
      null,
      null,
      NOW
    );
    assert.equal(score.sub, "now, falls to 30 at 19:00");
  });

  it("qualifies a rise that lands tomorrow", () => {
    const score = buildGridScore(
      tariffWith(
        blocks([
          { date: TODAY, hour: 17, permille: 518 },
          { date: TODAY, hour: 18, permille: 294 },
          { date: TODAY, hour: 19, permille: 400 },
          { date: TOMORROW, hour: 8, permille: 900 },
        ])
      ),
      null,
      null,
      NOW
    );
    assert.equal(score.sub, "now, rises to 90 at 08:00 tomorrow");
  });

  it("says flat all day when the range stays under 15 points", () => {
    const score = buildGridScore(
      tariffWith(
        blocks([
          { date: TODAY, hour: 17, permille: 500 },
          { date: TODAY, hour: 18, permille: 510 },
          { date: TODAY, hour: 19, permille: 490 },
        ])
      ),
      null,
      null,
      NOW
    );
    assert.equal(score.sub, "flat all day");
  });

  it("predicts nothing when no single swing reaches 15 points", () => {
    const score = buildGridScore(
      tariffWith(
        blocks([
          { date: TODAY, hour: 17, permille: 500 },
          { date: TODAY, hour: 18, permille: 580 },
          { date: TODAY, hour: 19, permille: 420 },
        ])
      ),
      null,
      null,
      NOW
    );
    // Range 16, but the largest swing against the current 50 is 8.
    assert.equal(score.sub, null);
  });

  it("predicts nothing without a horizon", () => {
    const score = buildGridScore(
      tariffWith(blocks([{ date: TODAY, hour: 17, permille: 500 }])),
      null,
      null,
      NOW
    );
    assert.equal(score.sub, null);
  });
});

describe("buildGridScore: fail-soft without the forecast", () => {
  it("falls back to the capped sensor value alone, no curve, no zeros", () => {
    const score = buildGridScore(
      null,
      { state: "88.4" },
      { state: "available" },
      NOW
    );
    assert.equal(score.current, 88.4);
    assert.equal(score.state, "green");
    assert.deepEqual(score.curve, []);
    assert.equal(score.horizon_hours, 0);
    assert.equal(score.tomorrow_available, false);
    assert.equal(score.sub, null);
    assert.equal(score.current_source, "sensor");
    assert.equal(score.raw_current_permille, null);
  });

  it("caps the sensor fallback at 100", () => {
    const score = buildGridScore(null, { state: "140" }, null, NOW);
    assert.equal(score.current, 100);
  });

  it("reports nothing when both sources are gone", () => {
    const score = buildGridScore(null, null, null, NOW);
    assert.equal(score.current, null);
    assert.equal(score.state, null);
    assert.deepEqual(score.curve, []);
  });
});

describe("getGridScore: the summary payload shape", () => {
  it("strips the debug-only fields (HA unreachable in tests)", async () => {
    const score = await getGridScore();
    assert.equal(score.current, null);
    assert.deepEqual(Object.keys(score).sort(), [
      "current",
      "curve",
      "horizon_hours",
      "state",
      "sub",
      "tomorrow_available",
    ]);
  });
});
