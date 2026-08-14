# Product Plan — `wallet-score` (behavioral conviction scoring as a service)

> Status: **planned, building.** Companion to `CROO_INTEGRATION.md`.
>
> Origin: the `signals-live` CROO product under-delivers because it sells the
> commodity (token picks) and gives away the scarce thing (behavioral
> conviction scoring) as metadata. This doc is the plan to fix that by
> productizing the scarce thing directly.

## The problem with `signals-live` today

`signals-live` answers **"what should I buy this cycle?"** — the most crowded
question in crypto. Every Telegram signal group and free screener answers some
version of it. The differentiator (on-chain anchoring, behavioral scoring) is
buried in a `provenance` block a cold buyer has no reason to trust on first
contact. And the product quality is gated on the agent's own thin track record
(~24 trades, 42.5% win rate) — a skeptic reads `provenance.behavioral.metrics`
and notices.

Meanwhile the thing that's actually rare — **behavioral conviction scoring of
arbitrary wallets** (win rate, patience tax, archetype: Iron Pillar vs
Exit Voyager vs Profit Phantom) — already exists in `packages/conviction-core`
and already runs on the web at `/analyzer` and `/api/analyze/batch`. It's just
not on the CROO store or the MCP surface.

## The product: `wallet-score`

**One sentence:** send me a wallet address, get back its behavioral conviction
score with on-chain proof.

```
buyer agent / tester / fund
        │  POST { address, chain }
        ▼
  score-wallet tool  ──► fetch on-chain trade history (Helius / Zerion)
        │                reconstruct ledger (entries + exits)
        │                run conviction-core: analyzePosition + calculateBehavioralMetrics
        │                cohort percentile vs all scanned wallets
        ▼
  { score, archetype, winRate, patienceTax, upsideCapture,
    positions[], cohortPercentile, proofHash, explorerUrls }
```

### Why this is the right product to lead with

| | `signals-live` (current) | `wallet-score` (proposed) |
|---|---|---|
| Scarce? | No — token picks are commodity | Yes — behavioral conviction scoring is rare |
| Gated on agent's own track record? | Yes (thin: ~24 trades) | No — scores *others'* wallets |
| Already built? | Yes, shipping | 90% — `conviction-core` + `/api/analyze/batch` exist |
| Fits CROO Test & Earn? | OK | Strong — instantly testable on a known wallet |
| Differentiator visible on first contact? | Buried in `provenance` | The whole product |

### What the buyer gets

A `wallet-score/v1` JSON payload:

```jsonc
{
  "schema": "wallet-score/v1",
  "subject": { "chain": "base", "address": "0x…", "resolvedName": "vitalik.eth" },
  "score": 68,                          // 0–100 behavioral conviction
  "archetype": "Iron Pillar",    // iron-pillar | profit-phantom | exit-voyager | diamond-hand
  "metrics": {
    "winRate": 42.5,
    "upsideCapture": 61.2,
    "patienceTaxUsd": 1234.56,          // $ left on the table by exiting early
    "holdingPeriodDays": 14.2,
    "totalPositions": 12,
    "realizedPnlUsd": 540.20
  },
  "cohort": {
    "percentile": 23,                   // top 23% of scanned wallets on this chain
    "cohortSize": 1842
  },
  "positions": [ /* per-token: entry/exit, patience tax, realized PnL, early-exit flag */ ],
  "proof": {
    "ledgerHash": "0x…",               // keccak of the reconstructed ledger
    "computedAt": 1721296920000,
    "frameworkVersion": "conviction-core@1.x",
    "verifiableAt": "https://earlynotwrong.vercel.app/analyzer?w=0x…"
  },
  "guidance": "Iron Pillar — holds through drawdown, captures most upside. Patience tax is the leak."
}
```

The `proof.ledgerHash` is the key trust artifact: a hash of the reconstructed
ledger the buyer can independently recompute from on-chain data. It's the same
"prove it on-chain" ethos as the Casper/Mantle anchoring, applied to the
*input* rather than the agent's own output.

## Architecture — where it lives

The wallet-position-fetching logic (Helius for Solana, Zerion/Alchemy for Base)
already lives in the **web app's** `marketService` (`src/lib/services/market-service.ts`),
not the agent. The agent only has BSC on-chain reads (viem). So `wallet-score`
lives in the **web app**, exposed as:

