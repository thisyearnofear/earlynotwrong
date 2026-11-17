/**
 * ConvictionRegistry v2 orchestration — the claim lifecycle the agent runs
 * alongside each anchor cycle (doc: docs/CASPER_FORWARD.md).
 *
 * Four jobs, all gated on CASPER_REGISTRY_V2_HASH and all wrapped so a v2
 * failure can never break the trading loop:
 *
 *   1. **Registration** — the agent registers itself once (`register_agent`)
 *      so its claims are attributable to a discoverable identity (Axis 2).
 *   2. **Claim anchoring** — the cycle's top-scored token becomes a
 *      PRICE_THESIS claim bound to the sealed commit price (Axis 1).
 *   3. **Resolution** — claims past `expires_at` are resolved deterministically
 *      from the live price feed: up past threshold → VALIDATED, down →
 *      INVALIDATED, flat → MIXED. Proposed outcomes then sit out the
 *      contract's dispute window before `finalize_resolution`.
 *   4. **Epoch roots** — every anchored record is also appended to the local
 *      hash-chained epoch ledger; once an epoch closes, its Merkle root is
 *      anchored once — N records, one transaction (Axis 4).
 *
 * Pending claims + registration state persist in `AGENT_DATA_DIR/casper-v2.json`
 * so pm2 restarts don't lose the lifecycle.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bytes32Hex, ConvictionRecord } from "./types.js";
import {
  CLAIM_OUTCOMES,
  CLAIM_TYPES,
  getAnchorMode,
  getRegistryV2Hash,
  v2AnchorClaim,
  v2AnchorEpochRoot,
  v2FinalizeResolution,
  v2RegisterAgent,
  v2ResolveClaim,
  type ClaimOutcome,
} from "./casper.js";
import {
  appendToEpoch,
  computeEpochRoot,
  markEpochAnchored,
  pendingEpochs,
} from "./epoch-ledger.js";

// ─── Config ─────────────────────────────────────────────────────────────────

/** Resolution horizon for PRICE_THESIS claims — default 24h. */
const CLAIM_HORIZON_MS = Number(process.env.CASPER_CLAIM_HORIZON_MS ?? 86_400_000);
/** Price move (%) that decides validated/invalidated; inside the band = MIXED. */
const CLAIM_THRESHOLD_PCT = Number(process.env.CASPER_CLAIM_THRESHOLD_PCT ?? 5);
/** Attached value per claim (fee + bond). Default 0 — requires claim_fee=0 on
 *  the contract (operator runs `set_config(0, …)` post-deploy). Set to the
 *  on-chain fee (+ bond) to attach value via the proxy-wasm path. */
const CLAIM_ATTACHED_MOTES = BigInt(process.env.CASPER_CLAIM_ATTACHED_MOTES ?? "0");
/** Must match the contract's `dispute_window_ms` for finalize timing. */
const DISPUTE_WINDOW_MS = Number(process.env.CASPER_DISPUTE_WINDOW_MS ?? 86_400_000);
/** Max retries for a resolution price fetch before giving up (EXPIRED). */
const RESOLVE_MAX_ATTEMPTS = 5;

const DATA_DIR = process.env.AGENT_DATA_DIR || join(process.cwd(), "data");
const V2_STATE_PATH = join(DATA_DIR, "casper-v2.json");

// ─── Persistent state ───────────────────────────────────────────────────────

export type PendingClaimStatus = "pending" | "proposed" | "finalized" | "dead";

export interface PendingClaim {
  claimHash: Bytes32Hex;
  subjectHash: Bytes32Hex;
  symbol: string;
  /** Sealed commit price (USD) — the deterministic resolution input. */
  priceAtCommitUsd: number;
  thresholdPct: number;
  anchoredAtMs: number;
  expiresAtMs: number;
  anchorTxHash?: string;
  status: PendingClaimStatus;
  /** Set when resolve_claim lands. */
  proposedOutcome?: ClaimOutcome;
  proposedAtMs?: number;
  resolveTxHash?: string;
  /** Failed resolve attempts — bounded so dead claims stop retrying. */
  resolveAttempts: number;
}

