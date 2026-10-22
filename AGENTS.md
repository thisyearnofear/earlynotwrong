# AGENTS.md — Agent Orchestration Guide

> How AI agents should navigate and modify the Early, Not Wrong codebase.

## Project Overview

Three main entry points:

```
packages/conviction-core/  — Shared pure domain model (ledger, scoring, hashing)
agent/                   — Autonomous trading agent (Node.js, TypeScript, Hono)
src/                     — Next.js web app (frontend + API routes)
```

The **agent** is the autonomous trading core; the **web app** is its monitoring dashboard and the Conviction Analysis surface for end users. `packages/conviction-core` is the single source of truth for the conviction framework consumed by both.

The agent is also a **domain-agnostic harness**: `agent/lib/adapters/` maps
`HARNESS_DOMAIN` → a `DataSource`/`ConvictionFactors`/`TradeExecutor` triple.
`crypto` (BSC) is the live domain; `options` (Alpaca) is kept as the
proof-of-pattern for a second domain.

---

## Current Operational Status

> Last updated: 2026-10-19.

**Live:**

- **`earlynotwrong`** (pm2, port 31777, `HARNESS_DOMAIN=crypto`) — the BSC
  trading agent. The BNB hackathon window (2026-06-22 → 06-28) is long closed;
  the agent runs as the product. Revenue surfaces on the same loop:
  - **MCP + x402** — `score_wallet` is the hero paid SKU (0.5 CSPR);
    `get_subject_history` and `cross_chain_lookup` are paid; all other tools
    (including `get_live_signals`) are free distribution.
  - **CROO CAP** — `wallet-score` ($0.05 USDC on the CROO Store);
    `signals-live` ($0.01 Store-minimum nominal — distribution, not revenue).
  - **Anchoring receipts** — every meaningful thesis shift anchors to Mantle
    (ERC-8004) and Casper (ConvictionRegistry).
- **`earlynotwrong-options`** (pm2, port 31778, `HARNESS_DOMAIN=options`,
  `AGENT_DATA_DIR=agent/data-options`) — Alpaca paper-options agent. The
  hackathon closed 2026-09-04 at +2.28%; the process is kept reloadable as the
  harness's second-domain proof, not a revenue surface. `deploy.sh` reloads it
  only when it's already in the pm2 list. It shares the crypto agent's LLM
  ladder and loop but skips the CROO CAP client (domain guard in `index.ts`).

**Archived (code kept, processes off):**

- **`earlynotwrong-delphi`** (`agent/lib/delphi/`) — Gensyn Delphi Agent Arena,
  closed 2026-08-24 (rank 122/159). Gated by `DELPHI_ENABLED` at runtime;
  `deploy.sh` only starts it when `DELPHI_ENABLED=1`. Kept in-tree for the
  calibration machinery, the 4-tier evidence-validation stack, and the
  convergence-exit logic — see `docs/archive/DELPHI_AGENT_ARENA.md`. If reviving
  it for a new competition, note the arena-only knobs (`tournamentMode`,
  `endgameHoldFromUtc`, tournament sizing fractions) are not normal-mode safe.
- The `/agent` dashboard still renders the Delphi arena card (frozen
  "closed · final record" post-mortem) and the live options arena card.

Post-mortems for all three competitions: `docs/LESSONS.md`.

### Recently shipped (live surfaces only)

Competition-era changelog lives in `docs/LESSONS.md` and git history — entries
here only cover surfaces that still run.

- **Free signals-live + wallet-score hero SKU (`a91469af`)** — pricing
  rebalance: `score_wallet` became the paid MCP hero SKU (0.5 CSPR ≈ $0.05);
  `get_live_signals`/`signals-live` went free (CROO Store $0.01 floor). Rationale:
  live signals are distribution; wallet scoring is the product.
- **wallet-score hardening** — BSC chain support, Zerion EVM direction fix,
  gas-token legs priced via DexScreener out-leg, tolerance for status-less
  Zerion legs, dual-layer archetypes with plain-English gloss, Store pricing
  alignment. The MCP tool proxies to `POST /api/agent/wallet-score` in the web
  app where the Helius/Zerion fetch infra lives.
- **Harness adapter layer (`0980c911`)** — `agent/lib/adapters/`: three
  extension-point interfaces (`DataSource`, `ConvictionFactors`,
  `TradeExecutor`) + crypto wrappers + Alpaca options adapters + registry.
  `HARNESS_DOMAIN` switches domains; loop, LLM ladder, jury, self-analysis, and
  anchoring are domain-agnostic.
- **Alpaca options execution** — orders via the Alpaca CLI (hackathon
  "MCP or CLI" requirement) with automatic REST fallback; any non-hard-fail
  order status (`new`/`held`/`accepted`) counts as a successful submission;
  `reconcileHeldWithBroker()` adopts broker positions the order path missed so
  misclassified statuses can't orphan the book. `options-state.json` persists
  cycle count, ledger, and `peakUnrealizedPercent` across restarts.
- **Featherless LLM rung** — sponsor tier added to `llm-providers.ts` between
  the free tiers and paid keys (`FEATHERLESS_API_KEY`, OpenAI-compatible).
