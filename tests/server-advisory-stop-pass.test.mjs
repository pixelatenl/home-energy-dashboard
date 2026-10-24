import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The stop pass (24 October 2026): the legacy summary card model call is
// retired. This file pins its own ai.mjs instance with the monologue
// switch on and a test API key, and a fetch guard that fails loudly on
// any network attempt - a leftover legacy card path would reach
// globalThis.fetch through callMistral and be caught here; the
// null-stub never does. The monologue seam receives its own counting
// stub through options.monologueStub and never touches fetch.
process.env.EMS_ADVISORY_MONOLOGUE = "1";
process.env.MISTRAL_API_KEY = "test-key";

const { getSummaryInsight, getMistralBudget } = await import("../server/ai.mjs");

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("no network in tests");
};

// The M1 action-day fixture: the same fixture the scenario runner
// exercises, whose stub narratives pass figure-verbatim validation.
const here = dirname(fileURLToPath(import.meta.url));
const m1 = JSON.parse(
  readFileSync(join(here, "../server/advisory/fixtures/M1.json"), "utf8")
);

// The advisory request in the shape prepareAdvisoryRequest returns; the
// tests supply facts and nowIso directly, the style brief is unused by
// the retired card path.
function requestFixture() {
  return { facts: structuredClone(m1.facts), nowIso: m1.now };
}

function snapshot(signature) {
  return {
    summary: null,
    weatherDaily: null,
    priceParts: null,
    extras: {},
    signature,
    asOf: "2026-10-20T15:28:00.000Z",
  };
}

// A counting model seam in the shape the monologue pipeline calls:
// one prompt in, { narratives } out.
function countingStub(narratives) {
  const stub = async () => {
    stub.calls += 1;
    return { narratives };
  };
  stub.calls = 0;
  return stub;
}

describe("the stop pass: the legacy card model call is retired", () => {
  it("serves the empty shape with an exhausted budget: state error, no stale field", async () => {
    process.env.MISTRAL_DAILY_CALL_LIMIT = "0";
    try {
      const result = await getSummaryInsight(snapshot("stop-pass-empty"), {
        advisory: requestFixture(),
        monologueStub: countingStub(m1.stub.narratives),
      });
      assert.equal(result.state, "error");
      assert.equal(result.narrative, null);
      assert.equal(result.error, "daily_limit_reached");
      assert.ok(!("stale" in result));
    } finally {
      delete process.env.MISTRAL_DAILY_CALL_LIMIT;
    }
  });

  it("a signature-change refresh with the switch on performs zero legacy card model calls while the monologue sections still generate through the seam", async () => {
    const stub = countingStub(m1.stub.narratives);
    const result = await getSummaryInsight(snapshot("stop-pass-1"), {
      force: true,
      advisory: requestFixture(),
      monologueStub: stub,
    });
    // The null-stub never reaches callMistral and never draws budget:
    // any model call from the card path would have hit the fetch guard.
    assert.equal(fetchCalls, 0);
    // The monologue sections still generate through the seam: one model
    // call per section (today, tomorrow, fri, sun).
    assert.equal(stub.calls, 4);
    for (const key of ["today", "tomorrow", "fri", "sun"]) {
      assert.ok(
        result.monologue.sections[key].narrative.includes(
          m1.stub.narratives[key]
        )
      );
    }
  });

  it("the served insight carries state fresh/reasoning, no stale field, null narrative fields and a populated monologue", async () => {
    const stub = countingStub(m1.stub.narratives);
    // fresh: a forced refresh lands the new insight.
    const fresh = await getSummaryInsight(snapshot("stop-pass-2"), {
      force: true,
      advisory: requestFixture(),
      monologueStub: stub,
    });
    assert.equal(fresh.state, "fresh");
    assert.ok(!("stale" in fresh));
    assert.deepEqual(fresh.narrative, { warning: null, contextNote: null });
    assert.ok("monologue" in fresh);
    assert.ok(Object.keys(fresh.monologue.sections).length > 0);
    for (const key of ["today", "tomorrow", "fri", "sun"]) {
      assert.ok(typeof fresh.monologue.sections[key].narrative === "string");
    }

    // reasoning: a signature change warms up in the background and the
    // call answers immediately with the cached insight.
    const warm = await getSummaryInsight(snapshot("stop-pass-2-changed"), {
      advisory: requestFixture(),
      monologueStub: stub,
      background: true,
    });
    assert.equal(warm.state, "reasoning");
    assert.ok(!("stale" in warm));
    assert.deepEqual(warm.narrative, { warning: null, contextNote: null });
  });

  it("budget accounting for a refresh equals the monologue section calls only", async () => {
    const stub = countingStub(m1.stub.narratives);
    const before = getMistralBudget().calls_today;
    const result = await getSummaryInsight(snapshot("stop-pass-budget"), {
      force: true,
      advisory: requestFixture(),
      monologueStub: stub,
    });
    assert.equal(getMistralBudget().calls_today - before, stub.calls);
    assert.equal(result.state, "fresh");
  });
});
