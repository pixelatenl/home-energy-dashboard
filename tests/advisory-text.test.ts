import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  humanEur,
  humanizeEurInText,
} from "../src/lib/advisoryText.ts";

// The advisory text helpers shared by the AI surfaces: the money
// format and the payload-string humanizer. The legacy advisory
// card's sentence-composer suites retired with the card (the owner
// decision of 22 October); these utilities stay - the AI context
// boxes render their payload strings through them.

describe("money format", () => {
  it("always carries the euro sign", () => {
    assert.equal(humanEur(0.16), "\u20AC0.16");
    assert.equal(humanEur(12), "\u20AC12.00");
  });

  it("uses two decimals at 0.10 and above", () => {
    assert.equal(humanEur(0.1), "\u20AC0.10");
    assert.equal(humanEur(12.3456), "\u20AC12.35");
  });

  it("renders two decimals whenever the value is nonzero at two decimals", () => {
    assert.equal(humanEur(0.0629), "\u20AC0.06");
    assert.equal(humanEur(0.06), "\u20AC0.06");
    assert.equal(humanEur(1.07), "\u20AC1.07");
    assert.equal(humanEur(0.09), "\u20AC0.09");
  });

  it("keeps tiny nonzero values visible when two decimals would show 0.00", () => {
    assert.equal(humanEur(0.0035), "\u20AC0.0035");
    assert.equal(humanEur(0.004), "\u20AC0.004");
    assert.notEqual(humanEur(0.0035), "\u20AC0.00");
  });

  it("renders zero honestly", () => {
    assert.equal(humanEur(0), "\u20AC0.00");
  });

  it("humanizes euro amounts inside precomposed strings", () => {
    assert.equal(
      humanizeEurInText("EUR 0.2671/kWh against EUR 0.2574/kWh"),
      "\u20AC0.27/kWh against \u20AC0.26/kWh"
    );
    // Bare four-decimal numbers clamp only when two decimals stay
    // nonzero; a tiny value keeps its exact digits.
    assert.equal(
      humanizeEurInText("saved 0.4043 and 0.0035 respectively"),
      "saved 0.40 and 0.0035 respectively"
    );
  });

  it("renders a NaN token as an honest dash, never as a price", () => {
    assert.equal(
      humanizeEurInText("an average of \u20ACNaN per kWh"),
      "an average of \u2014 per kWh"
    );
    assert.equal(
      humanizeEurInText("the lowest at NaN"),
      "the lowest at \u2014"
    );
  });
});