- **Edge report + buyer-agent** — `runEdgeReport()` runs the conviction
  strategy against a naive random-entry baseline; `hasEdge` requires a Sharpe
  beat *and* non-negative absolute return. `GET /edge-report` (30-min cache,
  `?fresh=1`) + lazy Signal Edge panel on `/agent`. `examples/buyer-agent/`
  does the full x402 payment round-trip with `--edge-report` pre-check and
  `--json` audit mode.
- **Casper anchoring reliability** — public `node.testnet.casper.network` is
  the primary RPC (cspr.cloud fallback); the jury digest is *quantized* so LLM
  jitter doesn't churn the thesis hash; `lastAnchoredThesisHash` persists across
  pm2 restarts; 30 CSPR balance gate returns `skipped` instead of burning gas.
- **LLM conviction jury (7th factor)** — `agent/lib/llm-jury.ts` adjusts top
  candidates ±15 after deterministic scoring; template mode (zero adjustments)
  when no provider is keyed.
- **TWAK harvest hardening** — exits/harvests share the fallback ladder
  (slippage 1%→10%→20%→49% → USDC hop → size probe); unexitable positions are
  marked `stuck`, blocklisted, and excluded from `maxOpenPositions`; tokens
  under $20k DexScreener liquidity get a real buy/sell probe before entry.
- **Discovery cohesion fix** — Discovery ranks by behavioral conviction score;
  Ethos ≥1000 is an anti-sybil access gate on `/api/alpha/*` only, never an
  ordering factor.

### Active ledger notes

> Point-in-time from the last VPS review — verify against live `state.json`
> before acting on these.

- **BSB** and **GWEI** remain marked stuck from prior cycles and are excluded
  from portfolio valuation and the active position cap.
- Positions last recorded active: **FET, USDC, SIREN, NEX, SLX**.

### Ongoing watchlist

- TWAK/LiquidMesh sometimes routes through pools where the wallet only has
  allowance on a different spender (e.g., 1inch `0x0000001fF...` vs LiquidMesh
  router `0x3d90...`). The entry probe detects this before a full entry.
- SoSoValue rate-limiting is **fixed**: a rolling-window limiter
  (`computeSsvThrottleWaitMs`) hard-caps 20 requests per trailing 60s, and
  jittered per-token snapshot TTLs (12h ± 2h) keep 147 expiries from landing in
  the same minute. Watch for regression if the token universe grows.
- Casper ecosystem MCP endpoints (`mcp.cspr.trade`, `mcp.cspr-ai.xyz`) were
  unreachable at last deploy. `casper-mcp-client.ts` degrades gracefully — the
  jury proceeds without cross-chain context; no code change needed if they
  come back.
- Casper operator CSPR balance was ~3,065 CSPR (funded 2026-07-23 from testnet
  faucet). Anchoring is active via the public RPC; thesis-hash dedup means
  anchors only fire on meaningful conviction shifts.

---

## Agent Architecture (`agent/`)

### Entry Points

