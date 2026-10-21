import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkAdvisory,
  logCheckerVerdict,
  PRICE_TOLERANCE_EUR,
  resetCheckerWarnState,
} from "../server/checker.mjs";

// The advisory integrity checker: corrupted and valid fixtures for
// the price and battery verification and the throttled verdict logger.

const FACTS = {
  lowPrice: { timestamp: "02:00", price: 0.19 },
  peakPrice: { timestamp: "08:00", price: 0.41 },
  battery: { soc_pct: 72, state: "idle" },
};

const VALID_FIELDS = {
  what: "Run your large appliances between 12:00 and 15:00 to save EUR 0.16",
  when: "12:00-15:00 today",
  warning: "The battery needs attention before tonight's peak; check its settings",
  contextNote: "No appliance used enough power today to make shifting worthwhile",
};

describe("checkAdvisory: valid advisories pass unchanged", () => {
  it("accepts a clean model narrative with zero claims", () => {
    const verdict = checkAdvisory(VALID_FIELDS, FACTS);
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.priceClaims, 0);
    assert.equal(verdict.batteryClaims, 0);
  });

  it("accepts the template's own price sentence", () => {
    const verdict = checkAdvisory(
      {
        contextNote:
          "Lowest price around 02:00 (EUR 0.19); peak around 08:00 (EUR 0.41).",
      },
      FACTS
    );
    assert.equal(verdict.ok, true);
    assert.equal(verdict.priceClaims, 4);
  });

  it("accepts the template's own battery sentence", () => {
    const verdict = checkAdvisory(
      { contextNote: "The battery is at 72% and is idle." },
      FACTS
    );
    assert.equal(verdict.ok, true);
    assert.equal(verdict.batteryClaims, 2);
  });

  it("does not flag window ranges, window averages or savings", () => {
    const verdict = checkAdvisory(
      {
        what: "Run your large appliances between 12:00 and 15:00 to save EUR 0.16",
        when: "Cheapest remaining window: 12:00-15:00 at EUR 0.25 average today",
      },
      FACTS
    );
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.problems, []);
  });
});

