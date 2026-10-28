import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageBreakdown } from "../src/lib/api.ts";
import {
  buildTiles,
  OTHER_SHARE_THRESHOLD,
  primaryOf,
  secondaryOf,
  squarify,
} from "../src/lib/usageTreemap.ts";

const COLOR = (key: string): string => `#${key}`;

// A minimal breakdown payload for the tile tests.
function breakdownFixture({
  totalKwh = 100,
  totalCost = 50,
  categories,
}: {
  totalKwh?: number;
  totalCost?: number;
  categories: {
    key: string;
    label: string;
    kwh: number;
    cost_eur: number | null;
    class?: "measured" | "Est." | "remainder";
  }[];
}): UsageBreakdown {
  return {
    period: "day",
    date: "2026-10-16",
    window: { start: "2026-10-16T00:00:00+02:00", end: "2026-10-17T00:00:00+02:00" },
    previous: {
      period: "day",
      window: { start: "2026-10-15T00:00:00+02:00", end: "2026-10-16T00:00:00+02:00" },
    },
    total: { kwh: totalKwh, cost_eur: totalCost, previous_kwh: 90, previous_cost_eur: 45 },
    categories: categories.map((c) => ({
      key: c.key,
      label: c.label,
      class: c.class ?? "measured",
      entities: [],
      kwh: c.kwh,
      cost_eur: c.cost_eur,
      previous_kwh: 1,
      previous_cost_eur: 1,
    })),
    split: {
      measured_kwh: 0,
      estimated_kwh: 0,
      remainder_kwh: totalKwh,
      measured_cost_eur: null,
      estimated_cost_eur: null,
      remainder_cost_eur: null,
      previous_measured_kwh: 0,
      previous_estimated_kwh: 0,
      previous_remainder_kwh: 90,
    },
    assumptions: {
      flat_cop: 3,
      heating_gas_m3: 0,
      heating_days: 0,
      gas_non_heating_baseline_m3_per_month: 20,
      setpoint_staleness_hours: 24,
    },
  };
}

describe("squarify: the layout", () => {
  const W = 600;
  const H = 320;

  it("conserves each value's share as area", () => {
    const items = [
      { key: "a", value: 60 },
      { key: "b", value: 30 },
      { key: "c", value: 10 },
    ];
    const rects = squarify(items, W, H);
    const total = items.reduce((sum, i) => sum + i.value, 0);
    for (const item of items) {
      const rect = rects.get(item.key);
      assert.notEqual(rect, undefined);
      const area = rect!.w * rect!.h;
      assert.ok(Math.abs(area / (W * H) - item.value / total) < 1e-9);
    }
  });

  it("keeps every rectangle inside the container", () => {
    const rects = squarify(
      [
        { key: "a", value: 87 },
        { key: "b", value: 5 },
        { key: "c", value: 4 },
        { key: "d", value: 3 },
        { key: "e", value: 1 },
      ],
      W,
      H
    );
    for (const rect of rects.values()) {
      assert.ok(rect.x >= -1e-6 && rect.y >= -1e-6);
      assert.ok(rect.x + rect.w <= W + 1e-6);
      assert.ok(rect.y + rect.h <= H + 1e-6);
    }
  });

  it("tiles without overlap", () => {
    const rects = squarify(
      [
        { key: "a", value: 70 },
        { key: "b", value: 15 },
        { key: "c", value: 10 },
        { key: "d", value: 5 },
      ],
      W,
      H
    );
    const list = [...rects.values()];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const overlaps =
          a.x < b.x + b.w - 1e-6 &&
          b.x < a.x + a.w - 1e-6 &&
          a.y < b.y + b.h - 1e-6 &&
          b.y < a.y + a.h - 1e-6;
        assert.equal(overlaps, false, `${i} overlaps ${j}`);
      }
    }
  });

  it("fills the container with a single value", () => {
    const rects = squarify([{ key: "solo", value: 42 }], W, H);
    const rect = rects.get("solo")!;
    assert.ok(Math.abs(rect.w - W) < 1e-6);
    assert.ok(Math.abs(rect.h - H) < 1e-6);
  });

  it("returns nothing for empty or non-positive input", () => {
    assert.equal(squarify([], W, H).size, 0);
    assert.equal(squarify([{ key: "a", value: 0 }], W, H).size, 0);
    assert.equal(squarify([{ key: "a", value: 1 }], 0, H).size, 0);
  });
});