| File / Module | Purpose |
|---------------|---------|
| `agent/index.ts` | Startup, main loop orchestrator (`.env` inline loader, `runCycle()`, `restoreSnapshot()`), domain guard (`HARNESS_DOMAIN`) |
| `agent/src/server.ts` | HTTP server (routes: `/status`, `/trades`, `/conviction`, `/edge-report`, `/delphi/status`, `/options/status`, `/signals/teaser`, `/casper/*`, `/mcp`, `/reputation/stats`, `/aleo/sign-voucher`, `/cap/status`) |
| `agent/src/mcp/` | MCP server + x402 paywall — exposes cross-chain conviction data to AI agents |
| `agent/src/cap/` | CROO Agent Protocol adapter — reputation services settled in USDC on Base |
| `agent/src/payment-stats.ts` | Shared A2A payment counters for x402 and CAP |
| `agent/lib/config.ts` | Single config object (`AGENT_CONFIG`), block-explorer URL builders |
| `agent/lib/agent-state.ts` | Shared mutable state (`state`), type interfaces, helper maps, utilities |
| `agent/lib/cycle-runner.ts` | All pipeline steps + helpers (`closePosition`, `finalizeExit`, `printCycleSummary`) |
| `agent/lib/data-providers.ts` | Composite market data: `CmcClient` (CMC Pro REST) + `SosovalueClient` (SoSoValue OpenAPI) |
| `agent/lib/dex-trading.ts` | SoDEX spot REST client + EIP-712 signing (`SodexClient`, `SodexNonceManager`) |
| `agent/lib/holders.ts` | On-chain holder counts (NodeReal JSON-RPC + CoinGecko fallback), growth computation |
| `agent/lib/conviction-signal.ts` | 7-factor contrarian conviction scoring engine (6 deterministic + LLM jury) |
| `agent/lib/llm-jury.ts` | LLM conviction jury — reviews top candidates, adjusts scores ±15, reasoning anchored on-chain |
| `agent/lib/llm-providers.ts` | Shared LLM ladder (`chatCompletion`) — free-first provider cascade used by jury, narrative, and the archived forecaster |
| `agent/lib/casper-mcp-client.ts` | Casper ecosystem MCP consumer — CSPR.trade DEX data + blockchain status as jury context |
| `agent/lib/risk-guardrails.ts` | Risk limits (drawdown, position size, daily count, concentration) |
| `agent/lib/twak-executor.ts` | TWAK CLI wrapper (trade execution, address resolution, portfolio) |
| `agent/lib/telegram.ts` | Telegram dispatch (3-message cycle summaries, startup, error alerts) |
| `agent/lib/persistence.ts` | SQLite Sync state persistence (cross-restart position ledger) |
| `agent/lib/errors.ts` | Standardized error types (`AgentError`, `TradeError`, `GuardrailError`, etc.) |
| `agent/lib/onchain-portfolio.ts` | On-chain portfolio reader — values BEP-20 positions TWAK can't see |
| `agent/lib/market-narrative.ts` | AI market narrative generation from SoSoValue feeds + macro events |
| `agent/lib/anchors/` | Cross-chain anchoring adapters — `MantleAnchorAdapter` + `CasperAnchorAdapter` |
| `agent/lib/self-analysis.ts` | Builds the agent's canonical trade ledger and scores its own behavior each cycle via `conviction-core` |
| `agent/lib/backtest.ts` | Backtest harness + **edge report** — conviction vs naive baseline, factor attribution of winning exits |
| `agent/lib/adapters/` | **Harness adapter layer** — the domain-pluggable boundary. Interfaces: `data-source.ts`, `conviction-factors.ts`, `executor.ts` (+ shared `types.ts`). Crypto wrappers: `sosovalue-adapter.ts`, `crypto-conviction.ts`, `twak-adapter.ts`. Options adapters: `alpaca-data.ts`, `options-conviction.ts`, `alpaca-executor.ts` (+ `alpaca-cli.ts`). `registry.ts` maps domain → adapter triple. See `docs/HARNESS_ARCHITECTURE_PLAN.md` |
| `agent/lib/harness-config.ts` | `resolveHarnessConfig()` reads `HARNESS_DOMAIN` (default `crypto`) → adapter triple; `DOMAIN_PROFILES` maps built-in domains |
| `agent/conviction-gym/` | **Conviction Gym** — RL environment extracted from the backtest physics (env owns physics only; all decisions are agent actions). Built for the HF×Reflection "Build with Beam" competition. TS reference impl + cross-validated Python Gymnasium port in `python/`. `export-episodes.ts` → `agent/data/episodes.json` (CoinGecko + alternative.me FGI, no proprietary API needed); `run-eval.ts` baselines; `beam.ts`/`run-beam.ts` run Beam-as-policy and record trajectory traces. See `agent/conviction-gym/README.md` |
| `agent/lib/delphi/` | **Archived** — Gensyn prediction-market surface (competition closed 2026-08-24). Kept for `lifecycle.ts`, `forecast-log.ts` calibration ledgers, `verification.ts`/`fact-check.ts`/`evidence-filter.ts`/`web-search.ts` evidence tiers, and the convergence-exit logic in `probability.ts`. Only runs when `DELPHI_ENABLED=1`; see `docs/archive/DELPHI_AGENT_ARENA.md` |

### Module Dependency Graph

```
index.ts
  └─ agent-state.ts ───┐
  └─ cycle-runner.ts ───┤
  └─ config.ts ─────────┤
  └─ data-providers.ts ─┤
  └─ errors.ts ─────────┤
  └─ telegram.ts ───────┤ (all leaf modules)
  └─ persistence.ts ────┤
  └─ cap/client.ts ─────┤
  └─ payment-stats.ts ──┘
  └─ (src/ imports)

cycle-runner.ts
  ├─ agent-state.ts
  ├─ config.ts
  ├─ data-providers.ts (cmcClient, sosovalueClient)
  ├─ dex-trading.ts (sodexClient)
  ├─ holders.ts (holder cache, fetchHolderCount)
  ├─ conviction-signal.ts (scoring engine)
  ├─ risk-guardrails.ts
  ├─ twak-executor.ts
  ├─ onchain-portfolio.ts
  ├─ anchors/index.ts (anchorAll, computeSubjectHash)
  ├─ market-narrative.ts (generateNarrative)
  ├─ telegram.ts (sendErrorAlert)
  ├─ errors.ts (summarizeError)
  └─ self-analysis.ts (recordAgentEntry, recordAgentExit)

self-analysis.ts
  └─ conviction-core (LedgerEntry, calculateBehavioralMetrics)

src/app/api/analyze/batch/route.ts
  └─ conviction-core (analyzePosition, calculateBehavioralMetrics)

src/lib/market.ts
  └─ conviction-core (LedgerEntry, LedgerPosition, BehavioralMetrics)

llm-jury.ts ─────────────┐
                         ├─ llm-providers.ts (chatCompletion — shared LLM ladder)
delphi/probability.ts ───┘   (delphi = archived)

adapters/ (harness domain layer)
  ├─ adapters/types.ts (shared domain-agnostic types: Kline, MarketSignal, ConvictionResult, …)
  ├─ adapters/data-source.ts (interface) ← sosovalue-adapter.ts, alpaca-data.ts
  ├─ adapters/conviction-factors.ts (interface) ← crypto-conviction.ts, options-conviction.ts
  ├─ adapters/executor.ts (interface) ← twak-adapter.ts, alpaca-executor.ts
  ├─ adapters/registry.ts → resolveAdapters(HARNESS_CONFIG) → AdapterBundle
  └─ harness-config.ts → resolveHarnessConfig() → HARNESS_CONFIG (domain = crypto | options)
```

