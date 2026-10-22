import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateInsightMonologue, getMistralBudget } from "../server/ai.mjs";

// The monologue switch (EMS_ADVISORY_MONOLOGUE) is read once at
// startup: the default import carries the switch off, and a
// query-string import re-evaluates the adapter with the environment
// set, giving a switched-on instance of the same module.

const adapter = await import("../server/advisory-adapter.mjs");

async function switchedOnAdapter() {
  process.env.EMS_ADVISORY_MONOLOGUE = "1";
  try {
    return await import("../server/advisory-adapter.mjs?switch=on");
  } finally {
    delete process.env.EMS_ADVISORY_MONOLOGUE;
  }
}

// The M1 action-day fixture: the same fixture the scenario runner
// exercises, with stub narratives keyed by monologue section.
const here = dirname(fileURLToPath(import.meta.url));
const m1 = JSON.parse(
  readFileSync(join(here, "../server/advisory/fixtures/M1.json"), "utf8")
);
const m1Request = () => ({ facts: structuredClone(m1.facts), nowIso: m1.now });

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

async function captureLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  try {
    return { lines, value: await fn() };
  } finally {
    console.log = original;
  }
}

function insightWithMonologue(sections) {
  return {
    narrative: { warning: null, contextNote: null },
    generatedAt: "2026-10-20T15:30:00.000Z",
    asOf: "2026-10-20T15:28:00.000Z",
    state: "fresh",
    stale: false,
    error: null,
    monologue: { sections },
  };
}

describe("the monologue switch", () => {
  it("is off by default", () => {
    assert.equal(adapter.ADVISORY_MONOLOGUE_ENABLED, false);
  });

  it("reads on once at startup via EMS_ADVISORY_MONOLOGUE", async () => {
    const on = await switchedOnAdapter();
    assert.equal(on.ADVISORY_MONOLOGUE_ENABLED, true);
  });
});

describe("the monologue refresh (generateInsightMonologue)", () => {
  it("generates model-written narratives at refresh and stores them in the insight record", async () => {
    const stub = countingStub(m1.stub.narratives);
    const record = await generateInsightMonologue(m1Request(), null, stub);
    // One model call per section: today, tomorrow, fri, sun.
    assert.equal(stub.calls, 4);
    const sections = record.sections;
    for (const key of ["today", "tomorrow", "fri", "sun"]) {
      assert.equal(typeof sections[key].facts_hash, "string");
      assert.ok(sections[key].narrative.includes(m1.stub.narratives[key]));
    }
  });

  it("makes zero model calls on a second refresh with unchanged section facts", async () => {
    const stub = countingStub(m1.stub.narratives);
    const first = await generateInsightMonologue(m1Request(), null, stub);
    const callsAfterFirst = stub.calls;
    const second = await generateInsightMonologue(
      m1Request(),
      first.sections,
      stub
    );
    assert.equal(stub.calls, callsAfterFirst);
    assert.deepEqual(second.sections, first.sections);
  });

  it("regenerates only the section whose composition facts changed", async () => {
    const stub = countingStub(m1.stub.narratives);
    const first = await generateInsightMonologue(m1Request(), null, stub);
    const callsAfterFirst = stub.calls;
    const request = m1Request();
    request.facts.tomorrow.solarScore = 18; // not named in the narrative
    const second = await generateInsightMonologue(
      request,
      first.sections,
      stub
    );
    assert.equal(stub.calls - callsAfterFirst, 1);
    assert.notEqual(
      second.sections.tomorrow.facts_hash,
      first.sections.tomorrow.facts_hash
    );
    assert.ok(
      second.sections.tomorrow.narrative.includes(
        m1.stub.narratives.tomorrow
      )
    );
    for (const key of ["today", "fri", "sun"]) {
      assert.deepEqual(second.sections[key], first.sections[key]);
    }
  });

  it("stores fallback sentences for a section that fails validation twice, without failing the refresh", async () => {
    const fabricated = { ...m1.stub.narratives, today: "This saves €9.99." };
    const stub = countingStub(fabricated);
    const { lines, value } = await captureLogs(() =>
      generateInsightMonologue(m1Request(), null, stub)
    );
    // The failing section costs its two attempts; the others one each.
    assert.equal(stub.calls, 5);
    assert.equal(value.sections.today.narrative, null);
    assert.ok(
      value.sections.tomorrow.narrative.includes(m1.stub.narratives.tomorrow)
    );
    assert.ok(
      lines.some(
        (line) =>
          line.includes("monologue TODAY") &&
          line.includes("fallback") &&
          line.includes("figure rejections 2")
      )
    );
    assert.ok(
      lines.some(
        (line) =>
          line.includes("monologue TOMORROW") &&
          line.includes("new-facts") &&
          line.includes("figure rejections 0")
      )
    );
    // Each rejected attempt logs one line with its readable rejection
    // reasons, so the fallback is diagnosable from the log.
    assert.ok(
      lines.some(
        (line) =>
          line.startsWith("monologue TODAY attempt 1 rejected:") &&
          line.includes("€9.99") &&
          line.includes("matches no served amount")
      )
    );
    assert.ok(
      lines.some((line) =>
        line.startsWith("monologue TODAY attempt 2 rejected:")
      )
    );
  });

  it("counts monologue model calls against the shared budget", async () => {
    const before = getMistralBudget().calls_today;
    const stub = countingStub(m1.stub.narratives);
    await generateInsightMonologue(m1Request(), null, stub);
    assert.equal(getMistralBudget().calls_today - before, stub.calls);
  });
});