1. **`POST /api/agent/wallet-score`** — a new Next.js API route. Reuses
   `marketService` (position fetch) + `conviction-core` (scoring) + the
   existing cohort-percentile query. This is the same code path as
   `/api/analyze/batch`, just packaged as a clean request/response with the
   `wallet-score/v1` schema instead of the web UI's internal shape.
2. **MCP tool `score_wallet`** — registered in the agent's MCP server, but
   implemented as a thin HTTP call to the web app's `/api/agent/wallet-score`.
   This keeps the agent as the single MCP entry point (buyers already know
   `agent.croo.network` / the MCP URL) while the heavy lifting stays in the
   web app where the position-fetching infra already exists.
3. **CAP service `wallet-score`** — registered on the CROO Agent Store at
   $0.05 USDC. The CAP handler routes to the same MCP tool, same as
   `signals-live` does today.

```
CROO Store / MCP buyer
        │
        ▼
  agent MCP server  ──score_wallet──►  POST /api/agent/wallet-score  (web app)
        │                                       │
        │                               marketService.fetchWalletHistory (Helius/Zerion)
        │                                       │
        │                               conviction-core.analyzePosition + calculateBehavioralMetrics
        │                                       │
        │                               getCohortPercentile (Postgres)
        │                                       ▼
        ◄──────────────── wallet-score/v1 JSON ──
```

### Why not put it all in the agent?

The agent is a BSC trading bot. Its on-chain reads are viem/BSC-only. Solana
(Helius) and Base (Zerion/Alchemy) position fetching is web-app infra that
already works and is already cohort-backed by Postgres. Duplicating it in the
agent would be a large build with no payoff. The MCP-tool-as-HTTP-proxy pattern
keeps the agent as the protocol surface (one URL for buyers) without forcing
the data infra to move. This is the same shape as `get_live_signals` reading
live agent state — the tool is a thin wrapper over where the data actually
lives.

## Build steps

### Phase 1 — the web API (the product)

- [ ] **`src/lib/wallet-score.ts`** — a pure function that takes
      `{ address, chain }`, calls `marketService` to fetch positions, runs
      `conviction-core`'s `analyzePosition` + `calculateBehavioralMetrics`,
      fetches the cohort percentile, and returns a `WalletScoreV1` object.
      This is a refactor of the logic currently inline in
      `/api/analyze/batch/route.ts` into a reusable, schema-shaped function.
      The route stays as the web UI's consumer; the new function is the
      shared core.
- [ ] **`POST /api/agent/wallet-score`** — thin route: validate
      `{ address, chain }`, call the function, return `wallet-score/v1` JSON.
      Rate-limited (IP + address) to prevent abuse. No auth — it's a paid
      product via MCP/CROO, and the rate limit + the CROO paywall are the
      gate.
- [ ] **`schemas/wallet-score-v1.schema.json`** — public JSON Schema, same
      pattern as `signals-live-v1.2.schema.json`.
- [ ] **`docs/samples/wallet-score-v1.example.json`** — sample payload.

### Phase 2 — the MCP + CAP surface (the distribution)

- [ ] **`score_wallet` MCP tool** in `agent/src/mcp/tools.ts` — thin HTTP
      call to the web app's `/api/agent/wallet-score`. Input:
      `{ address: string, chain: "solana" | "base" }`. Output: the
      `wallet-score/v1` JSON as text content. Registered in
      `agent/src/mcp/server.ts`.
- [ ] **`wallet-score` CAP service** in `agent/src/cap/pricing.ts` —
      `$0.05 USDC`, mapped to the `score_wallet` tool. Handler branch in
      `agent/src/cap/handler.ts` (parse `requirements` for address + chain,
      call the tool, deliver JSON text).
- [ ] **CROO Store listing** for `wallet-score` — paste-ready copy in
      `docs/croo-store-listing-wallet-score.md`. Self-contained for a cold
      buyer (no prior knowledge of ENW required), unlike the reputation-lookup
      services that need a known `subjectHash`.

### Phase 3 — the tester flow (CROO Test & Earn)