### Trading Loop (8 Steps)

1. **Fetch portfolio** from TWAK + augment with on-chain BEP-20 positions
2. **Fetch market data** — SoSoValue token prices (preferred) + CMC global metrics & derivatives (composite)
3. **Score market regime + token conviction**: Fear & Greed (CMC v3), funding rates (CMC v5), then 6-factor per-token scoring:
   - Contrarian (30) — rewards assets down 7d during fear
   - RSI timing (10) — synthesized RSI(14) from 7d return; bonus for oversold
   - Quality (20) — market cap × liquidity filter
   - Regime (20) — fear & greed + funding rate composite
   - Holder growth (10) — on-chain holder base expansion (NodeReal + CoinGecko)
   - Volatility penalty — subtracted for erratic 7d price paths
3b. **LLM conviction jury + Casper MCP context** — the 7th factor:
   - Fetch Casper ecosystem context via MCP (CSPR.trade DEX prices + blockchain network status)
   - An LLM reviews top candidates with cross-chain context
   - Adjusts conviction scores ±15 based on market context the deterministic scoring can't capture
   - Reasoning digest included in the thesis hash anchored on Casper
   - Template mode (zero adjustments) when no API key is configured
4. **Manage open positions** — tiered exits:
   - `HOLD` through ordinary drawdown ("early, not wrong")
   - `EXIT_PARTIAL` at +50% gain — sell 33%, let the rest ride (capital recycling)
   - `EXIT_STOP` at −35% — thesis invalidated, cap the loss
   - `EXIT_TRAIL` at +100% peak → 30% give-back — lock the asymmetry
4b. **Harvest for BNB** — when BNB balance < `bankroll.harvestMinBnbUsd` (default $6) or over capacity, sell the weakest mature position. **Fallback ladder:**
   - Primary: position → BNB direct swap
   - Fallback A: position → USDC → BNB (deeper USDC liquidity on BSC)
   - Fallback B: size probe ($0.50 then $1) to diagnose tax-token reverts
   - Final: Telegram alert + 5-cycle cooldown on the broken token
5. **Create trade proposals** — top-K tokens by conviction score with DEX liquidity check. **Bankroll-aware sizing:** per-trade cap = `min(portfolio × 15%, (BNB − reserve) × 50%)`. Entries skipped when BNB < `entrySkipBelowBnbUsd` (default $4.50).
6. **Check guardrails** — drawdown, daily limit, position concentration. Adaptive sizing: each guardrail rejection reduces the next proposal by 20% per token.
7. **Execute trades** — SoDEX testnet preferred → TWAK fallback. Pre-flight BNB re-check with reserve enforcement. Linear retry backoff (1s, 2s).
8. **Anchor to Mantle + Casper** — submit thesis hash + score to both ERC-8004 registry and Casper ConvictionRegistry (sequential per-adapter).
8b. **Generate market narrative** — AI-composed headline + summary from SoSoValue feeds and macro events.
8c. **Self-analysis** — the agent builds a canonical ledger of its own entries/exits and runs `conviction-core`'s `calculateBehavioralMetrics`, surfacing its own behavioral conviction score in `/status` and on the dashboard.

### Key Patterns

