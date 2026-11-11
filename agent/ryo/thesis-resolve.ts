/**
 * thesis_resolve — the second half of the debate primitive (Track 3).
 *
 * thesis_commit locks reasoning before the move; thesis_resolve closes the
 * loop: given a commitment hash, it records the outcome the thesis actually
 * met. Two agents committing opposing theses on one symbol now have a
 * resolvable debate — reputation built on a trail you can't edit after the
 * fact. That is the SocialFi loop RYO lacks.
 *
 * Same public envelope + call convention as thesis_commit and the six
 * published tools (POST /tools/thesis_resolve/call).
 *
 *   npx tsx agent/ryo/thesis-resolve.ts \
 *     --commitment a1582c4a… --outcome validated \
 *     --note "HYPE +18% within the 72h window — dip thesis paid"
 */
import { existsSync, readFileSync } from "node:fs";
import { LEDGER_PATH, record, verifyChain, type LedgerEntry } from "../lib/adapters/ryo-ledger.js";
import { RyoClient } from "../lib/adapters/ryo-client.js";

function num(obj: unknown, ...keys: string[]): number | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
        if (keys.some((f) => k.toLowerCase().includes(f)) && typeof v === "number") return v;
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return undefined;
}

export interface ThesisResolveInput {
  /** The commitment (or receipt hash) returned by thesis_commit. */
  commitment: string;
  /** How the thesis resolved. "expired" = horizon passed, no clear outcome. */
  outcome: "validated" | "invalidated" | "mixed" | "expired";
  /** Optional resolution note — what actually happened. */
  note?: string;
  /** Optional evidence digests/URIs for the resolution. */
  evidence_refs?: string[];
}

export interface ThesisResolveResult {
  schema_version: string;
  tool: "thesis_resolve";
  status: "ok" | "partial" | "unavailable";
  data_mode: "local-ledger";
  as_of: string;
  request: ThesisResolveInput;
  data: {
    resolved: boolean;
    thesis: { commitment: string; symbol: string; thesis: string; ts: string; receiptHash: string } | null;
    price_check?: {
      price_at_commit: number | null;
      price_at_resolve: number | null;
      move_pct: number | null;
      computed_outcome: string | null;
      claimed_outcome: string;
      agreed: boolean | null;
    };
    receipt?: { ts: string; index: number; prevHash: string; hash: string };
    verify: { hash_spec: string; status_url: string; audit_url: string; ledger: string; command: string; chain_intact_at_resolve: boolean };
  };
  summary: { headline: string; points: string[] };
  availability: Record<string, string>;
  warnings: string[];
}

function ledgerEntries(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LedgerEntry);
}

const OUTCOMES = new Set(["validated", "invalidated", "mixed", "expired"]);

const VERIFY = (chainOk: boolean, commitment: string) => ({
  hash_spec: "entry.hash = sha256(prevHash + JSON.stringify(entry, sorted-keys-canonical)); chain prevHash links genesis→head",
  status_url: `/ryo/commitment/${commitment}`,
  audit_url: "/ryo/verify",
  ledger: "agent/data/ryo-ledger.jsonl",
  command: "npx tsx agent/ryo/run.ts --verify",
  chain_intact_at_resolve: chainOk,
});

/** Outcome derived from the price move — what the evidence says, not what
 *  the caller claims. |±5%| is the validated/invalidated band. */
function computedOutcome(movePct: number): "validated" | "invalidated" | "mixed" {
  if (movePct >= 5) return "validated";
  if (movePct <= -5) return "invalidated";
  return "mixed";
}

