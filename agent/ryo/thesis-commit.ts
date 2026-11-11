/**
 * thesis_commit — Track 3 (New Skills) tool for the RYO-CHAN platform.
 *
 * A research primitive RYO doesn't have: tamper-evident commitment of an
 * agent's reasoning *before* the market moves. Any agent calls this tool,
 * gets back a hash-chained receipt proving its thesis existed at time T —
 * "early, not wrong" as a platform primitive. Later, anyone can recompute
 * the chain and confirm the thesis wasn't written after the fact.
 *
 * Spec-shaped to mount on RYO's MCP surface as-is: pure function in →
 * structured receipt out, no side-channel I/O required beyond the shared
 * append-only ledger (same file the practice agent's decisions chain into,
 * so a single --verify audit covers decisions AND committed theses).
 *
 *   npx tsx agent/ryo/thesis-commit.ts --symbol HYPE \
 *     --thesis "RSI 34 + 14% 7d drawdown — oversold mean-reversion" \
 *     --conviction 76 --horizon 72
 */
import { sha256, record, lastHash, verifyChain } from "../lib/adapters/ryo-ledger.js";

export interface ThesisCommitInput {
  /** Ticker the thesis covers, e.g. "HYPE". */
  symbol: string;
  /** The agent's natural-language thesis — max ~500 chars recommended. */
  thesis: string;
  /** Optional 0–100 conviction the agent claims. */
  conviction?: number;
  /** Optional resolution window in hours — after it, the thesis is checkable. */
  horizon_hours?: number;
  /** Optional digests/URIs of the evidence the agent claims it used. */
  evidence_refs?: string[];
}

export interface ThesisCommitReceipt {
  tool: "thesis_commit";
  /** sha256 commitment over the canonical thesis payload — what gets cited. */
  commitment: string;
  receipt: {
    ts: string;
    index: number;
    prevHash: string;
    hash: string;
  };
  /** Settles the thesis later: compare claim vs outcome inside the window. */
  resolve_after: string | null;
  verify: {
    ledger: string;
    command: string;
    chain_intact_at_commit: boolean;
  };
}

export function thesisCommit(input: ThesisCommitInput): ThesisCommitReceipt {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol || symbol.length > 14) throw new Error("thesis_commit: invalid symbol");
  if (!input.thesis?.trim()) throw new Error("thesis_commit: thesis is required");
  if (input.conviction !== undefined && (input.conviction < 0 || input.conviction > 100)) {
    throw new Error("thesis_commit: conviction must be 0–100");
  }

  const commitment = sha256(
    JSON.stringify({
      symbol,
      thesis: input.thesis.trim(),
      conviction: input.conviction ?? null,
      horizon_hours: input.horizon_hours ?? null,
      evidence_refs: input.evidence_refs ?? [],
    }),
  );

  const chain = verifyChain();
  const resolveAfter = input.horizon_hours
    ? new Date(Date.now() + input.horizon_hours * 3600_000).toISOString()
    : null;

  const entry = record(
    0, // cycle N/A — external caller, not an agent cycle
    symbol,
    "THESIS",
    input.conviction ?? 0,
    input.thesis.trim().slice(0, 500),
    {
      commitment,
      evidence_refs: input.evidence_refs ?? [],
      resolve_after: resolveAfter,
      caller: "external",
    },
  );

  return {
    tool: "thesis_commit",
    commitment,
    receipt: { ts: entry.ts, index: chain.entries, prevHash: entry.prevHash, hash: entry.hash },
    resolve_after: resolveAfter,
    verify: {
      ledger: "agent/data/ryo-ledger.jsonl",
      command: "npx tsx agent/ryo/run.ts --verify",
      chain_intact_at_commit: chain.ok,
    },
  };
}

// ─── CLI surface ────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("thesis-commit.ts")) {
  const args = process.argv.slice(2);
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const symbol = opt("symbol");
  const thesis = opt("thesis");
  if (!symbol || !thesis) {
    console.error("usage: thesis-commit.ts --symbol SYM --thesis \"...\" [--conviction N] [--horizon H] [--evidence ref1,ref2]");
    process.exit(2);
  }
  const out = thesisCommit({
    symbol,
    thesis,
    conviction: opt("conviction") ? Number(opt("conviction")) : undefined,
    horizon_hours: opt("horizon") ? Number(opt("horizon")) : undefined,
    evidence_refs: opt("evidence")?.split(","),
  });
  console.log(JSON.stringify(out, null, 2));
}