describe("checkAdvisory: corrupted price claims are rejected", () => {
  it("catches a wrong low hour", () => {
    const verdict = checkAdvisory(
      {
        what: "Lowest price around 03:00 (EUR 0.20); peak around 08:00 (EUR 0.41).",
      },
      FACTS
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /lowest price named at 03:00/);
    assert.match(verdict.reason, /day's low is at 02:00/);
  });

  it("catches a wrong peak hour", () => {
    const verdict = checkAdvisory(
      { warning: "Avoid the 07:00 peak at EUR 0.51" },
      FACTS
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /peak named at 07:00/);
    assert.match(verdict.reason, /day's peak is at 08:00/);
  });

  it("catches a wrong price figure at the right low hour", () => {
    const verdict = checkAdvisory(
      { contextNote: "The lowest price around 02:00 (EUR 0.25)" },
      FACTS
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /EUR 0.25 stated for 02:00/);
    assert.match(verdict.reason, /does not match the curve \(EUR 0.19\)/);
  });

  it("catches a price figure at an hour that is on no known curve point", () => {
    const verdict = checkAdvisory(
      { contextNote: "EUR 0.30 at 05:00" },
      FACTS
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /matches no point on the day's curve/);
  });

  it("accepts a price figure within the rounding tolerance and rejects past it", () => {
    const within = checkAdvisory(
      {
        contextNote: `Lowest price around 02:00 (EUR ${(
          FACTS.lowPrice.price + PRICE_TOLERANCE_EUR
        ).toFixed(4)})`,
      },
      FACTS
    );
    assert.equal(within.ok, true);
    const past = checkAdvisory(
      {
        contextNote: `Lowest price around 02:00 (EUR ${(
          FACTS.lowPrice.price + PRICE_TOLERANCE_EUR + 0.001
        ).toFixed(4)})`,
      },
      FACTS
    );
    assert.equal(past.ok, false);
    assert.match(past.reason, /does not match the curve/);
  });

  it("rejects every price claim when the day has no price curve", () => {
    const verdict = checkAdvisory(
      { what: "Lowest price around 02:00 (EUR 0.19)" },
      { ...FACTS, lowPrice: null, peakPrice: null }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no price curve/);
  });
});

describe("checkAdvisory: corrupted battery claims are rejected", () => {
  it("catches a wrong SOC percentage", () => {
    const verdict = checkAdvisory(
      { contextNote: "The battery is at 80% right now" },
      FACTS
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /SOC claimed at 80%/);
    assert.match(verdict.reason, /context says 72%/);
  });

  it("catches a fully charged claim", () => {
    const verdict = checkAdvisory(
      { warning: "The battery is fully charged" },
      FACTS
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /SOC claimed at 100%/);
  });

  it("catches a wrong state word", () => {
    const verdict = checkAdvisory(
      { contextNote: "The battery is charging" },
      FACTS
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /state "charging"/);
    assert.match(verdict.reason, /context says "idle"/);
  });

  it("accepts the matching state word", () => {
    const verdict = checkAdvisory(
      { contextNote: "The battery is idle" },
      FACTS
    );
    assert.equal(verdict.ok, true);
    assert.equal(verdict.batteryClaims, 1);
  });

  it("rejects any battery claim when the context has no battery data", () => {
    const verdict = checkAdvisory(
      { contextNote: "The battery is at 72% and is idle" },
      { ...FACTS, battery: null }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no battery data/);
  });
});

describe("logCheckerVerdict", () => {
  function capture(method) {
    const original = console[method];
    const lines = [];
    console[method] = (line) => lines.push(String(line));
    return [
      lines,
      () => {
        console[method] = original;
      },
    ];
  }

  it("logs every accept verdict", () => {
    const [lines, restore] = capture("log");
    try {
      logCheckerVerdict({ ok: true, priceClaims: 1, batteryClaims: 0 });
      logCheckerVerdict({ ok: true, priceClaims: 0, batteryClaims: 2 });
    } finally {
      restore();
    }
    assert.equal(lines.length, 2);
    assert.match(lines[0], /\[advisory-checker\] accept/);
    assert.match(lines[0], /1 price and 0 battery claims verified/);
  });

  it("throttles repeated reject warnings per reason, in the live style", () => {
    resetCheckerWarnState();
    const [lines, restore] = capture("warn");
    try {
      const verdict = { ok: false, reason: "what: lowest price named at 03:00" };
      logCheckerVerdict(verdict);
      logCheckerVerdict(verdict);
      logCheckerVerdict({ ok: false, reason: "warning: peak named at 07:00" });
    } finally {
      restore();
    }
    assert.equal(lines.length, 2);
    assert.match(lines[0], /\[advisory-checker\] reject/);
    assert.match(lines[0], /lowest price named at 03:00/);
    // A different reason is a different throttle key.
    assert.match(lines[1], /peak named at 07:00/);
  });

  it("warns again after the throttle state is reset", () => {
    resetCheckerWarnState();
    const [lines, restore] = capture("warn");
    try {
      const verdict = { ok: false, reason: "contextNote: battery SOC of 80%" };
      logCheckerVerdict(verdict);
      resetCheckerWarnState();
      logCheckerVerdict(verdict);
    } finally {
      restore();
    }
    assert.equal(lines.length, 2);
  });
});

describe("checkAdvisory: euro-sign figures are extracted and validated", () => {
  it("catches a corrupted low hour written with the euro sign", () => {
    const verdict = checkAdvisory(
      {
        what: "Lowest price around 03:00 (€0.20); peak around 08:00 (€0.41).",
      },
      FACTS
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /lowest price named at 03:00/);
  });

  it("accepts the correct pairs written with the euro sign", () => {
    const verdict = checkAdvisory(
      {
        contextNote:
          "Lowest price around 02:00 (€0.19); peak around 08:00 (€0.41).",
      },
      FACTS
    );
    assert.equal(verdict.ok, true);
    assert.equal(verdict.priceClaims, 4);
  });

  it("validates a euro-sign price figure against the curve", () => {
    const ok = checkAdvisory({ contextNote: "€0.19 at 02:00" }, FACTS);
    assert.equal(ok.ok, true);
    const wrongPrice = checkAdvisory(
      { contextNote: "€0.25 at 02:00" },
      FACTS
    );
    assert.equal(wrongPrice.ok, false);
    assert.match(wrongPrice.reason, /does not match the curve/);
    const unknownHour = checkAdvisory(
      { contextNote: "€0.30 at 05:00" },
      FACTS
    );
    assert.equal(unknownHour.ok, false);
    assert.match(unknownHour.reason, /matches no point on the day's curve/);
  });

  it("does not mistake a euro-sign saving for a price claim", () => {
    const verdict = checkAdvisory(
      {
        what: "Run your large appliances between 12:00 and 15:00 to save €0.16",
      },
      FACTS
    );
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.problems, []);
  });
});