export async function thesisResolve(input: ThesisResolveInput, client?: RyoClient): Promise<ThesisResolveResult> {
  const commitment = (input.commitment ?? "").trim();
  if (!commitment) throw new Error("thesis_resolve: commitment is required");
  if (!OUTCOMES.has(input.outcome)) {
    throw new Error(`thesis_resolve: outcome must be one of ${[...OUTCOMES].join(", ")}`);
  }

  const entries = ledgerEntries();
  const thesis = entries.find(
    (e) =>
      e.action === "THESIS" &&
      (e.hash === commitment ||
        (typeof e.evidence?.commitment === "string" && e.evidence.commitment === commitment) ||
        e.hash.startsWith(commitment) ||
        (typeof e.evidence?.commitment === "string" && e.evidence.commitment.startsWith(commitment))),
  );

  const chain = verifyChain();
  const alreadyResolved = thesis
    ? entries.some((e) => e.action === "RESOLVE" && e.evidence?.resolves === thesis.hash)
    : false;

  if (!thesis) {
    return {
      schema_version: "1.0",
      tool: "thesis_resolve",
      status: "unavailable",
      data_mode: "local-ledger",
      as_of: new Date().toISOString(),
      request: input,
      data: {
        resolved: false,
        thesis: null,
        verify: VERIFY(chain.ok, commitment),
      },
      summary: {
        headline: `No thesis found for commitment ${commitment.slice(0, 12)}…`,
        points: ["the commitment does not exist on this ledger — nothing was resolved"],
      },
      availability: { ledger: chain.ok ? "ok" : "partial" },
      warnings: ["commitment not found — check the hash or the ledger you are resolving against"],
    };
  }

  if (alreadyResolved) {
    return {
      schema_version: "1.0",
      tool: "thesis_resolve",
      status: "partial",
      data_mode: "local-ledger",
      as_of: new Date().toISOString(),
      request: input,
      data: {
        resolved: false,
        thesis: {
          commitment,
          symbol: thesis.symbol,
          thesis: thesis.reason,
          ts: thesis.ts,
          receiptHash: thesis.hash,
        },
        verify: VERIFY(chain.ok, commitment),
      },
      summary: {
        headline: `Thesis on ${thesis.symbol} already resolved`,
        points: ["a RESOLVE entry already references this commitment — resolutions are one-shot, keeping debates honest"],
      },
      availability: { ledger: "ok" },
      warnings: ["duplicate resolution refused — a thesis resolves exactly once"],
    };
  }

  // Evidence check: when the commit captured price_at_commit and the market
  // API is reachable, compute the outcome from the actual move and compare
  // it with the caller's claim. A disagreement is recorded, not hidden —
  // resolutions are evidence-checked, not self-reported.
  const priceAtCommit = typeof thesis.evidence?.price_at_commit === "number" ? (thesis.evidence.price_at_commit as number) : null;
  let priceAtResolve: number | null = null;
  let movePct: number | null = null;
  let computed: string | null = null;
  let agreed: boolean | null = null;
  const warnings: string[] = [];

  if (client && priceAtCommit != null) {
    const a = await client.tool("analyze_token", { symbol: thesis.symbol }).catch(() => null);
    const px = a ? num(a.data, "price_usd", "price", "usd") : undefined;
    if (px != null) {
      priceAtResolve = px;
      movePct = ((px - priceAtCommit) / priceAtCommit) * 100;
      computed = computedOutcome(movePct);
      agreed = computed === input.outcome;
      if (!agreed) {
        warnings.push(`price check disagrees: claimed "${input.outcome}" but ${thesis.symbol} moved ${movePct.toFixed(1)}% ($${priceAtCommit} → $${px}) — computed "${computed}". Recorded as claimed, flagged as contested.`);
      }
    } else {
      warnings.push(`price_at_resolve unavailable (${a?.status ?? "call failed"}) — outcome recorded as claimed, unverified`);
    }
  } else if (priceAtCommit == null) {
    warnings.push("no price_at_commit on the original thesis — outcome can't be price-checked");
  }

  const convictionDelta = (computed ?? input.outcome) === "validated" ? 1 : (computed ?? input.outcome) === "invalidated" ? -1 : 0;
  const entry = record(
    0,
    thesis.symbol,
    "RESOLVE",
    convictionDelta,
    `${input.outcome}: ${input.note?.trim() ?? "no note"}`.slice(0, 500),
    {
      resolves: thesis.hash,
      commitment,
      outcome: input.outcome,
      claimed_outcome: input.outcome,
      computed_outcome: computed,
      contested: agreed === false ? true : undefined,
      price_at_commit: priceAtCommit,
      price_at_resolve: priceAtResolve,
      move_pct: movePct != null ? Math.round(movePct * 100) / 100 : null,
      original_thesis: thesis.reason,
      resolve_after: thesis.evidence?.resolve_after ?? null,
      evidence_refs: input.evidence_refs ?? [],
      caller: "external",
    },
  );

  if (!chain.ok) warnings.unshift("chain reported broken — resolution recorded, but audit before citing");

  return {
    schema_version: "1.0",
    tool: "thesis_resolve",
    status: chain.ok ? "ok" : "partial",
    data_mode: "local-ledger",
    as_of: entry.ts,
    request: input,
    data: {
      resolved: true,
      thesis: {
        commitment,
        symbol: thesis.symbol,
        thesis: thesis.reason,
        ts: thesis.ts,
        receiptHash: thesis.hash,
      },
      price_check: {
        price_at_commit: priceAtCommit,
        price_at_resolve: priceAtResolve,
        move_pct: movePct != null ? Math.round(movePct * 100) / 100 : null,
        computed_outcome: computed,
        claimed_outcome: input.outcome,
        agreed,
      },
      receipt: { ts: entry.ts, index: chain.entries, prevHash: entry.prevHash, hash: entry.hash },
      verify: VERIFY(chain.ok, commitment),
    },
    summary: {
      headline: `Thesis on ${thesis.symbol} resolved: ${input.outcome}${agreed === false ? ` (contested — price says ${computed})` : ""}`,
      points: [
        `committed ${thesis.ts} → resolved ${entry.ts}`,
        movePct != null ? `price evidence: $${priceAtCommit} → $${priceAtResolve} (${movePct.toFixed(1)}%) → ${computed}` : "price check unavailable — outcome as claimed",
        `one-shot resolution: this commitment cannot be re-scored`,
      ],
    },
    availability: { ledger: chain.ok ? "ok" : "partial", price_check: movePct != null ? "ok" : "unavailable" },
    warnings,
  };
}

// ─── CLI surface ────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const commitment = opt("commitment");
  const outcome = opt("outcome") as ThesisResolveInput["outcome"] | undefined;
  if (!commitment || !outcome) {
    console.error("usage: thesis-resolve.ts --commitment HASH --outcome validated|invalidated|mixed|expired [--note \"...\"] [--evidence ref1,ref2]");
    process.exit(2);
  }
  const out = await thesisResolve({ commitment, outcome, note: opt("note"), evidence_refs: opt("evidence")?.split(",") }, process.env.RYO_MCP_KEY ? new RyoClient() : undefined);
  console.log(JSON.stringify(out, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith("thesis-resolve.ts")) {
  main();
}
