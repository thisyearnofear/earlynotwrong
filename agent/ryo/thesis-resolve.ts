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
    receipt?: { ts: string; index: number; prevHash: string; hash: string };
    verify: { ledger: string; command: string; chain_intact_at_resolve: boolean };
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

export function thesisResolve(input: ThesisResolveInput): ThesisResolveResult {
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
        verify: { ledger: "agent/data/ryo-ledger.jsonl", command: "npx tsx agent/ryo/run.ts --verify", chain_intact_at_resolve: chain.ok },
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
        verify: { ledger: "agent/data/ryo-ledger.jsonl", command: "npx tsx agent/ryo/run.ts --verify", chain_intact_at_resolve: chain.ok },
      },
      summary: {
        headline: `Thesis on ${thesis.symbol} already resolved`,
        points: ["a RESOLVE entry already references this commitment — resolutions are one-shot, keeping debates honest"],
      },
      availability: { ledger: "ok" },
      warnings: ["duplicate resolution refused — a thesis resolves exactly once"],
    };
  }

  const convictionDelta = input.outcome === "validated" ? 1 : input.outcome === "invalidated" ? -1 : 0;
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
      original_thesis: thesis.reason,
      resolve_after: thesis.evidence?.resolve_after ?? null,
      evidence_refs: input.evidence_refs ?? [],
      caller: "external",
    },
  );

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
      receipt: { ts: entry.ts, index: chain.entries, prevHash: entry.prevHash, hash: entry.hash },
      verify: { ledger: "agent/data/ryo-ledger.jsonl", command: "npx tsx agent/ryo/run.ts --verify", chain_intact_at_resolve: chain.ok },
    },
    summary: {
      headline: `Thesis on ${thesis.symbol} resolved: ${input.outcome}`,
      points: [
        `committed ${thesis.ts} → resolved ${entry.ts}`,
        `original thesis chained at ${thesis.hash.slice(0, 12)}…`,
        `one-shot resolution: this commitment cannot be re-scored`,
      ],
    },
    availability: { ledger: chain.ok ? "ok" : "partial" },
    warnings: chain.ok ? [] : ["chain reported broken — resolution recorded, but audit before citing"],
  };
}

// ─── CLI surface ────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("thesis-resolve.ts")) {
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
  const out = thesisResolve({ commitment, outcome, note: opt("note"), evidence_refs: opt("evidence")?.split(",") });
  console.log(JSON.stringify(out, null, 2));
}
