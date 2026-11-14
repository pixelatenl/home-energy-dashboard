import type { PriceBaseline } from "@/lib/api";

// The hourly price bar palette. By default it is purely relative: the
// shared window's cheapest hour maps to full green and its most expensive
// hour to full red. When the prices payload carries a 30-day baseline,
// both ends are anchored to what prices normally do in this household:
// the bottom of the scale slides from green toward amber when the window's
// cheapest hour sits above the 30-day average daily minimum
// (lowFactor = avg_daily_min_30d / min), and the top slides from red
// toward amber when the window's peak sits below the 30-day average daily
// maximum (highFactor = max / avg_daily_max_30d). The bar hue is
// bottomHue + (topHue - bottomHue) * t, with t the price's relative
// position within [min, max]. bottomHue is always at least amber and
// topHue at most amber, so the two gates can only meet at amber, never
// cross: a uniformly expensive day renders in the amber band instead of
// full green. Saturation and lightness stay 40% 38%, the same muted,
// mid-dark depth as the usage treemap's palette; only the hue moves.

export const PRICE_HUE_GREEN = 140;
export const PRICE_HUE_RED = 0;
export const PRICE_HUE_AMBER = 50;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// The blended palette endpoints for a min/max scale under a baseline.
// Without a baseline (or with both anchor values null) these are the
// plain green 140 / red 0 endpoints of the purely relative palette.
export function pricePaletteEndpoints(
  min: number,
  max: number,
  baseline?: PriceBaseline | null
): { bottomHue: number; topHue: number } {
  const avgMin = baseline?.avg_daily_min_30d ?? null;
  const avgMax = baseline?.avg_daily_max_30d ?? null;
  let bottomHue = PRICE_HUE_GREEN;
  let topHue = PRICE_HUE_RED;
  if (avgMin !== null && avgMin > 0 && min > avgMin) {
    const lowFactor = clamp01(avgMin / min);
    bottomHue =
      PRICE_HUE_AMBER + (PRICE_HUE_GREEN - PRICE_HUE_AMBER) * lowFactor;
  }
  if (avgMax !== null && avgMax > 0 && max < avgMax) {
    const highFactor = clamp01(max / avgMax);
    topHue = PRICE_HUE_AMBER * highFactor;
  }
  return { bottomHue, topHue };
}

// The bar color of one hourly price: the hue interpolated between the
// blended endpoints by the price's relative position t within [min, max].
export function priceColor(
  price: number,
  min: number,
  max: number,
  baseline?: PriceBaseline | null
): string {
  const span = max - min || 1;
  const t = clamp01((price - min) / span);
  const { bottomHue, topHue } = pricePaletteEndpoints(min, max, baseline);
  const hue = bottomHue + (topHue - bottomHue) * t;
  return `hsl(${hue} 40% 38%)`;
}
