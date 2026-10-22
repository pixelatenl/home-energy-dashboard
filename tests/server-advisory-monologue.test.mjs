import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const m1Request = { facts: m1.facts, nowIso: m1.now };
const insight = {
  narrative: { warning: null, contextNote: null },
  generatedAt: "2026-10-20T15:30:00.000Z",
  asOf: "2026-10-20T15:28:00.000Z",
  state: "fresh",
  stale: false,
  error: null,
};

describe("the monologue switch", () => {
  it("is off by default", () => {
    assert.equal(adapter.ADVISORY_MONOLOGUE_ENABLED, false);
  });

  it("reads on once at startup via EMS_ADVISORY_MONOLOGUE", async () => {
    const on = await switchedOnAdapter();
    assert.equal(on.ADVISORY_MONOLOGUE_ENABLED, true);
  });
});

describe("serveSummaryAdvisory: the summary payload's advisory fields", () => {
  it("serves no monologue field while the switch is off", async () => {
    const fields = await adapter.serveSummaryAdvisory(m1Request, insight);
    assert.ok(!("monologue" in fields));
    assert.deepEqual(fields, {
      insight: adapter.serveAdvisoryCard(m1Request, insight),
    });
  });

  it("adds the monologue field alongside the insight while the switch is on, sections carrying the fixture shapes", async () => {
    const on = await switchedOnAdapter();
    const fields = await on.serveSummaryAdvisory(
      m1Request,
      insight,
      async () => m1.stub
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
    }
    // The fixture's narratives validate figure-verbatim, so every
    // section serves its model narrative rather than its fallbacks.
    assert.ok(
      fields.monologue.every((section) => typeof section.narrative === "string")
    );
    assert.ok(
      fields.monologue.every(
        (section) => Array.isArray(section.fallback_sentences)
      )
    );
  });
});

describe("serveAdvisoryMonologue: the monologue payload", () => {
  it("serves the deterministic fallback sentences without a model", async () => {
    const payload = await adapter.serveAdvisoryMonologue(m1Request);
    assert.ok(payload.length > 0);
    for (const section of payload) {
      assert.equal(section.narrative, null);
      assert.ok(Array.isArray(section.fallback_sentences));
      assert.ok(section.fallback_sentences.length > 0);
      assert.equal(section.facts.nowIso, m1.now);
    }
  });
});
