/**
 * Pure helpers for the Delphi tournament endgame (hold-to-settlement,
 * payout-multiple ranker, quote-at-size shrink).
 */

import { describe, it, expect } from "vitest";
import {
  exitModeAt,
  payoutMultiple,
  rankByMultiple,
  resolvesBeforeDeadline,
  selectTournamentCandidate,
  tournamentGates,
} from "../lib/delphi/endgame.js";
import { quoteSharesForBudget } from "../lib/delphi/probability.js";

const TST = 1_000_000n;

describe("exitModeAt", () => {
  const from = "2026-08-20T00:00:00Z";
  const t0 = Date.parse(from);

  it("is convergence before the date", () => {
    expect(exitModeAt(t0 - 1, from)).toBe("convergence");
  });

  it("is hold-to-settlement at and after the date", () => {
    expect(exitModeAt(t0, from)).toBe("hold-to-settlement");
    expect(exitModeAt(t0 + 1, from)).toBe("hold-to-settlement");
  });

  it("fails open to convergence when the date is missing or malformed", () => {
    expect(exitModeAt(t0, undefined)).toBe("convergence");
    expect(exitModeAt(t0, null)).toBe("convergence");
    expect(exitModeAt(t0, "not-a-date")).toBe("convergence");
  });
});

describe("resolvesBeforeDeadline", () => {
  const close = "2026-08-24T00:00:00Z";
  const sixH = 6 * 3_600_000;

  it("rejects a market that resolves inside the redeem buffer", () => {
    expect(resolvesBeforeDeadline("2026-08-23T23:00:00Z", close, sixH)).toBe(false);
  });

  it("accepts a market that resolves with buffer to spare", () => {
    expect(resolvesBeforeDeadline("2026-08-23T17:00:00Z", close, sixH)).toBe(true);
  });

  it("treats exact boundary as in time", () => {
    expect(resolvesBeforeDeadline("2026-08-23T18:00:00Z", close, sixH)).toBe(true);
  });

  it("passes unknown or malformed dates (don't starve the tape)", () => {
    expect(resolvesBeforeDeadline(null, close, sixH)).toBe(true);
    expect(resolvesBeforeDeadline(undefined, close, sixH)).toBe(true);
    expect(resolvesBeforeDeadline("whenever", close, sixH)).toBe(true);
  });
});

describe("tournamentGates", () => {
  it("uses hop-1 gates under 1500 TST", () => {
    expect(tournamentGates(600n * TST)).toEqual({ minPayoutMultiple: 2.2, maxFillPrice: 0.45 });
    expect(tournamentGates(1499n * TST)).toEqual({ minPayoutMultiple: 2.2, maxFillPrice: 0.45 });
  });

  it("relaxes to hop-2 gates at 1500 TST", () => {
    expect(tournamentGates(1500n * TST)).toEqual({ minPayoutMultiple: 1.6, maxFillPrice: 0.65 });
    expect(tournamentGates(1800n * TST)).toEqual({ minPayoutMultiple: 1.6, maxFillPrice: 0.65 });
  });
});

describe("selectTournamentCandidate / rankByMultiple", () => {
  const gates = { minPayoutMultiple: 2.2, maxFillPrice: 0.45 };

  it("picks the cheapest high-forecast over a larger-edge expensive ticket", () => {
    const cheap = { id: "uap", forecast: 0.85, fillPrice: 0.32 }; // 2.66×
    const expensive = { id: "wti-no", forecast: 0.9, fillPrice: 0.66 }; // 1.36×, fill too high
    const mid = { id: "gemini", forecast: 0.7, fillPrice: 0.55 }; // fill too high
    expect(selectTournamentCandidate([expensive, mid, cheap], gates)?.id).toBe("uap");
  });

  it("returns null when nothing clears the multiple/fill gates", () => {
    expect(
      selectTournamentCandidate([{ id: "no", forecast: 0.9, fillPrice: 0.66 }], gates),
    ).toBeNull();
  });

  it("ranks remaining candidates by multiple descending", () => {
    const ranked = rankByMultiple([
      { id: "a", forecast: 0.8, fillPrice: 0.4 },
      { id: "b", forecast: 0.9, fillPrice: 0.3 },
    ]);
    expect(ranked.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("payoutMultiple is forecast/fill", () => {
    expect(payoutMultiple(0.85, 0.32)).toBeCloseTo(2.656, 2);
    expect(payoutMultiple(0.5, 0)).toBe(0);
  });
});

describe("quoteSharesForBudget", () => {
  it("accepts a first quote that is under budget and max fill", async () => {
    const budget = 100n * TST;
    const sized = await quoteSharesForBudget({
      budgetTokens: budget,
      topOfBookPrice: 0.32,
      maxFillPrice: 0.45,
      quoteBuy: async (shares) => {
        const tokensIn = (shares * 320_000n) / (10n ** 12n * 1_000_000n);
        return { tokensIn: tokensIn.toString(), pricePerShare: 0.32 };
      },
    });
    expect(sized).not.toBeNull();
    expect(sized!.fillPrice).toBe(0.32);
    expect(sized!.tokensIn).toBeLessThanOrEqual(budget);
    expect(sized!.shares).toBeGreaterThan(0n);
  });

  it("shrinks when the first quote overshoots budget", async () => {
    const budget = 100n * TST;
    let calls = 0;
    const sized = await quoteSharesForBudget({
      budgetTokens: budget,
      topOfBookPrice: 0.2,
      maxFillPrice: 0.45,
      quoteBuy: async (shares) => {
        calls++;
        const naive = (shares * 200_000n) / (10n ** 12n * 1_000_000n);
        const tokensIn = calls === 1 ? naive * 3n : naive;
        return { tokensIn: tokensIn.toString(), pricePerShare: 0.2 };
      },
    });
    expect(sized).not.toBeNull();
    expect(calls).toBeGreaterThan(1);
    expect(sized!.tokensIn).toBeLessThanOrEqual(budget);
  });

  it("returns null when impact pushes fill above maxFillPrice and shrink bottoms out", async () => {
    const sized = await quoteSharesForBudget({
      budgetTokens: 100n * TST,
      topOfBookPrice: 0.2,
      maxFillPrice: 0.25,
      quoteBuy: async () => ({ tokensIn: (50n * TST).toString(), pricePerShare: 0.8 }),
    });
    expect(sized).toBeNull();
  });
});