describe("buildTiles: the tile model", () => {
  it("keeps above-threshold categories and marks the estimate", () => {
    const data = breakdownFixture({
      categories: [
        { key: "remainder", label: "Remainder", kwh: 88, cost_eur: 44, class: "remainder" },
        { key: "heat_pump", label: "Heat pump", kwh: 8, cost_eur: 4, class: "Est." },
        { key: "washing_machine", label: "Washing machine", kwh: 4, cost_eur: 2 },
      ],
    });
    const tiles = buildTiles(data, "energy", COLOR);
    assert.deepEqual(
      tiles.map((t) => t.key),
      ["heat_pump", "washing_machine"]
    );
    const heatPump = tiles.find((t) => t.key === "heat_pump")!;
    assert.equal(heatPump.isEstimate, true);
    // Shares stay the true share of the period total, not of the
    // known set: 8 of 100.
    assert.equal(heatPump.share, 0.08);
    assert.equal(heatPump.secondary, 4);
  });

  it("excludes the remainder from the tiles", () => {
    const data = breakdownFixture({
      categories: [
        { key: "remainder", label: "Remainder", kwh: 88, cost_eur: 44, class: "remainder" },
        { key: "heat_pump", label: "Heat pump", kwh: 8, cost_eur: 4, class: "Est." },
      ],
    });
    const tiles = buildTiles(data, "energy", COLOR);
    assert.equal(tiles.some((t) => t.key === "remainder"), false);
  });

  it(`collapses under-threshold estimates into Other (${OTHER_SHARE_THRESHOLD} share)`, () => {
    const data = breakdownFixture({
      categories: [
        { key: "remainder", label: "Remainder", kwh: 97, cost_eur: 48.5, class: "remainder" },
        { key: "heat_pump", label: "Heat pump", kwh: 1.5, cost_eur: 0.75, class: "Est." },
        { key: "heat_pump2", label: "Heat pump 2", kwh: 1.5, cost_eur: 0.75, class: "Est." },
      ],
    });
    const tiles = buildTiles(data, "energy", COLOR);
    const other = tiles.find((t) => t.key === "other");
    assert.notEqual(other, undefined);
    assert.equal(other!.primary, 3);
    // Other's share is of the period total: 3 of 100.
    assert.equal(other!.share, 0.03);
    assert.equal(tiles.some((t) => t.key === "heat_pump"), false);
    assert.equal(tiles.some((t) => t.key === "heat_pump2"), false);
  });

  it("always renders measured categories regardless of share", () => {
    const data = breakdownFixture({
      categories: [
        { key: "remainder", label: "Remainder", kwh: 97, cost_eur: 48.5, class: "remainder" },
        { key: "dishwasher", label: "Dishwasher", kwh: 1.5, cost_eur: 0.75 },
        { key: "dryer", label: "Dryer", kwh: 1.5, cost_eur: 0.75 },
      ],
    });
    const tiles = buildTiles(data, "energy", COLOR);
    assert.deepEqual(
      tiles.map((t) => t.key).sort(),
      ["dishwasher", "dryer"]
    );
    assert.equal(tiles.some((t) => t.key === "other"), false);
    assert.equal(tiles.some((t) => t.key === "small_plugs"), false);
  });

  it("merges measured plugs under the Small plugs floor into one tile with members", () => {
    const data = breakdownFixture({
      categories: [
        { key: "remainder", label: "Remainder", kwh: 96.91, cost_eur: 48.455, class: "remainder" },
        { key: "dishwasher", label: "Dishwasher", kwh: 3, cost_eur: 1.5 },
        { key: "game_pc", label: "Game PC", kwh: 0.05, cost_eur: 0.025 },
        { key: "tv_audio", label: "TV and audio", kwh: 0.04, cost_eur: 0.02 },
      ],
    });
    const tiles = buildTiles(data, "energy", COLOR);
    assert.deepEqual(
      tiles.map((t) => t.key).sort(),
      ["dishwasher", "small_plugs"]
    );
    const smallPlugs = tiles.find((t) => t.key === "small_plugs")!;
    assert.equal(smallPlugs.label, "Small plugs");
    assert.equal(smallPlugs.color, COLOR("small_plugs"));
    assert.equal(smallPlugs.primary, 0.09);
    assert.equal(smallPlugs.members?.length, 2);
    assert.deepEqual(
      smallPlugs.members!.map((m) => m.label),
      ["Game PC", "TV and audio"]
    );
    assert.equal(smallPlugs.members![0].primary, 0.05);
    assert.equal(smallPlugs.members![0].secondary, 0.025);
  });

  it("renders the measured day set: own tiles, Small plugs below the floor, in both modes", () => {
    const data = breakdownFixture({
      totalKwh: 14.6,
      totalCost: 7.3,
      categories: [
        { key: "remainder", label: "Remainder", kwh: 13.38, cost_eur: 6.69, class: "remainder" },
        { key: "dishwasher", label: "Dishwasher", kwh: 1.1, cost_eur: 0.55 },
        { key: "office", label: "Office", kwh: 0.1, cost_eur: 0.05 },
        { key: "game_pc", label: "Game PC", kwh: 0.006, cost_eur: 0.003 },
        { key: "tv_audio", label: "TV and audio", kwh: 0.014, cost_eur: 0.007 },
      ],
    });
    for (const mode of ["energy", "cost"] as const) {
      const tiles = buildTiles(data, mode, COLOR);
      const keys = tiles.map((t) => t.key);
      assert.equal(keys.includes("dishwasher"), true, mode);
      assert.equal(keys.includes("office"), true, mode);
      assert.equal(keys.includes("game_pc"), false, mode);
      assert.equal(keys.includes("tv_audio"), false, mode);
      assert.equal(keys.includes("other"), false, mode);
      const smallPlugs = tiles.find((t) => t.key === "small_plugs")!;
      assert.notEqual(smallPlugs, undefined, mode);
      assert.deepEqual(
        smallPlugs.members!.map((m) => m.label),
        ["Game PC", "TV and audio"],
        mode
      );
    }
  });

  it("omits an under-floor estimate and returns no tiles when nothing else is known", () => {
    const data = breakdownFixture({
      categories: [
        { key: "remainder", label: "Remainder", kwh: 99.8, cost_eur: 49.9, class: "remainder" },
        { key: "heat_pump", label: "Heat pump", kwh: 0.2, cost_eur: 0.1, class: "Est." },
      ],
    });
    const tiles = buildTiles(data, "energy", COLOR);
    assert.deepEqual(tiles, []);
  });

  it("omits Other when nothing is under the threshold", () => {
    const data = breakdownFixture({
      categories: [
        { key: "remainder", label: "Remainder", kwh: 50, cost_eur: 25, class: "remainder" },
        { key: "heat_pump", label: "Heat pump", kwh: 50, cost_eur: 25, class: "Est." },
      ],
    });
    const tiles = buildTiles(data, "energy", COLOR);
    assert.deepEqual(tiles.map((t) => t.key), ["heat_pump"]);
  });

  it("swaps primary and secondary with the mode", () => {
    const data = breakdownFixture({
      totalKwh: 100,
      totalCost: 50,
      categories: [
        { key: "washing_machine", label: "Washing machine", kwh: 90, cost_eur: 45 },
      ],
    });
    const energy = buildTiles(data, "energy", COLOR)[0];
    const cost = buildTiles(data, "cost", COLOR)[0];
    assert.equal(energy.primary, 90);
    assert.equal(energy.secondary, 45);
    assert.equal(cost.primary, 45);
    assert.equal(cost.secondary, 90);
  });

  it("returns no tiles for a period without usage", () => {
    const data = breakdownFixture({
      totalKwh: 0,
      totalCost: 0,
      categories: [
        { key: "remainder", label: "Remainder", kwh: 0, cost_eur: 0, class: "remainder" },
      ],
    });
    assert.deepEqual(buildTiles(data, "energy", COLOR), []);
  });
});

describe("metric selection", () => {
  it("reads kWh as primary in energy mode, cost in cost mode", () => {
    const category = { kwh: 3, cost_eur: 1.5 };
    assert.equal(primaryOf(category, "energy"), 3);
    assert.equal(primaryOf(category, "cost"), 1.5);
    assert.equal(secondaryOf(category, "energy"), 1.5);
    assert.equal(secondaryOf(category, "cost"), 3);
  });

  it("treats a null cost as zero primary in cost mode", () => {
    assert.equal(primaryOf({ kwh: 3, cost_eur: null }, "cost"), 0);
    assert.equal(secondaryOf({ kwh: 3, cost_eur: null }, "energy"), null);
  });
});