- **Simulator mode**: Auto-detected when `TWAK_ACCESS_ID` is not set. Uses in-memory mock portfolio.
- **Composite market data**: SoSoValue token prices are preferred (higher refresh rate); CMC fills missing tokens and provides Fear & Greed / funding rates that SoSoValue doesn't offer. CMC's per-token quote pull (a 147-token batch) is deferred — `cycle-runner.fetchMarketData()` only calls `cmcClient.getEligibleTokenQuotes()` as a fallback when SoSoValue returns no prices, so a healthy SoSoValue run spends ~0 CMC credits on token quotes (CMC is still used every cycle for global metrics + derivatives, which SoSoValue lacks).
- **Holder data (on-chain conviction)**: NodeReal MegaNode JSON-RPC (`nr_getTokenHolderCount`, 50 CUs/call) is the primary source; CoinGecko token info (`holders.count`) is the fallback. Results cached in `agent/data/holders.json`; growth computed over 7d lookback after 24h+ of snapshots. Agent pre-scores tokens to target the top 15 candidates, not the full universe. The CoinGecko fallback is rate-limited (`COINGECKO_MIN_INTERVAL_MS = 12s`) with a 10-min per-contract cache in `holders.ts`, so a NodeReal outage can't cascade into a CoinGecko 429 storm.
- **Shared conviction framework**: Pure ledger types and behavioral scoring live in `packages/conviction-core`. Both the agent self-analysis and the web wallet analyzer consume the same `calculateBehavioralMetrics` / `analyzePosition` / `calculatePatienceTax` functions. `calibration.ts` adds the prediction-market yardstick (`brierScore` / `logLoss` / `hitRate` / `reliabilityBuckets`) — used by the archived Delphi status reader. Do not duplicate scoring logic in `src/` or `agent/`.
- **Harness adapter layer** (`agent/lib/adapters/`): The agent is an **agentic harness** — a proven autonomous agent architecture that can be plugged into any market domain. The core loop, LLM ladder, jury, self-analysis, and anchoring are all domain-agnostic. Three extension points are the plug-in boundary: `DataSource` (fetch market data), `ConvictionFactors` (score a signal), and `TradeExecutor` (place & manage trades). `HARNESS_DOMAIN` env var switches domains at runtime (default: `crypto`). `resolveAdapters(HARNESS_CONFIG)` returns the adapter triple; the registry throws a clear error for unregistered adapters. New domains register in `DOMAIN_PROFILES` (`harness-config.ts`) and the factory maps (`registry.ts`). See `docs/HARNESS_ARCHITECTURE_PLAN.md`.
- **Shared LLM ladder**: all LLM calls (token jury, market narrative, archived Delphi surfaces) go through `agent/lib/llm-providers.ts` (`chatCompletion`). Provider order, free-first: **vercel-gateway** (promo credit; circuit breaker skips on 402) > **openrouter** (`:free`-pinned model; 50 req/day, resets 00:00 UTC) > **b-ai** (`BAI_API_KEY`, free DeepSeek tier) > **orcarouter** ($0, rate-limited, slow) > **featherless** (`FEATHERLESS_API_KEY`, sponsor credits) > **openai** > **anthropic**. Per-provider circuit breakers: 402 trips a breaker, quota-exhaustion 429s break until the next 00:00 UTC, transient 429/503 self-heal via `Retry-After`-aware `fetchWithBackoff`. Do not add per-module fetch plumbing for new LLM surfaces — extend the ladder there.
- **No fabricated fallback data**: Showcase/demo wallets use real public addresses only. Do not add fabricated traders, heatmaps, or percentile defaults to fill empty UI states. Return `null` and show an honest empty state instead.
- **Cross-chain anchoring**: Same `ConvictionRecord` payload sent to Mantle (EVM, viem) and Casper (casper-js-sdk). Hashes computed once via `conviction-core`'s `computeSubjectHash` / `computeThesisHash` — same hash on every chain.
- **Telegram dispatch**: 3-message cycle summary with HTML formatting (`<pre>`, `<code>`, `<b>`). Non-blocking `.catch(() => {})` — env-vars-gated startup/cycle/error alerts.
- **Guardrails**: Pure in-memory state with daily counter reset. Hard limits from `AGENT_CONFIG.trading`.
- **Bankroll management**: BNB reserve + adaptive interval doubling (4h → 8h) when BNB drops below `targetBnbUsd`.
- **Position reconciliation**: at startup, `restoreSnapshot()` cross-checks `state.heldPositions` against live TWAK portfolio and drops ghost positions. The options domain reconciles against the Alpaca broker instead (`reconcileHeldWithBroker`).
- **Portfolio parser**: Reads `$USD` column from TWAK's column-aligned output. Covered by regression test in `__tests__/twak-executor.test.ts`.
- **TWAK reliability**: The agent resolves the `twak` binary from common install paths (`~/.local/bin`, `~/.twak/bin`, `/usr/local/bin`) in addition to `PATH`. If TWAK is missing, misconfigured, or the wallet is locked, startup diagnostics print the exact failure and a remediation hint. The cycle still runs: portfolio falls back to the on-chain reader, and trades are skipped rather than crashing the loop.
- **Agent-to-agent (A2A)**:
  - MCP server at `/mcp` with Streamable HTTP transport + x402 paywall. 8 tools — free: `get_latest_conviction`, `get_by_thesis`, `get_agent_reputation`, `get_jury_deliberation`, `get_live_signals`; paid (x402 CEP-18): `get_subject_history`, `cross_chain_lookup`, `score_wallet` (hero SKU — proxies to the web app's wallet-score endpoint). Pricing table: `agent/src/mcp/pricing.ts`. The agent also **consumes** 2 Casper ecosystem MCP servers (CSPR.trade + blockchain) as jury context — bidirectional MCP participant.
  - CROO CAP client fulfills six serviceIds: `wallet-score` ($0.05) and `signals-live` ($0.01 Store-floor nominal) are Store-listed; four `reputation-*` services are MCP-only pre-registered IDs (do not rename). Store orders arrive as UUIDs — map via `CROO_SERVICE_UUID_MAP` / `CROO_<SERVICE>_SERVICE_UUID` env vars (`resolveCapServiceId`). See `docs/CROO_INTEGRATION.md`.

### Important Conventions

- All `agent/lib/` imports use `.js` extension (ESM modules compiled from `.ts`).
- Never import Next.js path aliases (`@/`) in agent code.
- Env vars use `TWAK_` prefix (not `TW_`). The portal calls them `TW_ACCESS_ID` and `TW_HMAC_SECRET`, but the agent reads `TWAK_ACCESS_ID` and `TWAK_HMAC_SECRET`.
- `execSync` → prefer `execAsync` for long-running operations (trade execution still uses `execSync` due to TWAK CLI limitations).
- Tests live in `agent/__tests__/` — Vitest framework (~740 tests across 43 files).
- `agent/data/state.json` is a runtime artifact — it's in `.gitignore` and should not be committed. If `git status` shows it as modified, run `git rm --cached agent/data/state.json`.
- `agent/data/payment-stats.json` — persisted A2A payment counters (x402 + CAP); survives pm2 restarts.
- `agent/data-options/` — the options domain's own data dir (separate from the crypto agent's `agent/data/`).
- `GET /signals/teaser` (and `/signals/preview` alias) — public guidance preview only; full `signals-live/v1.2` is via CROO or MCP.
- `agent/data/holders.json` is a runtime cache — also gitignored.
- `agent/docs/api/` is TypeDoc output — gitignored, regenerate via `npm run docs`.