describe("serveSummaryAdvisory: the summary payload's advisory fields", () => {
  it("serves no monologue field while the switch is off", async () => {
    const stub = countingStub(m1.stub.narratives);
    const record = await generateInsightMonologue(m1Request(), null, stub);
    const insight = insightWithMonologue(record.sections);
    // Even with a stored monologue in the record, the off payload
    // carries no monologue field.
    const fields = await adapter.serveSummaryAdvisory(m1Request(), insight);
    assert.ok(!("monologue" in fields));
    assert.deepEqual(fields, {
      insight: adapter.serveAdvisoryCard(m1Request(), insight),
    });
  });

  it("serves the stored model-written monologue through the switch seam", async () => {
    const on = await switchedOnAdapter();
    const stub = countingStub(m1.stub.narratives);
    const record = await generateInsightMonologue(m1Request(), null, stub);
    const fields = await on.serveSummaryAdvisory(
      m1Request(),
      insightWithMonologue(record.sections)
    );
    assert.ok("insight" in fields);
    assert.ok(Array.isArray(fields.monologue));
    assert.ok(fields.monologue.length > 0);
    for (const section of fields.monologue) {
      assert.ok("label" in section);
      assert.ok("narrative" in section);
      assert.ok("fallback_sentences" in section);
      assert.ok("facts" in section);
      assert.equal(section.facts.nowIso, m1.now);
      assert.equal(typeof section.narrative, "string");
    }
    const today = fields.monologue.find((s) => s.label === "TODAY");
    assert.ok(today.narrative.includes(m1.stub.narratives.today));
  });

  it("serves the deterministic fallback sentences without a stored record", async () => {
    const on = await switchedOnAdapter();
    const fields = await on.serveSummaryAdvisory(m1Request(), {
      narrative: null,
      generatedAt: null,
      asOf: null,
      state: "error",
      stale: false,
      error: null,
    });
    assert.ok(Array.isArray(fields.monologue));
    for (const section of fields.monologue) {
      assert.equal(section.narrative, null);
      assert.ok(Array.isArray(section.fallback_sentences));
      assert.ok(section.fallback_sentences.length > 0);
      assert.equal(section.facts.nowIso, m1.now);
    }
  });
});
