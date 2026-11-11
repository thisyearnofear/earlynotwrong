/**
 * Tamper-evident reasoning ledger for the RYO-CHAN practice agent.
 *
 * Every decision — entry, hold, exit, skip — appends a JSONL record carrying
 * the full evidence digest and a sha256 chain link (`hash = sha256(prevHash + canonical(entry))`).
 * Judges can verify integrity by recomputing the chain; any edited entry breaks
 * every hash after it. Same primitive we use for on-chain anchoring, made
 * auditable offline for the hackathon.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type TradeAction = 'BUY' | 'HOLD' | 'EXIT' | 'SKIP' | 'THESIS' | 'ANCHOR' | 'JURY';

export interface LedgerEntry {
  ts: string;
  cycle: number;
  symbol: string;
  action: TradeAction;
  conviction: number;
  sizeUsd?: number;
  priceUsd?: number;
  reason: string;
  evidence: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface PaperPosition {
  symbol: string;
  entryPriceUsd: number;
  sizeUsd: number;
  openedAt: string;
  peakPriceUsd: number;
}

const DATA_DIR = join(__dirname, '..', '..', 'data');
export const LEDGER_PATH = join(DATA_DIR, 'ryo-ledger.jsonl');
export const STATE_PATH = join(DATA_DIR, 'ryo-state.json');

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function lastHash(): string {
  if (!existsSync(LEDGER_PATH)) return 'GENESIS';
  const lines = readFileSync(LEDGER_PATH, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines.length) return 'GENESIS';
  try {
    return (JSON.parse(lines[lines.length - 1]) as LedgerEntry).hash;
  } catch {
    return 'GENESIS';
  }
}

export function record(
  cycle: number,
  symbol: string,
  action: TradeAction,
  conviction: number,
  reason: string,
  evidence: Record<string, unknown>,
  extra: Partial<LedgerEntry> = {},
): LedgerEntry {
  mkdirSync(DATA_DIR, { recursive: true });
  const prevHash = lastHash();
  const entry = {
    ts: new Date().toISOString(),
    cycle,
    symbol,
    action,
    conviction,
    reason,
    evidence,
    ...extra,
  } as LedgerEntry;
  entry.prevHash = prevHash;
  entry.hash = sha256(prevHash + JSON.stringify(entry, Object.keys(entry).sort()));
  appendFileSync(LEDGER_PATH, JSON.stringify(entry) + '\n');
  return entry;
}

export function loadState(): { cycle: number; positions: PaperPosition[]; cashUsd: number } {
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    } catch {
      /* fall through */
    }
  }
  return { cycle: 0, positions: [], cashUsd: 10_000 };
}

export function saveState(state: { cycle: number; positions: PaperPosition[]; cashUsd: number }): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** Recompute the chain; returns the first broken link or null if intact. */
export function verifyChain(): { ok: boolean; brokenAt?: number; entries: number } {
  if (!existsSync(LEDGER_PATH)) return { ok: true, entries: 0 };
  const lines = readFileSync(LEDGER_PATH, 'utf8').trim().split('\n').filter(Boolean);
  let prev = 'GENESIS';
  for (let i = 0; i < lines.length; i++) {
    const e = JSON.parse(lines[i]) as LedgerEntry;
    if (e.prevHash !== prev) return { ok: false, brokenAt: i, entries: lines.length };
    const { hash, ...rest } = e;
    if (sha256(prev + JSON.stringify(rest, Object.keys(rest).sort())) !== hash) {
      return { ok: false, brokenAt: i, entries: lines.length };
    }
    prev = hash;
  }
  return { ok: true, entries: lines.length };
}
