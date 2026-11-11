/**
 * thesis_commit — Track 3 (New Skills) tool for the RYO-CHAN platform.
 *
 * A research primitive RYO doesn't have: tamper-evident commitment of an
 * agent's reasoning *before* the market moves. Any agent calls this tool,
 * gets back a hash-chained receipt proving its thesis existed at time T —
 * "early, not wrong" as a platform primitive.
 *
 * Spec conformance (docs/MCP-Builder-Guide.md): the tool returns RYO's own
 * public envelope — {schema_version, tool, status, data_mode, as_of,
 * request, data, summary, availability, warnings} — and mounts at the same
 * call convention (POST /tools/thesis_commit/call). Dropping it onto the
 * platform's surface requires no caller-side changes and no adoption of
 * our ledger: the receipt embeds the hashes plus a verify recipe in `data`.
 *
 *   npx tsx agent/ryo/thesis-commit.ts --symbol HYPE \
 *     --thesis "RSI 34 + 14% 7d drawdown — oversold mean-reversion" \
 *     --conviction 76 --horizon 72
 */
import { sha256, record, verifyChain } from "../lib/adapters/ryo-ledger.js";
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

/** RYO public result envelope — identical top-level contract to the six
 *  published tools, so platform mounting is mechanical. */
export interface ThesisCommitResult {
  schema_version: string;
  tool: "thesis_commit";
  status: "ok" | "partial" | "unavailable";
  data_mode: "local-ledger";
  as_of: string;
  request: ThesisCommitInput;
  data: {
    commitment: string;
    receipt: { ts: string; index: number; prevHash: string; hash: string };
    resolve_after: string | null;
    price_at_commit: number | null;
    verify: { hash_spec: string; status_url: string; audit_url: string; ledger: string; command: string; chain_intact_at_commit: boolean };
  };
  summary: { headline: string; points: string[] };
  availability: Record<string, string>;
  warnings: string[];
}

export async function thesisCommit(input: ThesisCommitInput, client?: RyoClient): Promise<ThesisCommitResult> {
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  if (!symbol || symbol.length > 14) throw new Error("thesis_commit: invalid symbol");
  if (!input.thesis?.trim()) throw new Error("thesis_commit: thesis is required");
  if (input.conviction !== undefined && (input.conviction < 0 || input.conviction > 100)) {
    throw new Error("thesis_commit: conviction must be 0–100");
  }

  // Price at commit — the reference point thesis_resolve later checks the
  // claimed outcome against. Absent the market call it stays null (named in
  // warnings) rather than fabricating a 0.
  let priceAtCommit: number | null = null;
  const warnings: string[] = [];
  if (client) {
    const a = await client.tool("analyze_token", { symbol }).catch(() => null);
    const px = a ? num(a.data, "price_usd", "price", "usd") : undefined;
    if (px != null) priceAtCommit = px;
    else warnings.push(`price_at_commit unavailable (${a?.status ?? "call failed"}) — resolution can't be price-checked later`);
  } else {
    warnings.push("no market credential — price_at_commit unrecorded, resolution will be claimed-unverified");
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
      price_at_commit: priceAtCommit,
      caller: "external",
    },
  );

  if (!chain.ok) {
    warnings.unshift("chain reported broken at commit time — receipt records it; do not cite this commitment as clean provenance");
  }

  return {
    schema_version: "1.0",
    tool: "thesis_commit",
    status: chain.ok ? "ok" : "partial",
    data_mode: "local-ledger",
    as_of: entry.ts,
    request: input,
    data: {
      commitment,
      receipt: { ts: entry.ts, index: chain.entries, prevHash: entry.prevHash, hash: entry.hash },
      resolve_after: resolveAfter,
      price_at_commit: priceAtCommit,
      verify: {
        // Self-contained: a caller verifies WITHOUT this repo — recompute
        // the hash spec below, or just GET the live commitment/audit URLs.
        hash_spec: "entry.hash = sha256(prevHash + JSON.stringify(entry, sorted-keys-canonical)); chain prevHash links genesis→head",
        status_url: `/ryo/commitment/${commitment}`,
        audit_url: "/ryo/verify",
        ledger: "agent/data/ryo-ledger.jsonl",
        command: "npx tsx agent/ryo/run.ts --verify",
        chain_intact_at_commit: chain.ok,
      },
    },
    summary: {
      headline: `Thesis on ${symbol} committed — sha256:${commitment.slice(0, 12)}… chained at #${chain.entries}`,
      points: [
        `commitment covers symbol+thesis+conviction+horizon+evidence refs`,
        `chain-intact at commit: ${chain.ok}`,
        priceAtCommit != null ? `price at commit: $${priceAtCommit}` : "price at commit unavailable — resolution unverified",
        resolveAfter ? `resolvable after ${resolveAfter}` : `no resolution window set`,
      ],
    },
    availability: { ledger: chain.ok ? "ok" : "partial", market_price: priceAtCommit != null ? "ok" : "unavailable", anchor: "optional" },
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
  const symbol = opt("symbol");
  const thesis = opt("thesis");
  if (!symbol || !thesis) {
    console.error("usage: thesis-commit.ts --symbol SYM --thesis \"...\" [--conviction N] [--horizon H] [--evidence ref1,ref2]");
    process.exit(2);
  }
  const out = await thesisCommit(
    {
      symbol,
      thesis,
      conviction: opt("conviction") ? Number(opt("conviction")) : undefined,
      horizon_hours: opt("horizon") ? Number(opt("horizon")) : undefined,
      evidence_refs: opt("evidence")?.split(","),
    },
    process.env.RYO_MCP_KEY ? new RyoClient() : undefined,
  );
  console.log(JSON.stringify(out, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith("thesis-commit.ts")) {
  main();
}
