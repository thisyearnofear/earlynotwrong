import { describe, expect, it } from "vitest";
import {
  computeHolderMetric,
  holderGrowthFraction,
} from "../lib/holders.js";
import type { HolderCache } from "../lib/holders.js";

function makeCache(snapshots: { symbol: string; count: number; ageDays: number }[]): HolderCache {
  const now = Date.now();
  const cache: HolderCache = {};
  for (const s of snapshots) {
    const key = s.symbol.toUpperCase();
    if (!cache[key]) cache[key] = [];
    cache[key].push({ count: s.count, fetchedAt: now - s.ageDays * 86400000 });
  }
  return cache;
}

describe("holderGrowthFraction", () => {
  it("returns null for null input", () => {
    expect(holderGrowthFraction(null)).toBeNull();
  });

  it("returns 0 for ≤-5% decline", () => {
    expect(holderGrowthFraction(-5)).toBe(0);
    expect(holderGrowthFraction(-10)).toBe(0);
  });

  it("returns 0.4 at 0% growth", () => {
    expect(holderGrowthFraction(0)).toBeCloseTo(0.4, 2);
  });

  it("returns 1.0 for ≥+10% growth", () => {
    expect(holderGrowthFraction(10)).toBe(1);
    expect(holderGrowthFraction(25)).toBe(1);
  });

  it("interpolates between -5 and 0", () => {
    const val = holderGrowthFraction(-2.5);
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThan(0.4);
  });

  it("interpolates between 0 and 10", () => {
    const val = holderGrowthFraction(5);
    expect(val).toBeGreaterThan(0.4);
    expect(val).toBeLessThan(1);
  });
});

describe("computeHolderMetric", () => {
  it("returns zeros for empty cache", () => {
    const m = computeHolderMetric({}, "KITE");
    expect(m.count).toBe(0);
    expect(m.growthPercent).toBeNull();
    expect(m.samples).toBe(0);
  });

  it("returns count but null growth when history is too short", () => {
    const cache = makeCache([
      { symbol: "KITE", count: 1000, ageDays: 0.5 },
    ]);
    const m = computeHolderMetric(cache, "KITE");
    expect(m.count).toBe(1000);
    expect(m.growthPercent).toBeNull();
    expect(m.samples).toBe(1);
  });

  it("computes positive growth over 7d", () => {
    const cache = makeCache([
      { symbol: "KITE", count: 1000, ageDays: 7 },
      { symbol: "KITE", count: 1100, ageDays: 0 },
    ]);
    const m = computeHolderMetric(cache, "KITE");
    expect(m.count).toBe(1100);
    expect(m.growthPercent).toBeCloseTo(10, 0);
  });

  it("computes negative growth (holders leaving)", () => {
    const cache = makeCache([
      { symbol: "GWEI", count: 500, ageDays: 5 },
      { symbol: "GWEI", count: 450, ageDays: 0 },
    ]);
    const m = computeHolderMetric(cache, "GWEI");
    expect(m.count).toBe(450);
    expect(m.growthPercent).toBeCloseTo(-10, 0);
  });
});
