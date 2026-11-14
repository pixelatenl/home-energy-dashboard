import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PriceBaseline } from "../src/lib/api.ts";
import {
  PRICE_HUE_AMBER,
  priceColor,
  pricePaletteEndpoints,
} from "../src/lib/priceColors.ts";

// Pins for the extended priceColor: the purely relative palette without a
// baseline (regression), the green gate on the 30-day average daily
// minimum, the red gate on the 30-day average daily maximum, and the
// convergence of both gates at amber.

const baseline = (
  avg_daily_min_30d: number | null,
  avg_daily_max_30d: number | null,
  days = 30
): PriceBaseline => ({ avg_daily_min_30d, avg_daily_max_30d, days });

// The hue of an "hsl(H 40% 38%)" color string.
const hueOf = (color: string): number => Number(color.match(/^hsl\(([-\d.]+)/)?.[1]);

describe("priceColor without a baseline (regression pin)", () => {
  it("maps the window's cheapest hour to full green and its peak to full red", () => {
    assert.equal(priceColor(0.1, 0.1, 0.5), "hsl(140 40% 38%)");
    assert.equal(priceColor(0.5, 0.1, 0.5), "hsl(0 40% 38%)");
  });

  it("treats a present baseline with both anchors null exactly like no baseline", () => {
    const nullAnchors = baseline(null, null, 3);
    assert.equal(priceColor(0.1, 0.1, 0.5, nullAnchors), "hsl(140 40% 38%)");
    assert.equal(priceColor(0.5, 0.1, 0.5, nullAnchors), "hsl(0 40% 38%)");
    assert.equal(priceColor(0.3, 0.1, 0.5, nullAnchors), priceColor(0.3, 0.1, 0.5));
  });

  it("keeps saturation and lightness at 40% 38%", () => {
    assert.match(priceColor(0.3, 0.1, 0.5), /^hsl\([-\d.]+ 40% 38%\)$/);
    assert.match(
      priceColor(0.3, 0.1, 0.5, baseline(0.13, 0.5)),
      /^hsl\([-\d.]+ 40% 38%\)$/
    );
  });
});

describe("priceColor: the green gate (avg_daily_min_30d = 0.13)", () => {
  it("slides the bottom to hue 95 when the cheapest hour is double the anchor (min = 0.26)", () => {
    assert.equal(
      priceColor(0.26, 0.26, 0.6, baseline(0.13, null)),
      "hsl(95 40% 38%)"
    );
  });

  it("keeps full green when the cheapest hour matches the anchor (min = 0.13)", () => {
    assert.equal(
      priceColor(0.13, 0.13, 0.6, baseline(0.13, null)),
      "hsl(140 40% 38%)"
    );
  });

  it("lands at hue 72.5 at factor 0.25 (min = 0.52)", () => {
    assert.equal(
      priceColor(0.52, 0.52, 0.6, baseline(0.13, null)),
      "hsl(72.5 40% 38%)"
    );
  });

  it("keeps full green on a genuinely cheap day (min below the anchor)", () => {
    assert.equal(
      priceColor(0.1, 0.1, 0.6, baseline(0.13, null)),
      "hsl(140 40% 38%)"
    );
  });
});

describe("priceColor: the red gate (avg_daily_max_30d = 0.50)", () => {
  it("slides the top to hue 25 when the peak is half the anchor (max = 0.25)", () => {
    assert.equal(
      priceColor(0.25, 0.1, 0.25, baseline(null, 0.5)),
      "hsl(25 40% 38%)"
    );
  });

  it("keeps full red when the peak matches the anchor (max = 0.50)", () => {
    assert.equal(
      priceColor(0.5, 0.1, 0.5, baseline(null, 0.5)),
      "hsl(0 40% 38%)"
    );
  });

  it("lands at hue 10 at factor 0.2 (max = 0.10, a cheap day's peak)", () => {
    assert.equal(
      priceColor(0.1, 0.05, 0.1, baseline(null, 0.5)),
      "hsl(10 40% 38%)"
    );
  });

  it("keeps full red on a genuinely expensive day (max above the anchor)", () => {
    assert.equal(
      priceColor(0.6, 0.1, 0.6, baseline(null, 0.5)),
      "hsl(0 40% 38%)"
    );
  });
});

describe("priceColor: convergence at amber", () => {
  it("blends the endpoints of a day gated on both sides (bottomHue 72.5, topHue 10)", () => {
    const { bottomHue, topHue } = pricePaletteEndpoints(
      0.52,
      0.1,
      baseline(0.13, 0.5)
    );
    assert.equal(bottomHue, 72.5);
    assert.equal(topHue, 10);
    // The gates can only meet at amber, never cross.
    assert.ok(bottomHue >= PRICE_HUE_AMBER);
    assert.ok(topHue <= PRICE_HUE_AMBER);
  });

  it("interpolates monotonically between the blended endpoints", () => {
    const b = baseline(0.13, 0.5);
    const prices = [0.52, 0.415, 0.31, 0.205, 0.1];
    const hues = prices.map((price) => hueOf(priceColor(price, 0.52, 0.1, b)));
    for (let i = 1; i < hues.length; i++) {
      assert.ok(hues[i] < hues[i - 1], `hues decrease: ${hues}`);
    }
    assert.ok(hues.every((hue) => hue >= 10 && hue <= 72.5));
  });

  it("renders a uniformly expensive day in the amber band, not green", () => {
    // min = max = 1.00, far beyond both anchors: every bar sits at t = 0
    // with the bottom hue converged from green toward amber.
    const hue = hueOf(priceColor(1.0, 1.0, 1.0, baseline(0.13, 0.5)));
    assert.ok(hue >= PRICE_HUE_AMBER, `hue ${hue} is at least amber`);
    assert.ok(hue < 90, `hue ${hue} stays in the amber band, not green`);
  });

  it("converges toward amber 50 but never below it on a structurally expensive day", () => {
    const { bottomHue } = pricePaletteEndpoints(100, 101, baseline(0.13, 0.5));
    assert.ok(bottomHue >= PRICE_HUE_AMBER);
    assert.ok(bottomHue < PRICE_HUE_AMBER + 1);
  });
});