### SoSoValue API Efficiency

SoSoValue rate limits: **20 req/min**, **100,000 req/month** per API key. The agent historically bursts ~150 individual `/currencies/{id}/market-snapshot` calls per cycle, which trips the per-minute limit.

`SosovalueClient` (`agent/lib/data-providers.ts`) mitigates this with tiered, **disk-persisted** caching (`AGENT_DATA_DIR/sosovalue-cache.json`). Persistence means deploys/restarts don't trigger cold-start bursts:

| Cache | TTL | Purpose |
|-------|-----|---------|
| Currency ID list | 1 h | Symbol → ID resolution (API returns `currency_id`) |
| Market snapshots | 12 h | Avoid re-fetching 150+ snapshots every 4h cycle |
| Daily klines | 4 h | RSI input changes once per day |
| Hot news | 2 h | Shared between sentiment + narrative |
| Featured news | 2 h | Shared between sentiment + narrative |
| Macro events | 4 h | Shared between guardrail pause + narrative |
| Index list / snapshot / constituents | 1 h | SSI regime signal |

  Additional protections:

  - If `SOSOVALUE_API_KEY` is missing, all SoSoValue calls short-circuit and CMC/fallback data is used.
  - **Rolling-window rate limiter** (`computeSsvThrottleWaitMs` in `data-providers.ts`) wraps every `ssvRestGet` call and hard-caps 20 requests in any trailing 60s — the same metric SoSoValue enforces.
  - **Debounced disk writes** — rapid cache updates coalesce into one `sosovalue-cache.json` write 500ms after the last update, so a 147-snapshot cold fill doesn't perform 147 sync writes.
  - A circuit breaker tracks consecutive 401/403/429 responses. After 3 failures, SoSoValue is suspended for 15 minutes.
  - `fetchKlinesBySymbol` is only called for the top 10 conviction candidates and only when `SOSOVALUE_API_KEY` is set.
  - A per-cycle HTTP request counter logs actual SoSoValue API usage at the end of each cycle.

If you rotate the key, restart the process so the singleton client picks it up and resets the suspension.

---

## Casper Anchoring

The agent publishes conviction records to a Casper testnet contract. Because every anchor is an on-chain transaction, the operator key (`CASPER_OPERATOR_PEM`) must hold enough CSPR to pay the deploy's gas reserve.

- **Payment cap vs. actual cost:** `AGENT_CONFIG.casper.testnet.paymentMotes` is the *maximum* gas the deploy may consume (currently 50 CSPR). Casper refunds unused gas, so the actual execution cost is much lower (~0.5 CSPR for a contract call). Do not treat `paymentMotes` as spent gas.
- **Balance gate:** `CasperAnchorAdapter.anchor()` queries the operator's main-purse balance before building the transaction. If the balance is below `minOperatorBalanceMotes` (currently 30 CSPR), the adapter returns `skipped` with a clear message instead of submitting a guaranteed-failure transaction. This preserves RPC quota and avoids log noise.
- **429 backoff on balance check:** when the RPC rate-limits the balance check, the adapter enters exponential backoff (15m→30m→1h→2h→4h cap) and serves the last cached balance instead of hammering the RPC every cycle. Resets on the first successful query.
- **RPC fallback chain:** `AGENT_CONFIG.casper.testnet.rpcUrls` is an ordered list tried by the `rpc()` helper and `buildRpcClient()`. Primary: `node.testnet.casper.network` (public, no auth, no quota). Fallback: `node.testnet.cspr.cloud/rpc` (needs `CSPR_CLOUD_TOKEN`, free-tier 1,200 req/day). The `casper-mcp-client.ts` consumer uses the same chain. `CSPR_CLOUD_TOKEN` is no longer strictly required for `isAvailable()`.
- **If anchors start failing with `-32016 Invalid transaction`:** the operator account is likely empty or below the minimum balance. Fund it from the Casper testnet faucet, or remove `casper` from `AGENT_CONFIG.anchoring.adapters` to disable it.
- **Thesis-hash dedup (quantized):** `cycle-runner` skips `anchorAll()` entirely when the thesis hash is identical to the last successfully anchored one. The jury digest is *quantized* (5-pt adjustment buckets, agreement→sign, drop neutrals, sort by symbol) so LLM output jitter doesn't churn the hash — only a meaningful verdict shift triggers a re-anchor. `lastAnchoredThesisHash` is persisted across pm2 restarts so the dedup survives bounces.

---

## TWAK Harvesting & Honeypot Handling

When the agent needs BNB for gas or has hit the open-position cap, `harvestForBnb()` sells the weakest mature position. If a position cannot be exited, it is eventually marked **stuck** so the bot stops burning gas and stops it from blocking new entries.

### Pre-entry execution probe (thin-liquidity tokens)

For tokens with DexScreener liquidity below `entryProbe.minLiquidityUsdForSkip` (default $20k), the agent performs a real **buy/sell probe** before opening a full position:

