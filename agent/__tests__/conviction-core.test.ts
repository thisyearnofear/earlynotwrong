import { describe, it, expect } from "vitest";
import {
  calculateBehavioralMetrics,
  calculateCalibrationMetrics,
  calculatePatienceTax,
  groupEntriesIntoPositions,
  computeSubjectHash,
  computeThesisHash,
  getArchetype,
  brierScore,
  logLoss,
  hitRate,
  reliabilityBuckets,
  type LedgerEntry,
  type ProbabilityForecast,
} from "conviction-core";

describe("conviction-core", () => {
  describe("groupEntriesIntoPositions", () => {
    it("groups mixed token entries into positions", () => {
      const entries: LedgerEntry[] = [
        {
          hash: "tx1",
          timestamp: 1000,
          tokenAddress: "tokA",
          tokenSymbol: "A",
          type: "buy",
          amount: 10,
          priceUsd: 1,
          valueUsd: 10,
        },
        {
          hash: "tx2",
          timestamp: 2000,
          tokenAddress: "tokA",
          type: "sell",
          amount: 5,
          priceUsd: 2,
          valueUsd: 10,
        },
        {
          hash: "tx3",
          timestamp: 3000,
          tokenAddress: "tokB",
          type: "buy",
          amount: 1,
          priceUsd: 100,
          valueUsd: 100,
        },
      ];

      const positions = groupEntriesIntoPositions(entries);
      expect(positions).toHaveLength(2);

      const posA = positions.find((p) => p.tokenAddress === "tokA")!;
      expect(posA.entries).toHaveLength(1);
      expect(posA.exits).toHaveLength(1);
      expect(posA.totalInvested).toBe(10);
      expect(posA.totalRealized).toBe(10);
      expect(posA.remainingBalance).toBe(5);
      expect(posA.isActive).toBe(true);

      const posB = positions.find((p) => p.tokenAddress === "tokB")!;
      expect(posB.entries).toHaveLength(1);
      expect(posB.exits).toHaveLength(0);
      expect(posB.remainingBalance).toBe(1);
    });
  });

  describe("calculatePatienceTax", () => {
    it("computes missed gain relative to post-exit peak", () => {
      const result = calculatePatienceTax(
        1,
        100,
        [
          { timestamp: 1000, price: 1.0 },
          { timestamp: 2000, price: 1.5 },
          { timestamp: 3000, price: 1.2 },
        ],
        90,
        1000
      );

      expect(result.maxMissedGain).toBe(50);
      expect(result.patienceTax).toBe(50);
      expect(result.wouldBeValue).toBe(150);
      expect(result.maxMissedGainDate).toBe(2000);
    });

    it("returns zero when no price history is provided", () => {
      const result = calculatePatienceTax(1, 100, [], 90, 1000);
      expect(result.patienceTax).toBe(0);
      expect(result.wouldBeValue).toBe(100);
    });
  });

  describe("calculateBehavioralMetrics", () => {
    it("scores a patient winner highly", () => {
      const positions = groupEntriesIntoPositions([
        {
          hash: "entry",
          timestamp: 0,
          tokenAddress: "tokA",
          type: "buy",
          amount: 10,
          priceUsd: 1,
          valueUsd: 10,
        },
        {
          hash: "exit",
          timestamp: 86400000 * 60,
          tokenAddress: "tokA",
          type: "sell",
          amount: 10,
          priceUsd: 3,
          valueUsd: 30,
        },
      ]);

      const metrics = calculateBehavioralMetrics(positions, {
        weights: {
          winRate: 0.25,
          upsideCapture: 0.35,
          earlyExitMitigation: 0.25,
          holdingPeriod: 0.15,
          diamondHands: 0.05,
          consistency: 0.05,
          panicSell: 0.1,
        },
      });

      expect(metrics.winRate).toBe(100);
      expect(metrics.avgHoldingPeriod).toBe(60);
      expect(metrics.totalPositions).toBe(1);
      // A patient winner with no patience tax qualifies as an Iron Pillar.
      expect(metrics.archetype).toBe("Iron Pillar");
    });

    it("penalizes quick losing exits", () => {
      const positions = groupEntriesIntoPositions([
        {
          hash: "entry",
          timestamp: 0,
          tokenAddress: "tokA",
          type: "buy",
          amount: 10,
          priceUsd: 1,
          valueUsd: 10,
        },
        {
          hash: "exit",
          timestamp: 86400000 * 2,
          tokenAddress: "tokA",
          type: "sell",
          amount: 10,
          priceUsd: 0.8,
          valueUsd: 8,
        },
      ]);

      const metrics = calculateBehavioralMetrics(positions);
      expect(metrics.winRate).toBe(0);
      expect(metrics.avgHoldingPeriod).toBe(2);
      expect(metrics.earlyExits).toBeGreaterThanOrEqual(0);
    });
  });

  describe("hashing", () => {
    it("produces deterministic subject hashes", () => {
      const a = computeSubjectHash("solana", "abc");
      const b = computeSubjectHash("solana", "abc");
      expect(a).toBe(b);
      expect(a.startsWith("0x")).toBe(true);
    });

    it("produces deterministic thesis hashes", () => {
      const a = computeThesisHash({ score: 85, archetype: "Diamond Hand" });
      const b = computeThesisHash({ score: 85, archetype: "Diamond Hand" });
      expect(a).toBe(b);
    });
  });

  describe("getArchetype", () => {
    it("classifies Iron Pillar", () => {
      expect(getArchetype(95, 500)).toBe("Iron Pillar");
    });

    it("classifies Profit Phantom", () => {
      expect(getArchetype(80, 6000)).toBe("Profit Phantom");
    });

    it("classifies Exit Voyager", () => {
      expect(getArchetype(30, 0)).toBe("Exit Voyager");
    });

    it("defaults to Diamond Hand", () => {
      expect(getArchetype(60, 2000)).toBe("Diamond Hand");
    });
  });

  // ===========================================================================
  // Calibration (prediction-market estimation accuracy)
  // ===========================================================================

  describe("calibration", () => {
    const f = (
      id: string,
      forecast: number,
      outcome?: 0 | 1,
    ): ProbabilityForecast => ({ id, forecast, forecastAt: 0, outcome, resolvedAt: outcome !== undefined ? 1 : undefined });

    it("returns null for every metric when nothing is resolved", () => {
      expect(brierScore([f("a", 0.7)])).toBeNull();
      expect(logLoss([f("a", 0.7)])).toBeNull();
      expect(hitRate([f("a", 0.7)])).toBeNull();
      const metrics = calculateCalibrationMetrics([f("a", 0.7)]);
      expect(metrics.resolved).toBe(0);
      expect(metrics.unresolved).toBe(1);
      expect(metrics.brierScore).toBeNull();
      expect(metrics.buckets.every((b) => b.count === 0)).toBe(true);
    });

    it("scores a perfect forecaster with Brier 0", () => {
      const forecasts = [f("a", 0.99, 1), f("b", 0.01, 0)];
      // (0.99−1)² = (0.01−0)² = 0.0001 → mean 0.0001
      expect(brierScore(forecasts)!).toBeCloseTo(0.0001, 9);
      expect(hitRate(forecasts)).toBe(1);
    });

    it("scores an always-50/50 forecaster at Brier 0.25", () => {
      const forecasts = [f("a", 0.5, 1), f("b", 0.5, 0)];
      expect(brierScore(forecasts)).toBeCloseTo(0.25, 9);
      // Exact coin calls claim no edge → count as misses.
      expect(hitRate(forecasts)).toBe(0);
    });

    it("penalizes confident wrong forecasts more than hesitant ones", () => {
      const confidentWrong = brierScore([f("a", 0.95, 0)])!;
      const hesitantWrong = brierScore([f("a", 0.6, 0)])!;
      expect(confidentWrong).toBeGreaterThan(hesitantWrong);
      // Same ordering for log loss.
      const confLog = logLoss([f("a", 0.95, 0)])!;
      const hesLog = logLoss([f("a", 0.6, 0)])!;
      expect(confLog).toBeGreaterThan(hesLog);
    });

    it("computes the mixed example from first principles", () => {
      // (0.7−1)² = 0.09; (0.4−0)² = 0.16 → mean 0.125
      const forecasts = [f("a", 0.7, 1), f("b", 0.4, 0)];
      expect(brierScore(forecasts)).toBeCloseTo(0.125, 9);
      expect(hitRate(forecasts)).toBe(1);
      expect(logLoss(forecasts)).toBeCloseTo(-(Math.log(0.7) + Math.log(0.6)) / 2, 9);
    });

    it("partitions resolved forecasts into 10 equal-width buckets", () => {
      const buckets = reliabilityBuckets([f("a", 0.05, 0), f("b", 0.95, 1), f("c", 0.55, 1)]);
      expect(buckets).toHaveLength(10);
      expect(buckets[0].count).toBe(1); // 0.05 in [0.0, 0.1)
      expect(buckets[0].meanOutcome).toBe(0);
      expect(buckets[5].count).toBe(1); // 0.55 in [0.5, 0.6)
      expect(buckets[9].count).toBe(1); // 0.95 in [0.9, 1.0]
      expect(buckets[1].count).toBe(0);
      expect(buckets[1].meanForecast).toBeNull();
    });

    it("bucket gap measures per-bin miscalibration", () => {
      // Two 0.8 forecasts, both miss → meanForecast 0.8, meanOutcome 0, gap 0.8.
      const buckets = reliabilityBuckets([f("a", 0.8, 0), f("b", 0.82, 0)]);
      const bin = buckets[8];
      expect(bin.count).toBe(2);
      expect(bin.meanForecast).toBeCloseTo(0.81, 9);
      expect(bin.meanOutcome).toBe(0);
      expect(bin.gap).toBeCloseTo(0.81, 9);
    });

    it("calculateCalibrationMetrics aggregates everything", () => {
      const forecasts = [f("a", 0.9, 1), f("b", 0.2, 1), f("c", 0.6, 0), f("d", 0.45)];
      const metrics = calculateCalibrationMetrics(forecasts);
      expect(metrics.resolved).toBe(3);
      expect(metrics.unresolved).toBe(1);
      expect(metrics.brierScore).toBeCloseTo(((0.1 ** 2) + (0.8 ** 2) + (0.6 ** 2)) / 3, 9);
      expect(metrics.hitRate).toBeCloseTo(1 / 3, 9); // only "a" correct side
      expect(metrics.buckets).toHaveLength(10);
    });
  });
});
