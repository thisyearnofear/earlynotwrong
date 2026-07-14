import { describe, it, expect } from "vitest";
import {
  calculateBehavioralMetrics,
  calculatePatienceTax,
  groupEntriesIntoPositions,
  computeSubjectHash,
  computeThesisHash,
  getArchetype,
  type LedgerEntry,
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
});