1. Buy `$entryProbe.amountUsd` of the token with BNB.
2. Immediately sell the exact bought amount back to BNB.
3. Reject the token if either leg reverts or if the round-trip loss (spread/tax, excluding gas) exceeds `entryProbe.maxAcceptableLossPercent`.

This catches quote-only false positives such as the UAI allowance/spender mismatch (`SafeTransferFromFailed`). If the sell leg fails outright, the symbol is added to `stuckSymbols` so the agent never re-enters. Probes use a very wide slippage (`entryProbe.slippageBps`, default 49%) so execution, not slippage, is the gate.

High-liquidity tokens (≥ $20k pool) skip the probe to avoid unnecessary gas.

### Exit/harvest fallback ladder

Both exits and harvests use the same retry ladder:

1. Direct swap to BNB at default slippage (1%)
2. Retry at 10% / 20% / 49% slippage (tax-token / low-liquidity tokens)
3. Route through USDC (often deeper liquidity on BSC)
4. Harvest only: tiny size-probe ($0.50 → $1) with the same slippage ladder

If every path reverts, the position is marked `stuck` and its symbol is added to `stuckSymbols` (blocklist).

### Position cap no longer counts stuck tokens

`maxOpenPositions` used to count stuck/honeypot positions, so an 8-slot cap could be silently consumed by unexitable tokens. The cap now looks at **active** positions only (`!p.stuck && !stuckSymbols.has(p.symbol)`), freeing up slots for real opportunities.

### Diagnosing `execution reverted: 0xf4059071`

That selector is `SafeTransferFromFailed()` — a router-level failure. Common causes:

- **Honeypot / blacklist:** token transfer reverts for non-whitelisted sellers.
- **Insufficient allowance:** TWAK's chosen router/spender changed; re-approve via `twak approve` if you believe the token is legitimate.
- **Bad route / fake pool:** the router picked an illiquid or bait pair (e.g., a PancakeSwap pair against a fake "Subject 3" token). This is not a honeypot token per se, but the on-chain path is unusable.

If a token persistently fails every fallback, the agent will mark it stuck. To manually force a retry, remove its symbol from `stuckSymbols` in memory or restart the process (the blocklist is rebuilt from persisted `p.stuck` flags).

---

## TWAK Troubleshooting

TWAK is the Trust Wallet Agent Kit CLI (`twak`). The agent uses it for BSC swaps, token search, and wallet reads.

### Install / update

```bash
curl -fsSL https://agent-kit.trustwallet.com/install.sh | bash
```

Common install paths: `~/.local/bin/twak`, `~/.twak/bin/twak`, `/usr/local/bin/twak`. The agent checks these automatically in addition to `PATH`.

### Required env vars

| Var | Purpose |
|-----|---------|
| `TWAK_ACCESS_ID` | API access ID from portal.trustwallet.com |
| `TWAK_HMAC_SECRET` | API HMAC secret from portal.trustwallet.com |
| `TWAK_WALLET_PASSWORD` | Password for the TWAK agent wallet (or use `twak wallet keychain save`) |
| `AGENT_WALLET_KEY` | Optional address override. If unset, the agent reads `twak wallet address --chain=bsc`. |
| `TWAK_TESTNET=1` | Optional — point swaps at BSC testnet instead of mainnet. |

### Wallet must exist

If `twak wallet address --chain=bsc` fails, create a wallet:

```bash
twak wallet create --password <pw>
```

Then either save it to the OS keychain (`twak wallet keychain save`) or set `TWAK_WALLET_PASSWORD`.

### Diagnostics

On startup the agent runs `twakExecutor.healthCheck()` and prints each check:

```
TWAK:        ○ (live)
              binary=~/.local/bin/twak version=twak v0.12.0
              credentials=ok
              wallet_address=0xA1Dd...
```

If a step fails, the log includes a `TWAK help:` line with the exact fix. The cycle continues in degraded mode (no trades, but analysis + anchoring still run) rather than crashing.

---

## Web App Architecture (`src/`)

- **Framework**: Next.js 16 with App Router
- **State**: Zustand store (`src/lib/store.ts`)
- **UI**: Tailwind CSS v4 + `framer-motion` + `lucide-react`
- **Styling**: CSS custom properties in `globals.css` — `--signal`, `--patience`, `--impatience`, `--ethos`
- **API routes**: Server-side only (API keys never reach the client)

### Key UI Components

