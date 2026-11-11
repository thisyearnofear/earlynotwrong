/**
 * File-backed status surface for the RYO-CHAN practice domain.
 *
 * Unlike options (in-process state container) the RYO runner persists its
 * state to disk — agent/data/ryo-state.json + ryo-ledger.jsonl — so any
 * serving process can answer "what is the agent doing right now" by reading
 * two files and recomputing the chain head. The production agent's
 * /ryo/status route and the standalone demo server (agent/ryo/serve.ts)
 * share this builder; the web app's arena card consumes it via the proxy.
 */
import { readFileSync, existsSync } from "node:fs";
import {
  LEDGER_PATH,
  STATE_PATH,
  verifyChain,
  type LedgerEntry,
  type PaperPosition,
} from "./ryo-ledger.js";

export interface RyoStatus {
  hasData: boolean;
  domain: "ryo";
  /** Honest by construction — this domain only ever produces paper fills. */
  mode: "paper";
  cycle: number;
  lastRunAt: string | null;
  cashUsd: number;
  positions: Array<PaperPosition & { unrealizedPnlPercent?: number }>;
  /** Latest verdict feed — the reasoning trail rendered. */
  verdicts: Array<{
    ts: string;
    symbol: string;
    action: string;
    conviction: number;
    reason: string;
    sizeUsd?: number;
    priceUsd?: number;
    hash: string;
    evidence?: Record<string, unknown>;
  }>;
  chain: {
    entries: number;
    intact: boolean;
    headHash: string | null;
    /** First N entries' hashes for the visual chain — enough to show linkage. */
    headHashes: string[];
  };
  stats: {
    buys: number;
    holds: number;
    exits: number;
    skips: number;
    vetoes: number;
    theses: number;
    juryVerdicts: number;
  };
}

const VERDICT_WINDOW = 20;
const HEAD_HASH_WINDOW = 8;

export function readRyoStatus(): RyoStatus {
  const entries: LedgerEntry[] = [];
  if (existsSync(LEDGER_PATH)) {
    for (const line of readFileSync(LEDGER_PATH, "utf8").split("\n")) {
      const t = line.trim();
      if (t) {
        try {
          entries.push(JSON.parse(t) as LedgerEntry);
        } catch {
          // A corrupt line is surfaced via verifyChain().intact — don't throw here.
        }
      }
    }
  }

  let state: { cycle: number; positions: PaperPosition[]; cashUsd: number } = {
    cycle: 0,
    positions: [],
    cashUsd: 10_000,
  };
  if (existsSync(STATE_PATH)) {
    try {
      state = { ...state, ...(JSON.parse(readFileSync(STATE_PATH, "utf8")) as typeof state) };
    } catch {
      // keep defaults
    }
  }

  const chain = verifyChain();
  const verdicts = entries.slice(-VERDICT_WINDOW).reverse().map((e) => ({
    ts: e.ts,
    symbol: e.symbol,
    action: e.action,
    conviction: e.conviction,
    reason: e.reason,
    sizeUsd: e.sizeUsd,
    priceUsd: e.priceUsd,
    hash: e.hash,
    evidence: e.evidence,
  }));

  const count = (pred: (e: LedgerEntry) => boolean) => entries.filter(pred).length;
  return {
    hasData: entries.length > 0,
    domain: "ryo",
    mode: "paper",
    cycle: state.cycle,
    lastRunAt: entries.at(-1)?.ts ?? null,
    cashUsd: state.cashUsd,
    positions: state.positions,
    verdicts,
    chain: {
      entries: chain.entries,
      intact: chain.ok,
      headHash: entries.at(-1)?.hash ?? null,
      headHashes: entries.slice(-HEAD_HASH_WINDOW).map((e) => e.hash.slice(0, 12)),
    },
    stats: {
      buys: count((e) => e.action === "BUY"),
      holds: count((e) => e.action === "HOLD"),
      exits: count((e) => e.action === "EXIT"),
      skips: count((e) => e.action === "SKIP" && e.conviction > 0),
      vetoes: count((e) => e.action === "SKIP" && e.conviction === 0),
      theses: count((e) => e.action === "THESIS"),
      juryVerdicts: count((e) => e.action === "JURY"),
    },
  };
}
