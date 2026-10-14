import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { savingMatchesCandidate } from "../server/ai.mjs";

// The saving guard's boundaries (C3 rule a): zero is legitimate in
// the honest no-opportunity cases; every other claim must match a
// candidate's exact value.

const candidate = (saving_eur, below_threshold = false) => ({
  label: "Dishwasher energy",
  load_kwh: 1.07,
  window: "13:00-16:00 today",
  saving_eur,
  below_threshold,
  basis: "your dishwasher used 1.07 kWh so far today",
});

describe("savingMatchesCandidate", () => {
  it("accepts zero with no candidates at all", () => {
    assert.equal(savingMatchesCandidate(0, []), true);
  });

  it("accepts zero when every candidate is below threshold", () => {
    assert.equal(
      savingMatchesCandidate(0, [
        candidate(0.03, true),
        candidate(0.02, true),
      ]),
      true
    );
  });

  it("accepts the largest below-threshold amount copied verbatim", () => {
    assert.equal(
      savingMatchesCandidate(0.03, [candidate(0.03, true), candidate(0.02, true)]),
      true
    );
  });

  it("rejects zero while an above-threshold candidate exists", () => {
    assert.equal(
      savingMatchesCandidate(0, [candidate(0.16, false)]),
      false
    );
  });

  it("accepts a saving that matches a candidate exactly", () => {
    assert.equal(savingMatchesCandidate(0.16, [candidate(0.16, false)]), true);
  });

  it("rejects a fabricated saving that matches no candidate", () => {
    assert.equal(savingMatchesCandidate(0.15, [candidate(0.16, false)]), false);
  });
});