| Component | Purpose |
|-----------|---------|
| `page.tsx` | Main conviction analysis page |
| `navbar.tsx` | Navigation + Ethos tier badge + search + theme toggle |
| `wallet-search-input.tsx` | Wallet/ENS/Farcaster search |
| `scan-progress.tsx` | Animated progress during analysis |
| `terminal.tsx` | Technical trace log during scan |
| `reputation-tier-card.tsx` | Ethos tier display with perks |
| `position-explorer.tsx` | Detailed position table |
| `aleo-conviction-card.tsx` | Aleo private ZK proof card |
| `mantle-conviction-card.tsx` | Mantle anchored conviction card |
| `casper-wallet-connect.tsx` | In-browser Casper Wallet connect + sign proof (uses `window.CasperWalletProvider` injected by the extension) |
| `agent/signal-edge-panel.tsx` | Signal Edge panel — conviction vs naive baseline head-to-head + factor attribution (Proof view) |
| `agent/options-arena-card.tsx` | Options agent card — live Alpaca domain status (Proof view) |
| `agent/delphi-arena-card.tsx` | Delphi Prediction Arena card — frozen post-mortem state since the arena closed 2026-08-24 (Proof view) |
| `agent/llm-jury-card.tsx` | LLM Conviction Jury card — 7th factor verdicts (extracted from agent page) |
| `agent/buyer-preview-card.tsx` | Buyer preview — public signals-live teaser (guidance + top symbol) |
| `agent/reputation-api-card.tsx` | MCP · x402 reputation API card — query stats, per-tool pricing, copy-paste curls |
| `agent/croo-cap-card.tsx` | CROO · CAP marketplace card — Store listing, USDC settlement stats, requester snippet |
| `agent/hire-card-shared.ts` | Shared types/helpers/constants for the hire-view cards (`ReputationStats`, `formatCspr`, MCP curl snippets) |
| `agent/agent-types.ts` | Shared agent dashboard types (`ConvictionData`, `LlmDeliberation`, etc.) — extracted so card components don't import the god component |

## Common Tasks

### Adding an env var
1. Add to `agent/manifest.json` `secrets` array
2. Add to `agent/lib/config.ts` if agent-side (or read via `process.env.YOUR_VAR` at module scope)
3. Add to `agent/.env.example` with a placeholder value

### Adding a route
1. Add to `agent/manifest.json` `routes` array (Port 31777)
2. Add handler in `agent/src/server.ts`
3. Must return JSON — agent loop polls these for dashboard state

### Adding a pipeline step
1. Implement the step function in `agent/lib/cycle-runner.ts` — reads/writes `state` from `agent-state.ts`
2. Export it and import it in `agent/index.ts` — wire it into `runCycle()` in the correct step position
3. Add console logging for observability

### Adding a chain adapter
1. Implement `AnchorAdapter` interface in a new file under `agent/lib/anchors/` (see `mantle.ts` or `casper.ts`)
2. Register the adapter in `agent/lib/anchors/index.ts` `ADAPTER_REGISTRY`
3. Add chain config to `AGENT_CONFIG` in `config.ts`
4. Add the adapter name to `AGENT_CONFIG.anchoring.adapters`

### Adding a domain adapter (harness)
1. Implement the three adapter interfaces (`DataSource`, `ConvictionFactors`, `TradeExecutor`) in new files under `agent/lib/adapters/` (see the crypto wrappers or the Alpaca options adapters)
2. Add the domain profile to `DOMAIN_PROFILES` in `agent/lib/harness-config.ts` (maps domain name → adapter triple)
3. Register the adapter factories in the maps in `agent/lib/adapters/registry.ts` (`DATA_SOURCES`, `CONVICTION_FACTORS`, `EXECUTORS`)
4. Export the new adapters from `agent/lib/adapters/index.ts`
5. Set `HARNESS_DOMAIN=<your-domain>` at runtime to switch; the registry resolves the adapter triple and throws a clear error if any adapter is missing
6. The loop, LLM ladder, jury, self-analysis, and anchoring require **no changes** — they're domain-agnostic

## Deployment

- Build: `npm run build` (runs `tsc`)
- Start: `node dist/index.js`
- Port: 31777 (crypto) / 31778 (options); Hono HTTP server

### Deploying to the server (`nuncio-vultr`)

The server's `/home/linuxuser/earlynotwrong` is a **git checkout** of this repo
(no more hand-scp). Deploy with the script:

```bash
cd agent
./deploy.sh                 # deploys origin/main
./deploy.sh <commit-sha>    # pin an exact commit for auditability
```

The script runs on the server: `git fetch` → `git checkout -f <ref>` →
`npm ci && npm run build` in `packages/conviction-core` (consumed via a `file:`
dependency whose devDependencies are not installed by `npm ci` in the agent) →
`npm ci` → `rm -rf dist && npm run build` → `pm2 reload earlynotwrong
--update-env`. Build runs before the reload, so a failed build never restarts a
working process. `npm run deploy` is an alias. Rollback = `git checkout <prev>`
on the server.

Process handling after build:

- `earlynotwrong` — always reloaded.
- `earlynotwrong-options` — reloaded only when already in the pm2 list (a
  missing process is non-fatal).
- `earlynotwrong-delphi` — only started when `DELPHI_ENABLED=1`; otherwise left
  stopped (the archived runner would self-exit and pm2 autorestart would churn
  it). For a permanent closeout: `pm2 delete earlynotwrong-delphi` and set
  `DELPHI_ENABLED=0` in `agent/.env`.

`agent/ecosystem.config.cjs` documents all three pm2 apps. The live
`earlynotwrong` process is still managed by name (`pm2 reload earlynotwrong`)
so its injected env vars are preserved — do **not** switch it to start from
`ecosystem.config.cjs` unless you also migrate those env vars into the file.

## TypeDoc Documentation

```bash
cd agent
npm run docs        # generate docs/api/
npm run docs:serve  # serve locally via npx serve
```

- Config: `agent/typedoc.json`
- Output: `agent/docs/api/` (gitignored)
