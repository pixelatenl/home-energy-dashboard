// Scenario runner for the AI Advisory core (contract v2.0).
// Reads fixtures/*.json - each carrying { name, facts, now, stub } where
// stub is the model narrative ({ warning, contextNote }) - and runs the same
// orchestration generateAdvisoryCard uses: build sections, project the model
// context, one model call, validation against the received sections, at most
// one regeneration attempt, then serve without any failing sentence. Each
// composed card payload is printed as formatted JSON with the verdicts it was
// served under. The runner also refuses to print a payload that carries a
// transport field: those are owned by the summary insight path (contract
// section 5) and must never be composed.

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
import { auditServedText } from "./served-text-audit.mjs";

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
  return { name, verdicts: attempt.verdicts, served, card };
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
    const { name, verdicts, served, card } = await runFixture(fixture);
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
    console.log(JSON.stringify(card, null, 2));

    // Served-text audit (contract section 9): every composed sentence in
    // every payload, every run. Failures print with reasons; the run fails
    // on any.
    const audit = auditServedText(card);
    if (!audit.ok) {
      auditFailures += audit.failures.length;
      console.log("text audit: FAIL");
      for (const failure of audit.failures) {
        console.log(
          `  - ${failure.path}: ${failure.rule}: ${JSON.stringify(failure.text)}`
        );
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