interface V2State {
  agentRegistered: boolean;
  pendingClaims: PendingClaim[];
}

function loadV2State(): V2State {
  if (existsSync(V2_STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(V2_STATE_PATH, "utf8")) as V2State;
    } catch {
      /* fall through */
    }
  }
  return { agentRegistered: false, pendingClaims: [] };
}

function saveV2State(state: V2State): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(V2_STATE_PATH, JSON.stringify(state, null, 2));
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ─── Public entry point ─────────────────────────────────────────────────────

export interface ClaimContext {
  /** Top-scored candidate this cycle — becomes the PRICE_THESIS claim. */
  topPick?: { symbol: string; priceUsd: number; score: number };
  /** Live USD price lookup used by the resolver (same feed as the loop). */
  getPriceUsd: (symbol: string) => number | null;
  /** Where the agent's MCP server lives — stored in the agent profile. */
  endpoint: string;
}

/**
 * Run the v2 lifecycle for one cycle. Never throws.
 *
 * The epoch append runs even when v2 writes are disabled — the local ledger
 * is free, and having epochs already populated when the contract deploys
 * means the first `anchor_epoch_root` commits to real history.
 */
export async function casperV2PostAnchor(
  record: ConvictionRecord,
  ctx: ClaimContext,
  /** Set false when this cycle produced no new anchor (thesis dedup) — the
   *  resolution/epoch machinery still runs, but nothing new is committed. */
  recordAnchored = true,
): Promise<void> {
  if (recordAnchored) {
    try {
      appendToEpoch("conviction", record as unknown as Record<string, unknown>, record.timestamp);
    } catch (err) {
      console.warn(`  [Casper v2] epoch append failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!getRegistryV2Hash()) return;
  const state = loadV2State();

  // 1. Register the agent identity once. A failed re-registration (e.g. the
  //    operator already registered via a script) is not fatal — the on-chain
  //    record wins, we just stop retrying.
  if (!state.agentRegistered) {
    try {
      const tx = await v2RegisterAgent(
        record.subjectHash,
        "earlynotwrong",
        ctx.endpoint,
        "crypto-trading,conviction,bsc",
      );
      state.agentRegistered = true;
      console.log(`  [Casper v2] agent registered — ${tx.slice(0, 16)}…`);
    } catch (err) {
      console.warn(`  [Casper v2] register_agent failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Anchor the cycle's top pick as a PRICE_THESIS claim — skipped in
  //    epoch mode (new claims would strand: they'd need resolve+finalize
  //    deploys later). The claim hash binds subject + symbol + sealed
  //    price + horizon; resolution just compares price-at-expiry.
  if (recordAnchored && ctx.topPick && ctx.topPick.priceUsd > 0 && getAnchorMode() !== "epoch") {
    const expiresAtMs = record.timestamp + CLAIM_HORIZON_MS;
    const claimHash = `0x${sha256Hex(
      `${record.subjectHash}:${ctx.topPick.symbol}:${ctx.topPick.priceUsd}:${expiresAtMs}`,
    )}` as Bytes32Hex;
    try {
      const tx = await v2AnchorClaim(
        {
          subjectHash: record.subjectHash,
          claimHash,
          claimType: CLAIM_TYPES.PRICE_THESIS,
          domain: "crypto-trading",
          confidence: Math.round(ctx.topPick.score),
          expiresAtMs,
          evidenceHash: record.thesisHash,
          timestampMs: record.timestamp,
        },
        CLAIM_ATTACHED_MOTES,
      );
      state.pendingClaims.push({
        claimHash,
        subjectHash: record.subjectHash,
        symbol: ctx.topPick.symbol,
        priceAtCommitUsd: ctx.topPick.priceUsd,
        thresholdPct: CLAIM_THRESHOLD_PCT,
        anchoredAtMs: record.timestamp,
        expiresAtMs,
        anchorTxHash: tx,
        status: "pending",
        resolveAttempts: 0,
      });
      console.log(`  [Casper v2] PRICE_THESIS claim anchored: ${ctx.topPick.symbol} @ $${ctx.topPick.priceUsd} — ${tx.slice(0, 16)}…`);
    } catch (err) {
      console.warn(`  [Casper v2] anchor_claim failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Resolve due claims deterministically.
  for (const claim of state.pendingClaims) {
    if (claim.status !== "pending" || Date.now() < claim.expiresAtMs) continue;
    const price = ctx.getPriceUsd(claim.symbol);
    const outcome = price === null
      ? null
      : outcomeFor(claim.priceAtCommitUsd, price, claim.thresholdPct);
    if (outcome === null) {
      claim.resolveAttempts += 1;
      if (claim.resolveAttempts >= RESOLVE_MAX_ATTEMPTS) {
        claim.status = "dead";
        console.warn(`  [Casper v2] claim ${claim.claimHash.slice(0, 14)}… dead — no price for ${claim.symbol} after ${RESOLVE_MAX_ATTEMPTS} attempts`);
      }
      continue;
    }
    try {
      const resolutionHash = `0x${sha256Hex(
        `${claim.claimHash}:${price}:${outcome}:${Date.now()}`,
      )}` as Bytes32Hex;
      const tx = await v2ResolveClaim(claim.claimHash, outcome, resolutionHash);
      claim.status = "proposed";
      claim.proposedOutcome = outcome;
      claim.proposedAtMs = Date.now();
      claim.resolveTxHash = tx;
      console.log(`  [Casper v2] claim resolved ${outcomeName(outcome)}: ${claim.symbol} $${claim.priceAtCommitUsd} → $${price} — ${tx.slice(0, 16)}…`);
    } catch (err) {
      claim.resolveAttempts += 1;
      console.warn(`  [Casper v2] resolve_claim failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Finalize claims whose dispute window has closed.
  for (const claim of state.pendingClaims) {
    if (claim.status !== "proposed" || !claim.proposedAtMs) continue;
    if (Date.now() < claim.proposedAtMs + DISPUTE_WINDOW_MS) continue;
    try {
      const tx = await v2FinalizeResolution(claim.claimHash);
      claim.status = "finalized";
      console.log(`  [Casper v2] resolution finalized: ${claim.symbol} — ${tx.slice(0, 16)}…`);
    } catch (err) {
      console.warn(`  [Casper v2] finalize_resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 5. Anchor closed epochs. One deploy per epoch — the ledger files remain
  //    the full record, the chain stores the commitment.
  for (const epochId of pendingEpochs()) {
    try {
      const root = computeEpochRoot(epochId);
      const tx = await v2AnchorEpochRoot(epochId, root.merkleRoot, root.recordCount);
      markEpochAnchored(epochId, root.merkleRoot, root.recordCount, tx);
      console.log(`  [Casper v2] epoch ${epochId} anchored: ${root.recordCount} records → root ${root.merkleRoot.slice(0, 16)}… — ${tx.slice(0, 16)}…`);
    } catch (err) {
      console.warn(`  [Casper v2] anchor_epoch_root(${epochId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  saveV2State(state);
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/** Deterministic outcome for a price thesis: ≥ +threshold → VALIDATED,
 *  ≤ −threshold → INVALIDATED, inside the band → MIXED. */
export function outcomeFor(priceAtCommit: number, priceAtResolve: number, thresholdPct: number): ClaimOutcome {
  const changePct = ((priceAtResolve - priceAtCommit) / priceAtCommit) * 100;
  if (changePct >= thresholdPct) return CLAIM_OUTCOMES.VALIDATED;
  if (changePct <= -thresholdPct) return CLAIM_OUTCOMES.INVALIDATED;
  return CLAIM_OUTCOMES.MIXED;
}

function outcomeName(outcome: ClaimOutcome): string {
  return (Object.keys(CLAIM_OUTCOMES) as Array<keyof typeof CLAIM_OUTCOMES>).find(
    (k) => CLAIM_OUTCOMES[k] === outcome,
  ) ?? String(outcome);
}