- [ ] **`--test-wallet` mode** in `examples/buyer-agent/index.mjs` — runs
      one `wallet-score` order on a famous public wallet (e.g. vitalik.eth,
      or a known smart-money address), pretty-prints the result, prints the
      inline feedback prompt. This is the second testable service for Test &
      Earn testers — two genuinely different products from one agent.
- [ ] **Update `FEEDBACK.md`** with the wallet-score feedback questions.

### Phase 4 — the edge report as a product (later, separate doc)

The edge report (`GET /edge-report`) is the third differentiated product —
"does this signal have demonstrable edge?" — but it's a separate build
(scoring *other agents'* signals, not wallets). Tracked here as a future
phase; not in scope for this plan.

## Pricing

| Service | Price | Rail | Why |
|---|---|---|---|
| `wallet-score` | $0.05 USDC | CROO CAP + MCP x402 | Same as `signals-live` — a single, complete, actionable answer. Cheap enough to try, expensive enough to filter tire-kickers. |
| `reputation-agent` | $0 (free) | MCP only | Stays free — it's the trust-decision on-ramp. |

`wallet-score` is the new premium product alongside `signals-live`. A buyer
who wants the agent's own signals buys `signals-live`; a buyer who wants to
score *their own* wallet (or a copy-trader's, or a treasurer's) buys
`wallet-score`. Two products, two audiences, one framework.

## What this is NOT

- **Not a copy of `/analyzer`.** The web `/analyzer` is a full interactive
  UI (terminal, position explorer, share dialog). `wallet-score` is the
  *API* — the same scoring, packaged as a clean JSON payload for agents. The
  web UI consumes the same `wallet-score.ts` core function.
- **Not gated on the agent's track record.** It scores *other* wallets. The
  agent's own ~24-trade history is irrelevant to whether it can score yours.
- **Not a build from scratch.** `conviction-core`, `marketService`, the cohort
  query, and the CAP/MCP plumbing all exist. This is packaging + one new
  route + one new tool + one new CAP service.

## Success criteria

- A CROO tester can run `npm run test-wallet` and get a behavioral score for
  vitalik.eth (or any public address) in under 30 seconds, with a JSON payload
  they can read and a feedback prompt they can answer.
- The `wallet-score/v1` payload is valid against its JSON Schema.
- The score for a known wallet matches what `/analyzer` produces for the same
  wallet (same core function, same result).
- `signals-live` and `wallet-score` are two distinct CROO Store listings,
  each testable in one command.

## Operational checklist (tick when done)

- [ ] **Register `wallet-score` on the CROO Agent Store** using the copy in
      `docs/croo-store-listing-wallet-score.md` (same flow as `signals-live`).
- [ ] **Set the CROO service UUID env var** for wallet-score on the VPS — if
      CROO uses UUIDs in `serviceId`, add it to `CROO_SERVICE_UUID_MAP` (or a
      new `CROO_WALLET_SCORE_SERVICE_UUID`) so `resolveCapServiceId` maps it
      to the `wallet-score` slug. See `agent/src/cap/pricing.ts`.
- [ ] **Deploy the web app** — the new `/api/agent/wallet-score` route ships
      with the Next.js app (Vercel). Confirm the route is live:
      `curl https://earlynotwrong.vercel.app/api/agent/wallet-score`.
- [ ] **Deploy the agent** — `cd agent && ./deploy.sh`. The `score_wallet`
      MCP tool + `wallet-score` CAP service ship with the agent. Confirm the
      MCP tool is registered: `GET /mcp` should list `score_wallet`.
- [ ] **Set `WALLET_SCORE_URL` on the agent** (VPS env) if not the default
      `https://earlynotwrong.vercel.app/api/agent/wallet-score`. For local
      dev, set it to `http://localhost:3000/api/agent/wallet-score`.
- [ ] **Smoke test end-to-end** — `cd examples/buyer-agent && npm run
      test-wallet` against the live agent. Should return a `wallet-score/v1`
      payload for vitalik.eth.
- [ ] **Update `docs/CROO_INTEGRATION.md`** — mark `wallet-score` as
      Store-listed once the listing is live (currently says "planned").
- [ ] **Update `AGENTS.md`** — add `wallet-score` to the CAP services table
      and the module dependency graph (`src/lib/wallet-score.ts`, the new
      route).
