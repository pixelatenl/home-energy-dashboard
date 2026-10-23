// Scenario runner for the Your Advisor core (contract v2.0) and the
// advisory monologue. Reads fixtures/*.json - each carrying { name, facts,
// now, stub } where stub is the model output ({ warning, contextNote }
// and optionally { narratives } keyed by monologue section) - and runs the
// same orchestration generateAdvisoryCard uses: build sections, project the
// model context, one model call, validation against the received sections,
// at most one regeneration attempt, then serve without any failing
// sentence. Each fixture also runs the monologue pipeline: per section,
// one model call with the section prompt, figure-verbatim validation
// against that section's own fact set, at most one retry, then the
// deterministic fallback sentences. Each composed card payload and each
// monologue payload is printed as formatted JSON with the verdicts they
// were served under; the sentence count per monologue section is logged
// against its advisory budget. The runner also refuses to print a payload
// that carries a transport field: those are owned by the summary insight
// path (contract section 5) and must never be composed. Fixtures may
// carry expected_narrative_verdicts ({ [sectionKey]: "accepted" |
// "rejected" }); the runner asserts them.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSections,
  buildAdvisoryModelContext,
  attemptModel,
  sanitizeOutput,
  composeAdvisoryCard,
} from "./advisory-core.mjs";
import { generateMonologue } from "./advisory-monologue.mjs";
import { auditServedText, auditMonologueText } from "./served-text-audit.mjs";

// Transport fields owned by the summary insight path; the composer never
// touches them (contract section 5 field ownership).
const TRANSPORT_FIELDS = ["generated_at", "insight_as_of", "state", "stale", "error"];

async function runFixture(fixture) {
  const { name, facts, now, stub } = fixture;
  const sections = buildSections(facts, now);
  const context = buildAdvisoryModelContext({
    now_local: now,
    today_date: now.slice(0, 10),
    sections,
  });
  // The modelStub is a parameter, never a network call.
  const modelStub = async () => stub;

  let attempt = await attemptModel(context, modelStub);
  if (!attempt.verdicts.ok) {
    // One regeneration attempt on validation failure.
    attempt = await attemptModel(context, modelStub);
  }
  const served = sanitizeOutput(attempt.output, attempt.verdicts);
  const card = composeAdvisoryCard(sections, served, { ...facts, nowIso: now });

  for (const field of TRANSPORT_FIELDS) {
    if (field in card) {
      throw new Error(`${name}: transport field "${field}" must never be composed`);
    }
  }

  // The monologue: per-section narrative, figure-verbatim validation
  // against the section's own fact set, one retry, then fallbacks.
  const monologue = await generateMonologue(sections, facts, now, modelStub);

  // Data-driven expected verdicts (M fixtures): accepted or rejected per
  // monologue section, asserted through the standard runner only.
  for (const [key, expected] of Object.entries(
    fixture.expected_narrative_verdicts ?? {}
  )) {
    const entry = monologue.sections.find((s) => s.key === key);
    if (entry === undefined) {
      throw new Error(`${name}: expected a monologue section "${key}", none was built`);
    }
    const actual = entry.offered ? (entry.ok ? "accepted" : "rejected") : "absent";
    if (actual !== expected) {
      throw new Error(
        `${name}: monologue section "${key}" expected ${expected}, got ${actual}` +
          (entry.reasons.length > 0 ? ` (reasons: ${entry.reasons.join(" | ")})` : "")
      );
    }
  }

  return { name, verdicts: attempt.verdicts, served, card, monologue };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixtureDir = join(here, "fixtures");
  const files = readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let printed = 0;
  let auditFailures = 0;
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(fixtureDir, file), "utf8"));
    const { name, verdicts, served, card, monologue } = await runFixture(fixture);
    console.log(`\n=== ${name} (${file}) ===`);
    console.log(
      `verdicts: ok=${String(verdicts.ok)}` +
        (verdicts.reasons.length > 0
          ? ` reasons=[${verdicts.reasons.join(" | ")}]`
          : "")
    );
    if (!verdicts.ok) {
      console.log(
        `served without the failing sentences: warning=${JSON.stringify(served.warning)}, contextNote=${JSON.stringify(served.contextNote)}`
      );
    }

    // Monologue verdicts and the advisory sentence budgets (logged, never
    // asserted): TODAY 5 on an action day, 3 on a quiet day, 4 in recap
    // mode; TOMORROW at most 3; days beyond tomorrow 1 sentence.
    for (const section of monologue.sections) {
      const state = section.offered
        ? section.ok
          ? "accepted"
          : `rejected: [${section.reasons.join(" | ")}]`
        : "no narrative offered";
      console.log(
        `monologue ${section.label}: ${state}` +
          (section.retried ? " (after one retry)" : "") +
          `, served ${section.sentenceCount} sentence(s) (budget ${section.budget}, ${section.mode})`
      );
    }
    console.log(JSON.stringify(monologue.payload, null, 2));
    console.log(JSON.stringify(card, null, 2));

    // Served-text audit (contract section 9): every composed sentence in
    // every payload, every run - the card and the monologue prose. Failures
    // print with reasons; the run fails on any.
    for (const [auditName, audit] of [
      ["card", auditServedText(card)],
      ["monologue", auditMonologueText(monologue.payload)],
    ]) {
      if (!audit.ok) {
        auditFailures += audit.failures.length;
        console.log(`${auditName} text audit: FAIL`);
        for (const failure of audit.failures) {
          console.log(
            `  - ${failure.path}: ${failure.rule}: ${JSON.stringify(failure.text)}`
          );
        }
      }
    }
    printed += 1;
  }
  if (printed !== files.length) {
    throw new Error(`expected ${files.length} scenario payloads, printed ${printed}`);
  }
  console.log(`\n${printed} scenario payloads printed.`);
  if (auditFailures > 0) {
    throw new Error(`served-text audit failed on ${auditFailures} sentence(s)`);
  }
  console.log("text audit: all sentences pass.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
