/**
 * Wallet Score — behavioral conviction scoring as a service.
 *
 * This is the shared core behind the `wallet-score/v1` product: send a wallet
 * address + chain, get back its behavioral conviction score (win rate, patience
 * tax, archetype, cohort percentile) with a verifiable ledger hash.
 *
 * It is a refactor of the logic that was inline in `/api/analyze/batch/route.ts`,
 * extracted so the same scoring can be served as a clean API product (the
 * `wallet-score` MCP/CAP service) in addition to the interactive web analyzer.
 * The web route remains a consumer of this function.
 *
 * Why this is a product and `signals-live` isn't the lead: behavioral
 * conviction scoring of *arbitrary* wallets is scarce (nobody else scores
 * trading behavior as conviction rather than P&L), and it's not gated on the
 * agent's own thin track record — it scores others. See
 * `docs/WALLET_SCORE_PLAN.md`.
 */

import {
  analyzePosition,
  calculateBehavioralMetrics,
  groupEntriesIntoPositions,
  type LedgerEntry,
  type LedgerPosition,
  type PositionAnalysis,
  type BehavioralMetrics,
} from "conviction-core";
import { marketService } from "@/lib/services/market-service";
import { APP_CONFIG } from "@/lib/config";
import { getCohortPercentile } from "@/lib/db/postgres";
import { keccak256, toBytes } from "viem";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WalletChain = "solana" | "base";

export interface WalletScoreInput {
  address: string;
  chain: WalletChain;
  /** Optional resolved name (ENS / Farcaster) for display. */
  resolvedName?: string | null;
  /** Override the default 180-day lookback. */
  timeHorizonDays?: number;
  /** Override the default $100 min-trade filter. */
  minTradeValue?: number;
}

/** Per-position detail in the wallet-score payload. */
export interface WalletScorePosition {
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  realizedPnlUsd: number;
  realizedPnlPercent: number;
  patienceTaxUsd: number;
  holdingPeriodDays: number;
  isEarlyExit: boolean;
  isActive: boolean;
}

