import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The monologue switch (EMS_ADVISORY_MONOLOGUE) is read once at
// startup: the default import carries the switch off, and a
// query-string import re-evaluates the adapter with the environment
// set, giving a switched-on instance of the same module.
// The server import chain loads dotenv (the developer's .env), and
// dotenv never overrides a variable already in the environment -
// so pinning the switch to off here keeps the default-import
// assertions hermetic on a machine whose .env enables the monologue.
process.env.EMS_ADVISORY_MONOLOGUE = "";
const { generateInsightMonologue, getMistralBudget } = await import(
  "../server/ai.mjs"
);

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

describe("serveAdvisoryMonologue: snapshot validation of stored narratives", () => {
  it("stores the generation-time facts snapshot alongside each narrative at refresh", async () => {
    const stub = countingStub(m1.stub.narratives);
    const record = await generateInsightMonologue(m1Request(), null, stub);
    for (const key of ["today", "tomorrow", "fri", "sun"]) {
      const entry = record.sections[key];
      assert.equal(typeof entry.facts_hash, "string");
      assert.ok(
        entry.facts !== null && typeof entry.facts === "object",
        `section ${key} must carry its facts snapshot`
      );
    }
    // The snapshot is the formatted fact set the narrative was written
    // from: the drifting display figures as they were at generation.
    assert.equal(record.sections.today.facts.battery_level, "72%");
    assert.equal(record.sections.today.facts.solar_today, "8.18 kWh");
    assert.equal(record.sections.today.facts.appliance_saving, "€0.12");
  });

  it("serves the stored narrative when the live facts have drifted since generation (regression)", async () => {
    const stub = countingStub(m1.stub.narratives);
    const record = await generateInsightMonologue(m1Request(), null, stub);
    // Drift the live facts the TODAY narrative quotes: the battery level
    // and the solar actual move continuously during the day, so a serve
    // minutes later sees different live figures than at generation time.
    const drifted = m1Request();
    drifted.facts.battery.socPct = 65;
    drifted.facts.solarToday.actualKwh = 8.9;
    const served = await adapter.serveAdvisoryMonologue(
      drifted,
      record.sections
    );
    const today = served.find((s) => s.label === "TODAY");
    // The stored narrative is validated against its own snapshot, so it
    // is served instead of downgrading to the fallback.
    assert.ok(today.narrative !== null);
    assert.ok(today.narrative.includes(m1.stub.narratives.today));
    // The payload itself still reflects the live facts at serve time.
    assert.equal(today.facts.battery_level, "65%");
    assert.equal(today.facts.solar_today, "8.9 kWh");
    assert.equal(today.facts.nowIso, m1.now);
    assert.ok(Array.isArray(today.fallback_sentences));
    assert.ok(today.fallback_sentences.length > 0);
  });

  it("still rejects at serve time a stored narrative with a figure absent from its own snapshot", async () => {
    const stub = countingStub(m1.stub.narratives);
    const record = await generateInsightMonologue(m1Request(), null, stub);
    const stored = structuredClone(record.sections);
    stored.today.narrative = `${m1.stub.narratives.today} On top of that, this saves €9.99.`;
    const served = await adapter.serveAdvisoryMonologue(m1Request(), stored);
    const today = served.find((s) => s.label === "TODAY");
    // The figure guards are not weakened: €9.99 matches no served amount
    // of the section's own snapshot, so the section falls back.
    assert.equal(today.narrative, null);
    assert.ok(today.fallback_sentences.length > 0);
  });

  it("rejects a figure that exists only in the drifted live facts, not in the snapshot", async () => {
    const stub = countingStub(m1.stub.narratives);
    const record = await generateInsightMonologue(m1Request(), null, stub);
    const stored = structuredClone(record.sections);
    // 65% is a member of the drifted live fact set but of no snapshot
    // fact, so validating against live facts would wrongly accept it.
    stored.today.narrative = "Your battery sits at 65% right now.";
    const drifted = m1Request();
    drifted.facts.battery.socPct = 65;
    const served = await adapter.serveAdvisoryMonologue(drifted, stored);
    const today = served.find((s) => s.label === "TODAY");
    assert.equal(today.narrative, null);
    assert.ok(today.fallback_sentences.length > 0);
  });

  it("still rejects at serve time a banned tomorrow-price mention when the snapshot says unpublished", async () => {
    const stub = countingStub(m1.stub.narratives);
    const record = await generateInsightMonologue(m1Request(), null, stub);
    const stored = structuredClone(record.sections);
    stored.tomorrow.narrative =
      "Tomorrow's prices will average €0.30 per kWh, so plan the big runs for then.";
    const served = await adapter.serveAdvisoryMonologue(m1Request(), stored);
    const tomorrow = served.find((s) => s.label === "TOMORROW");
    // The snapshot carries prices_published false, so the tomorrow-price
    // guard rejects the mention and the section falls back.
    assert.equal(tomorrow.narrative, null);
    assert.ok(tomorrow.fallback_sentences.length > 0);
  });

  it("serves the fallback for a legacy stored entry without a facts snapshot", async () => {
    const legacy = {
      today: { facts_hash: "0badf00d", narrative: m1.stub.narratives.today },
    };
    const served = await adapter.serveAdvisoryMonologue(m1Request(), legacy);
    const today = served.find((s) => s.label === "TODAY");
    // A legacy narrative is never validated against live facts: the
    // section serves its deterministic fallback and a valid payload.
    assert.equal(today.narrative, null);
    assert.ok(Array.isArray(today.fallback_sentences));
    assert.ok(today.fallback_sentences.length > 0);
    assert.equal(today.facts.nowIso, m1.now);
    for (const section of served) {
      assert.ok("label" in section);
      assert.ok("narrative" in section);
      assert.ok("fallback_sentences" in section);
      assert.ok("facts" in section);
    }
  });
});