/** The `wallet-score/v1` payload — the product. */
export interface WalletScoreV1 {
  schema: "wallet-score/v1";
  generatedAt: number;
  subject: {
    chain: WalletChain;
    address: string;
    resolvedName: string | null;
  };
  score: number;
  archetype: BehavioralMetrics["archetype"];
  metrics: {
    winRate: number;
    upsideCapture: number;
    patienceTaxUsd: number;
    avgHoldingPeriodDays: number;
    totalPositions: number;
    convictionWins: number;
    earlyExits: number;
  };
  cohort: {
    percentile: number | null;
    cohortSize: number | null;
  };
  positions: WalletScorePosition[];
  proof: {
    /** keccak256 of the canonical ledger JSON — the buyer can recompute this
     *  from on-chain data and verify the score wasn't fabricated. */
    ledgerHash: string;
    positionCount: number;
    entryCount: number;
    exitCount: number;
    computedAt: number;
    frameworkVersion: string;
    verifiableAt: string;
  };
  guidance: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Score a wallet's behavioral conviction.
 *
 * Fetches on-chain trade history (Helius for Solana, Zerion/Alchemy for Base),
 * reconstructs the ledger, runs conviction-core's scoring, fetches the cohort
 * percentile, and returns the `wallet-score/v1` payload.
 *
 * Throws on fetch failure (the caller — the API route — maps to a 5xx). An
 * empty wallet (no trades in the window) returns a well-formed payload with
 * score 0 and a guidance note, not a throw — that's an honest result.
 */
export async function scoreWallet(input: WalletScoreInput): Promise<WalletScoreV1> {
  const {
    address,
    chain,
    resolvedName = null,
    timeHorizonDays = APP_CONFIG.analysis.defaultTimeHorizon,
    minTradeValue = APP_CONFIG.analysis.minTradeValue,
  } = input;

  // 1. Fetch on-chain trade history.
  const transactions = await marketService.fetchTransactions({
    address,
    chain,
    timeHorizonDays,
    minTradeValue,
  });

  // 2. Reconstruct the ledger (entries + exits grouped into positions).
  const ledgerEntries: LedgerEntry[] = transactions.map((tx) => ({
    hash: tx.hash,
    timestamp: tx.timestamp,
    tokenAddress: tx.tokenAddress,
    tokenSymbol: tx.tokenSymbol,
    type: tx.type === "buy" ? "buy" : "sell",
    amount: tx.amount,
    priceUsd: tx.priceUsd,
    valueUsd: tx.valueUsd,
  }));
  const positions: LedgerPosition[] = groupEntriesIntoPositions(ledgerEntries);

  const generatedAt = Date.now();

  // Empty wallet — honest result, not an error.
  if (positions.length === 0) {
    return {
      schema: "wallet-score/v1",
      generatedAt,
      subject: { chain, address, resolvedName },
      score: 0,
      archetype: "Exit Voyager",
      metrics: {
        winRate: 0,
        upsideCapture: 0,
        patienceTaxUsd: 0,
        avgHoldingPeriodDays: 0,
        totalPositions: 0,
        convictionWins: 0,
        earlyExits: 0,
      },
      cohort: { percentile: null, cohortSize: null },
      positions: [],
      proof: {
        ledgerHash: computeLedgerHash(ledgerEntries),
        positionCount: 0,
        entryCount: 0,
        exitCount: 0,
        computedAt: generatedAt,
        frameworkVersion: convictionCoreVersion(),
        verifiableAt: verifierUrl(chain, address),
      },
      guidance:
        "No trades above the minimum value in the lookback window — not enough activity to score. Try a longer time horizon or a different address.",
    };
  }

  // 3. Fetch current prices + post-exit price histories for patience tax.
  const uniqueTokens = Array.from(new Set(positions.map((p) => p.tokenAddress)));
  const [metadataResults, priceResults] = await Promise.all([
    Promise.all(
      uniqueTokens.map((tokenAddress) =>
        marketService.getTokenMetadata(tokenAddress, chain),
      ),
    ),
    Promise.all(
      uniqueTokens.map((tokenAddress) =>
        marketService.getPriceData(tokenAddress, chain),
      ),
    ),
  ]);

  const metadataMap = new Map<
    string,
    { name: string; symbol: string; logoUri?: string } | null
  >();
  const currentPriceMap = new Map<string, number>();
  uniqueTokens.forEach((tokenAddress, i) => {
    const metadata = metadataResults[i];
    metadataMap.set(
      tokenAddress,
      metadata ? { name: metadata.name, symbol: metadata.symbol, logoUri: metadata.logoUri } : null,
    );
    currentPriceMap.set(tokenAddress, priceResults[i]?.currentPrice ?? 0);
  });

  // Post-exit price histories for patience tax (only for exited positions).
  const priceHistories = new Map<string, { timestamp: number; price: number }[]>();
  await Promise.all(
    positions.map(async (position) => {
      if (position.exits.length === 0) return;
      const lastExit = position.exits[position.exits.length - 1];
      const endTimestamp = Math.min(
        Date.now(),
        lastExit.timestamp + APP_CONFIG.analysis.patienceTaxWindowDays * 24 * 60 * 60 * 1000,
      );
      const history = await marketService.getHistoricalPrices(
        position.tokenAddress,
        chain,
        lastExit.timestamp,
        endTimestamp,
      );
      if (history.length > 0) {
        priceHistories.set(position.tokenAddress, history);
      }
    }),
  );

  // 4. Run conviction-core scoring.
  const coreAnalyses: PositionAnalysis[] = positions.map((position) =>
    analyzePosition({
      position,
      currentPrice: currentPriceMap.get(position.tokenAddress),
      priceHistory: priceHistories.get(position.tokenAddress),
      patienceTaxWindowDays: APP_CONFIG.analysis.patienceTaxWindowDays,
    }),
  );

  const metrics = calculateBehavioralMetrics(positions, {
    weights: APP_CONFIG.weights,
    archetypeThresholds: {
      ironPillar: {
        minScore: APP_CONFIG.archetypes.IRON_PILLAR.minScore,
        maxPatienceTax: APP_CONFIG.archetypes.IRON_PILLAR.maxPatienceTax,
      },
      profitPhantom: {
        minScore: APP_CONFIG.archetypes.PROFIT_PHANTOM.minScore,
        minPatienceTax: APP_CONFIG.archetypes.PROFIT_PHANTOM.minPatienceTax,
      },
      exitVoyager: {
        maxScore: APP_CONFIG.archetypes.EXIT_VOYAGER.maxScore,
      },
    },
    currentPrices: currentPriceMap,
    priceHistories,
    patienceTaxWindowDays: APP_CONFIG.analysis.patienceTaxWindowDays,
  });

  // 5. Cohort percentile (how this wallet ranks vs all scanned wallets).
  const cohort = await getCohortPercentile(metrics.score, chain);

  // 6. Build the per-position detail.
  const positionDetails: WalletScorePosition[] = positions.map((position, i) => {
    const analysis = coreAnalyses[i];
    const metadata = metadataMap.get(position.tokenAddress);
    return {
      tokenAddress: position.tokenAddress,
      tokenSymbol: position.tokenSymbol ?? metadata?.symbol ?? null,
      tokenName: metadata?.name ?? null,
      realizedPnlUsd: analysis.realizedPnL,
      realizedPnlPercent: analysis.realizedPnLPercent,
      patienceTaxUsd: analysis.patienceTax,
      holdingPeriodDays: analysis.holdingPeriodDays,
      isEarlyExit: analysis.isEarlyExit,
      isActive: position.isActive,
    };
  });

  // 7. The guidance string — one sentence the buyer can act on.
  const guidance = buildGuidance(metrics.archetype, metrics.score, metrics.patienceTax);

  return {
    schema: "wallet-score/v1",
    generatedAt,
    subject: { chain, address, resolvedName },
    score: metrics.score,
    archetype: metrics.archetype,
    metrics: {
      winRate: metrics.winRate,
      upsideCapture: metrics.upsideCapture,
      patienceTaxUsd: metrics.patienceTax,
      avgHoldingPeriodDays: metrics.avgHoldingPeriod,
      totalPositions: metrics.totalPositions,
      convictionWins: metrics.convictionWins,
      earlyExits: metrics.earlyExits,
    },
    cohort: {
      percentile: cohort?.topPercent ?? null,
      cohortSize: cohort?.cohortSize ?? null,
    },
    positions: positionDetails,
    proof: {
      ledgerHash: computeLedgerHash(ledgerEntries),
      positionCount: positions.length,
      entryCount: ledgerEntries.filter((e) => e.type === "buy").length,
      exitCount: ledgerEntries.filter((e) => e.type === "sell").length,
      computedAt: generatedAt,
      frameworkVersion: convictionCoreVersion(),
      verifiableAt: verifierUrl(chain, address),
    },
    guidance,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic hash of the ledger so a buyer can verify the score
 * wasn't fabricated. The hash is over the canonical JSON of the ledger entries
 * (sorted by hash, with type/amount/priceUsd/valueUsd/timestamp/tokenAddress).
 * A buyer who fetches the same on-chain history and reconstructs the same
 * ledger gets the same hash — or doesn't, in which case the score is suspect.
 */
export function computeLedgerHash(entries: LedgerEntry[]): string {
  const canonical = entries
    .slice()
    .sort((a, b) => a.hash.localeCompare(b.hash))
    .map((e) => ({
      hash: e.hash,
      timestamp: e.timestamp,
      tokenAddress: e.tokenAddress,
      type: e.type,
      amount: e.amount,
      priceUsd: e.priceUsd,
      valueUsd: e.valueUsd,
    }));
  return keccak256(toBytes(JSON.stringify(canonical)));
}

function convictionCoreVersion(): string {
  // conviction-core is a file: dependency; read its version at build time via
  // the package.json import. Fall back to "unknown" if unavailable.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("conviction-core/package.json");
    return `conviction-core@${pkg.version}`;
  } catch {
    return "conviction-core";
  }
}

function verifierUrl(chain: WalletChain, address: string): string {
  const base = APP_CONFIG.baseUrl;
  return `${base}/analyzer?w=${encodeURIComponent(address)}&chain=${chain}`;
}

function buildGuidance(
  archetype: BehavioralMetrics["archetype"],
  score: number,
  patienceTaxUsd: number,
): string {
  const taxNote =
    patienceTaxUsd > 0
      ? ` Patience tax is $${patienceTaxUsd.toFixed(0)} — money left on the table by exiting before the peak.`
      : "";
  switch (archetype) {
    case "Iron Pillar":
      return `Iron Pillar — holds through drawdown and captures upside. Score ${score}/100.${taxNote}`;
    case "Profit Phantom":
      return `Profit Phantom — exits early, leaving gains on the table. Score ${score}/100.${taxNote}`;
    case "Exit Voyager":
      return `Exit Voyager — exits frequently, low conviction holding. Score ${score}/100.${taxNote}`;
    case "Diamond Hand":
      return `Diamond Hand — long holds, rarely exits. Score ${score}/100.${taxNote}`;
    default:
      return `Score ${score}/100.${taxNote}`;
  }
}
