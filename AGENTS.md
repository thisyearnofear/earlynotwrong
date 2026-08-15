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

---

## Current Operational Status

> Last updated: 2026-08-15. Live commit on `nuncio-vultr`: `2716f994` (SDK timeout fix after the 13.5h hung-runner incident; Delphi runner live on competition-testnet with the 1,000 TST bankroll, hourly cycles).

### Recently shipped

- **SDK timeout fix — hung runner incident (`2716f994`)** — `agent/lib/delphi/executor.ts`, `runner.ts`, `telegram.ts`. The Delphi SDK has **no timeout of its own** (verified in source); a single hung RPC/subgraph request froze the competition runner for ~13.5h on 2026-08-15 (process online, 0% CPU, no cycles) — right after the 1,000 TST bankroll landed. Now every SDK call in the executor is bounded by `withTimeout` (`sdkTimeoutMs`, default 60s, retryable via the existing backoff), Telegram sends get a 10s AbortSignal, and `start()` wraps `runCycle` in a 50-minute cycle watchdog so any unforeseen hang abandons the cycle instead of killing the loop. 528 tests green.
- **Inference cost + efficiency hardening (`9e8da4fe`, pre-trading audit)** — `agent/lib/llm-providers.ts`, `delphi/runner.ts`, `delphi/web-search.ts`, `delphi/probability.ts`, `llm-jury.ts`, `market-narrative.ts`. Four changes, all driven by "optimize while everything is still free": (1) **Forecast cache** — the runner keys each LLM estimate on `marketAddress + implied probs bucketed to 2¢ + briefing fingerprint`; unchanged markets reuse the prior ensemble at zero inference cost (TTL 6h, pruned per cycle, deliberately in-process only). Vol-anchored markets are never cached (the anchor moves with spot). Cycle #2 baseline: 14 markets × 3 samples ≈ 42 gateway calls/hr → expected near-zero steady-state after the cache warms. (2) **Promo expiry guard** — `vercelGatewayFreeActive()` drops the Vercel AI Gateway from the ladder on/after `VERCEL_GATEWAY_PROMO_ENDS` (default 2026-08-28, day after GLM free window ends), so nothing can silently start billing; Exa briefings gate off with it. (3) **429/5xx backoff** — `fetchWithBackoff` (2s→4s, max 2 retries) on every ladder call; cycle #2's three "Delay was aborted" aborts now retry instead of degrading the ensemble. (4) **Free-model pinning** — the OpenRouter account holds *paid credits* (`is_free_tier=false`), and `openrouter/auto` on a credited account routes to PAID models; the jury, forecaster, and narrative defaults are now pinned to `nvidia/nemotron-3-ultra-550b-a55b:free` (verified live in the catalog 2026-08-14). Briefing cache TTL raised 6h→12h. `estimatesCached` counter surfaced in the snapshot, `/delphi/status`, the arena card, and Telegram. 522 agent tests green.
- **Delphi live-market fixes (`744114b`)** — `agent/lib/delphi/executor.ts` (`mapSdkMarket`), `runner.ts`, `vol-baseline.ts`, `probability.ts`. Found on the first live cycle after `DELPHI_ENABLED=1` (wallet `0x884c…dEa9` registered + funded, API key validated against 29 competition markets): (1) the SDK nests `question`/`outcomes` under `market.metadata` — flat top-level fields only exist in test fakes — so the runner's `market.question` read was `undefined` and **every market was silently skipped** (`estimates=0` despite 14 open markets). `listOpenMarkets` now normalizes SDK-shaped markets to flat fields and passes through `resolvesAt`. (2) Multi-outcome markets (4-way BTC price bands) were being forced onto a hardcoded `["Yes","No"]` — the estimate input now uses the real outcome labels, and the forecaster system prompt instructs sum-to-1 across all outcomes. (3) The vol baseline now detects threshold **direction** ("above"/"higher" vs "below"/"at or below"); "below"-phrased markets get the complement (1−P), ambiguous phrasing gets no baseline at all — no blend beats a flipped blend. Runner went live on the VPS (`DELPHI_ENABLED=1`, hourly cycles, pm2 save + boot service enabled); the starting $TST bankroll is distributed daily post-registration, so sizing guards keep cycles safe until it lands. 503 agent tests green.
- **Discovery cohesion fix (`097575a7`)** — `src/lib/db/postgres.ts`, `src/app/discovery/page.tsx`, `src/components/alpha/alpha-trader-card.tsx`, `src/lib/ethos.ts`, `src/lib/services/ethos-cache.ts`. The one surface that inverted the product thesis: Discovery ranked wallets by conviction × Ethos social multiplier (up to 1.5×) and filtered the token heatmap on Ethos ≥ 1000. Now `getAlphaTraders` orders by behavioral conviction score (patience tax as tiebreaker) and `getTokenHeatmap` filters the cohort on behavioral score ≥ 60 — same yardstick as the trader list. Ethos ≥ 1000 remains the access gate on `/api/alpha/*` (anti-sybil) but never affects ordering; UI copy says so explicitly ("Conviction, verified by behavior"; tabs "Behavioral leaders" / "Cohort holdings"; trader card shows Patience Tax instead of Cred-Weighted). Dead multiplier machinery deleted: `ethosMultiplier`/`weightedScore` (postgres), `calculateReputationWeighting`/`ReputationWeightedMetrics` (ethos.ts) + its zero-caller pass-through (ethos-cache.ts). Leaderboard was already behavioral — no change.
- **Delphi Agent Arena gap closure (`529c7bbf`)** — `agent/lib/delphi/`, `packages/conviction-core/src/calibration.ts`, `src/components/agent/delphi-arena-card.tsx`. The Gensyn Delphi prediction-market competition entry (trading window 2026-08-10 → 2026-08-24) is code-complete through Phase 4b:
  - **Shared LLM ladder**: `agent/lib/llm-providers.ts` (`chatCompletion`) now owns the OpenRouter > OpenAI > Anthropic plumbing for both the token jury (`llm-jury.ts`) and the Delphi forecaster (`delphi/probability.ts`). One place for model defaults/timeouts.
  - **On-chain anchoring**: `delphi/anchoring.ts` quantizes the cycle's decisions (edges in 0.05 buckets, neutrals dropped, sorted), hashes via the shared `computeSubjectHash`/`computeThesisHash` scheme, and publishes through the existing Mantle + Casper adapters (`subjectHash = delphi:competitionGateway`). Thesis-hash dedup persists in the snapshot across pm2 restarts — anchors only fire on meaningful view shifts, never on LLM jitter.
  - **Calibration ledger**: resolved redemptions feed `forecasts.jsonl` (payout > 0 → win, 0 → loss; expired/failed markets and multi-outcome ambiguity are closed *without* scoring). `packages/conviction-core/src/calibration.ts` computes Brier, log-loss, hit rate, and 10-bin reliability buckets — the yardstick promised by the strategy doc ("calibration, not Sharpe").
  - **Dashboard surfacing**: `GET /delphi/status` (disk-backed reader in `delphi/status.ts` — the runner is a separate pm2 process) + Vercel proxy allowlist + the `Prediction Arena` card in the `/agent` Proof view (lazy fetch, real data only, honest empty states before the runner's first cycle and before forecasts resolve).
  - **Go-live is still blocked on Phase 0** (wallet registration + testnet gas + `DELPHI_API_ACCESS_KEY`), then the one-shot smoke test per `docs/DELPHI_AGENT_ARENA.md`.
- **Delphi alpha stack — free-first inference + five edge sources (Phase 4c)** — `agent/lib/delphi/web-search.ts` + `vol-baseline.ts`, extended `probability.ts` / `executor.ts` / `runner.ts`, `ai` SDK (`@ai-sdk/gateway` tools), shared `parseLenientJson`. The Vercel AI Gateway (`VERCEL_AI_GATEWAY_API_KEY`, GLM 5.2 free through 08-27, Exa search free through 08-31) leads the provider ladder; paid keys stay wired as fallback. Per market: (1) an Exa-sourced web briefing is injected into the forecaster prompt (10/cycle budget + 6h cache — verified live: it moved the BTC-$150k estimate from ~0.35 to ~0.02 against a $63k spot); (2) crypto threshold markets get a driftless log-normal reference probability from realized SoSoValue vol, blended at w=0.35; (3) the edge gate is category-aware (crypto 0.08 → culture 0.14); (4) forecasts are 3-sample ensembles combined by per-outcome median; (5) open positions are re-quoted every cycle and sold into convergence (take profit at forecast−2¢, thesis stop at entry−10¢) via the new `quoteSell`/`sellShares` executor surface. The runner entry now side-effect-imports `env-bootstrap` so `agent/.env` keys are live in its own process; every estimate carries a `ForecastProvenance` (model, ensemble size, web evidence, vol anchor) surfaced as tags on the Prediction Arena card and per-cycle evidence counts in the Telegram summary. Gateway quirks: no `response_format`, always send `reasoning.effort`, JSON may be fenced. 503 agent tests green.
- **pm2 entry-point fix for the Delphi runner** — under pm2 the child's `process.argv[1]` is the launcher container (`ProcessContainerFork.js`), not the script, so the original argv-based entry guard never fired and `earlynotwrong-delphi` had been importing, skipping `start()`, and idling silently since first deploy. The guard now accepts the pm2 container case; diagnosed on the VPS via a boot probe printing `argv[1]`.
- **wallet-score — behavioral conviction scoring as a paid product (`d8486513`)** — `src/lib/wallet-score.ts`, `POST /api/agent/wallet-score`, MCP `score_wallet`, CAP `wallet-score` serviceId. Second SKU: score **any** wallet (win rate, patience tax, archetype, cohort percentile, verifiable keccak256 ledger hash) instead of selling the agent's own picks. $0.05 USDC on the CROO Store; the MCP tool proxies to the web endpoint where the Helius/Zerion fetch infra lives. Buyer-agent gained `--test` / `--test-wallet` modes + `FEEDBACK.md` for CROO Test & Earn testers. Plan + listing copy in `docs/WALLET_SCORE_PLAN.md` / `docs/croo-store-listing-wallet-score.md`; schema at `/schemas/wallet-score-v1.schema.json` (score is a 1-decimal number).
- **Edge-report integrity fix (`8a9f8fe4`)** — `agent/lib/backtest.ts`. The per-regime `hasEdge` now requires non-negative return *and* a Sharpe beat, same bar as the overall report — a fear segment where conviction loses less than naive no longer masquerades as "edge in fear".

- **Edge report + buyer-agent integration (`8c92520d`, `085dd3c7`, `d501ae95`)** — `agent/lib/backtest.ts` + `examples/buyer-agent/`.
  - `runEdgeReport()` runs the conviction strategy alongside a **naive random-entry baseline** (same risk rules, no scoring) and attributes winning-exit P&L to the leading conviction factor. `hasEdge` requires conviction to beat naive on Sharpe *and* be non-negative in absolute return — a strategy that just loses less isn't edge.
  - `GET /edge-report` (30-min response cache, `?fresh=1` bypass) answers "does the signal have demonstrable edge?" on demand.
  - **Stale-kline fallback**: when SoSoValue 429s trip the circuit breaker, `loadHistoricalDataDetailed` serves the disk kline cache (TTL-agnostic) before going synthetic — the live endpoint reports `dataSource: "live-stale"` with real history instead of silently going synthetic.
  - **Kline timestamp normalization**: SoSoValue returns kline timestamps as **strings of milliseconds** despite the interface claiming number-seconds; `normalizeKline()`/`normalizeKlineTimestamp()` fix it at ingest (`fetchKlines`) and on legacy-cache read (`getCachedKlines`). This was a latent bug in the original `loadHistoricalData` that silently produced 0 backtest days the first time real klines ever flowed through it.
  - The `examples/buyer-agent/` example is a production-hardened allocator: free trust gate → optional `--edge-report` pre-check (skip the paid call if no edge) → x402 paid signals → act with own sizing. `--json` (JSONL audit for cron), full x402 payment round-trip, `DEPLOYMENT.md`.

- **Signal Edge dashboard panel + agent page component extraction** — `src/components/agent/signal-edge-panel.tsx` + `llm-jury-card.tsx` + `agent-types.ts`. The `/agent` dashboard's Proof view now surfaces a live "Signal Edge" panel: conviction vs naive baseline head-to-head table, verdict banner, and factor-attribution bar chart (which conviction factor drove the winning exits). The 2,751-line `agent/page.tsx` god component was reduced to 1,846 lines (−33%) by extracting: the `ConvictionData` type to a shared `agent-types.ts` (reusable by card components), `LlmJuryCard`, `BuyerPreviewCard`, `ReputationApiCard`, `CrooCapCard`, and their shared types/helpers/constants (`ReputationStats`, `formatCspr`, `formatUsdc`, MCP curl snippets) to `hire-card-shared.ts`. Each card is now independently testable. The `SignalEdgePanel` loads lazily (opt-in backtest run) so it doesn't block the dashboard's critical path.
- **Buyer-agent integration hardened for production** — `examples/buyer-agent/`. The allocator decision flow now implements the full x402 payment round-trip: when `CASPER_PRIVATE_KEY_HEX` is set, it gets the 402 challenge, constructs the `X-PAYMENT` header (with a real signed CEP-18 transfer via `casper-js-sdk` when installed, or an observable unsigned envelope otherwise), and re-POSTs to settle. Added `--json` mode (machine-readable JSONL audit for cron), `--edge-report` pre-check (skip the paid call if the signal has no demonstrable edge), a `bin` entry (`enw-buyer`), `optionalDependencies` on `casper-js-sdk`, and `DEPLOYMENT.md` (cron scheduling, Docker, env vars, exit codes, the full decision-contract audit schema). The buyer never touches funds — it emits the decision; a downstream executor holds custody.
- **Casper RPC fallback chain + 429 backoff** — `agent/lib/anchors/casper.ts` + `agent/lib/casper-mcp-client.ts`. Public `node.testnet.casper.network` (no auth, no quota) is now the primary RPC; cspr.cloud with `CSPR_CLOUD_TOKEN` is fallback. Both the anchoring adapter and the MCP consumer try endpoints in order, skipping 429s. Balance check has exponential 429 backoff (15m→30m→1h→2h→4h cap) so the agent stops burning RPC quota on doomed checks when rate-limited.
- **Casper anchor spend fix** — `agent/lib/llm-jury.ts` + `agent/index.ts`. The thesis-hash dedup was effectively dead: the LLM jury digest included raw adjustment floats, so non-deterministic LLM output moved the thesis hash every cycle and forced redundant 50-CSPR Casper anchors. Fixed by quantizing the digest (5-pt adjustment buckets, agreement→sign, drop neutrals, sort by symbol). Also persisted `lastAnchoredThesisHash` across pm2 restarts and lowered the balance gate from 100→30 CSPR. 4 new jury digest tests.
- **SigNoz observability + demo progressive disclosure** — per-cycle pipeline timing exposed on `/agent` via `AgentObservabilityPanel` + `AgentCommandStrip`. Demo mode (`?demo=1`) refactored to one-act-at-a-time with sticky `DemoActNav` and collapsed secondary panels behind `DisclosureSection`.
- **LLM conviction jury (7th factor)** — `agent/lib/llm-jury.ts`. After the 6-factor deterministic scoring, an LLM reviews top candidates and adjusts conviction scores ±15. Reasoning digest included in the thesis hash anchored on Casper. Provider priority: free-first Vercel AI Gateway (zai/glm-5.2) > OpenRouter (`openrouter/auto`) > OpenAI > Anthropic > template (no key). Live on VPS with OpenRouter — jury delivered real verdicts on first deployed cycle (DAI -4, USDC -4, XRP -8). 21 jury tests + 14 Casper MCP client tests.
- **Casper ecosystem MCP consumer** — `agent/lib/casper-mcp-client.ts`. Agent consumes CSPR.trade MCP (DEX prices/liquidity) and Casper blockchain MCP (era/validators/stake) as cross-chain context for the LLM jury. Agent is now a bidirectional MCP participant (exposes 7 tools + consumes 2 ecosystem servers). Note: both public MCP endpoints were unreachable at deploy time; code degrades gracefully.
- **OpenRouter integration** — OpenRouter wired as the second-tier LLM provider for both jury and market narrative (behind the free Vercel AI Gateway). Default model `openrouter/auto` routes to best available free model. `OPENROUTER_API_KEY` set on VPS.
- **signals-live/v1.2** — per-cycle `execution` block (entries/exits/skips + `alignment.topRankedEntered`), explicit `provenance.behavioral.status`, AJV schema validation in CI. Schema: `/schemas/signals-live-v1.2.schema.json`. Deployed to VPS + dashboard copy.
- **CROO Store live** — [Store listing](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205) with `signals-live` ($0.05 USDC). **Store Deliverable Schema must stay empty** (field builder rows break CAP delivery). Verified orders include `0990e061-…` (2026-07-17). See `docs/croo-store-listing.md` and `docs/CROO_INTEGRATION.md`.
- **Allocator UX pass** — landing intent CTAs, `/agent#hire`, demo walkthrough mode (`?demo=1`).
- **Casper anchoring guardrails** — balance gate + thesis-hash deduplication so anchors stop failing when operator CSPR is low and stop paying gas for unchanged theses.
- **TWAK harvest hardening** — harvest retries now mirror the exit fallback ladder (default → 10% → 20% → 49% slippage → USDC hop → size probe). Persistently unharvestable positions are marked **stuck** and blocklisted.
- **Stuck positions excluded from cap** — `maxOpenPositions` now counts only active positions, so dead/honeypot tokens stop silently consuming slots.
- **Pre-entry execution probe** — tokens with DexScreener liquidity below $20k are probed with a real buy/sell round-trip before opening a full position. This catches quote-only false positives like the UAI `SafeTransferFromFailed` allowance/spender mismatch.

### Active ledger notes

- **UAI** was manually sold after the harvest fix. The remaining ~$0.01 dust was removed from the held-positions ledger. UAI is no longer counted toward the position cap.
- **BSB** and **GWEI** remain marked stuck from prior cycles and are excluded from portfolio valuation and the active position cap.
- Current open positions after cleanup: **FET, USDC, SIREN, NEX, SLX** (active) plus **BSB, GWEI** (stuck).

### Ongoing watchlist

- TWAK/LiquidMesh sometimes routes through pools where the wallet only has allowance on a different spender (e.g., 1inch `0x0000001fF...` vs LiquidMesh router `0x3d90...`). The entry probe now detects this before a full entry.
- SoSoValue API rate-limiting (HTTP 429) is **fixed**. Root cause: the token bucket (capacity 20, refill 1/3s) allowed a ~40-request first minute against the 20 req/min key limit — everything past ~20 got 429'd, 3 consecutive failures tripped the 15-min circuit breaker, and the 147-token snapshot refresh thrashed. Two fixes: (1) a rolling-window rate limiter (`computeSsvThrottleWaitMs`) hard-caps 20 requests in any trailing 60s — the same metric SoSoValue enforces; (2) jittered per-token snapshot TTL (`snapshotTtlMs`, 12h ± 2h hash-derived) so 147 expiries don't land in the same minute. Verified live: 0 HTTP 429s since deploy, `Fetched 124/147` and climbing (was 57/147 thrashing).
- Casper ecosystem MCP endpoints (`mcp.cspr.trade`, `mcp.cspr-ai.xyz`) were unreachable at deploy time. The `casper-mcp-client.ts` module degrades gracefully — jury proceeds without cross-chain context. If endpoints come back online, no code change needed; context will flow automatically.
- Casper operator CSPR balance is ~3,065 CSPR (funded 2026-07-23 from testnet faucet). Anchoring is active via the public `node.testnet.casper.network` RPC (no auth, no quota). The thesis-hash dedup + quantized jury digest means anchors only fire on meaningful conviction shifts, not every cycle.

---

## Agent Architecture (`agent/`)

### Entry Points

| File / Module | Purpose |
|---------------|---------|
| `agent/index.ts` | Startup, main loop orchestrator (`.env` inline loader, `runCycle()`, `restoreSnapshot()`) |
| `agent/src/server.ts` | HTTP server (routes: `/status`, `/trades`, `/conviction`, `/edge-report`, `/delphi/status`, `/mcp`, `/reputation/stats`, `/aleo/sign-voucher`, `/cap/status`) |
| `agent/src/mcp/` | MCP server + x402 paywall — exposes cross-chain conviction data to AI agents |
| `agent/src/cap/` | CROO Agent Protocol adapter — reputation services settled in USDC on Base |
| `agent/src/payment-stats.ts` | Shared A2A payment counters for x402 and CAP |
| `agent/lib/config.ts` | Single config object (`AGENT_CONFIG`), competition constants, block-explorer URL builders |
| `agent/lib/agent-state.ts` | Shared mutable state (`state`), 10 type interfaces, helper maps, utility functions |
| `agent/lib/cycle-runner.ts` | All 8 pipeline steps + helpers (`closePosition`, `finalizeExit`, `printCycleSummary`) |
| `agent/lib/data-providers.ts` | Composite market data: `CmcClient` (CMC Pro REST) + `SosovalueClient` (SoSoValue OpenAPI) |
| `agent/lib/dex-trading.ts` | SoDEX spot REST client + EIP-712 signing (`SodexClient`, `SodexNonceManager`) |
| `agent/lib/holders.ts` | On-chain holder counts (NodeReal JSON-RPC + CoinGecko fallback), growth computation |
| `agent/lib/conviction-signal.ts` | 7-factor contrarian conviction scoring engine (6 deterministic + LLM jury) |
| `agent/lib/llm-jury.ts` | LLM conviction jury — reviews top candidates, adjusts scores ±15, reasoning anchored on-chain |
| `agent/lib/casper-mcp-client.ts` | Casper ecosystem MCP consumer — fetches CSPR.trade DEX data + blockchain status as cross-chain context |
| `agent/lib/risk-guardrails.ts` | Risk limits (drawdown, position size, daily count, concentration) |
| `agent/lib/twak-executor.ts` | TWAK CLI wrapper (trade execution, address resolution, portfolio) |
| `agent/lib/telegram.ts` | Telegram dispatch (3-message cycle summaries, startup, error alerts) |
| `agent/lib/persistence.ts` | SQLite Sync state persistence (cross-restart position ledger) |
| `agent/lib/errors.ts` | Standardized error types (`AgentError`, `TradeError`, `GuardrailError`, etc.) |
| `agent/lib/onchain-portfolio.ts` | On-chain portfolio reader — values BEP-20 positions TWAK can't see |
| `agent/lib/market-narrative.ts` | AI market narrative generation from SoSoValue feeds + macro events |
| `agent/lib/anchors/` | Cross-chain anchoring adapters — `MantleAnchorAdapter` + `CasperAnchorAdapter` |
| `agent/lib/self-analysis.ts` | Builds the agent's canonical trade ledger and scores its own behavior each cycle via `conviction-core` |
| `agent/lib/backtest.ts` | Backtest harness + **edge report** — conviction strategy vs naive baseline, factor attribution of winning exits. `runEdgeReport()` answers "does the signal have demonstrable edge?" |
| `agent/lib/delphi/` | Prediction-market surface (Gensyn Delphi Agent Arena) — `executor.ts` (SDK wrapper, slippage guard, simulator, position lifecycle reads, `quoteSell`/`sellShares` for the convergence exit), `probability.ts` (LLM ensemble estimate + vol-baseline blend + category-aware edge gate + Kelly-lite sizing + `evaluateConvergenceExit`), `vol-baseline.ts` (driftless log-normal threshold pricing + question parsing, zero inference cost), `web-search.ts` (Exa briefings via the Vercel AI Gateway, per-cycle budget + cache), `lifecycle.ts` (settled→redeem, expired/failed→liquidate sweep), `anchoring.ts` (quantized per-cycle thesis → shared Mantle+Casper adapters, deduped), `runner.ts` (separate pm2 loop `earlynotwrong-delphi`, writes positions.json + forecasts.jsonl under `AGENT_DATA_DIR/delphi/`, side-effect-imports env-bootstrap so agent/.env keys are live, persists per-forecast provenance (model · samples · webEvidence · volAnchor) surfaced on the card + Telegram; entry-point guard handles pm2's ProcessContainerFork argv[1] — do not regress to an argv-only check), `status.ts` (disk-backed reader powering `GET /delphi/status`). Gated by `DELPHI_ENABLED` (runtime env check, not build-time config). See `docs/DELPHI_AGENT_ARENA.md`. Strategy: LMSR probability-vs-price edge, **not** token dip-buying; evidence of edge is calibration/Brier (conviction-core `calibration.ts`), not Sharpe |

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
delphi/probability.ts ───┘

delphi/runner.ts
  ├─ delphi/anchoring.ts → anchors/index.ts (anchorAll) + anchors/hashes.ts
  ├─ delphi/probability.ts + delphi/lifecycle.ts + delphi/executor.ts
  └─ conviction-core (ProbabilityForecast)

delphi/status.ts (read by GET /delphi/status)
  └─ conviction-core (calculateCalibrationMetrics)

src/components/agent/delphi-arena-card.tsx
  └─ src/lib/agent-client.ts (fetchDelphiStatus → /api/agent/proxy?endpoint=delphi/status)
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
   - An LLM (OpenAI GPT-4o-mini or Anthropic Claude Haiku) reviews top candidates with cross-chain context
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
- **Shared conviction framework**: Pure ledger types and behavioral scoring live in `packages/conviction-core`. Both the agent self-analysis and the web wallet analyzer consume the same `calculateBehavioralMetrics` / `analyzePosition` / `calculatePatienceTax` functions. `calibration.ts` adds the prediction-market yardstick (`brierScore` / `logLoss` / `hitRate` / `reliabilityBuckets` / `calculateCalibrationMetrics`), consumed by the Delphi runner's status reader. Do not duplicate scoring logic in `src/` or `agent/`.
- **Shared LLM ladder**: all LLM calls (token jury + Delphi forecaster + Delphi web briefings) go through `agent/lib/llm-providers.ts` (`chatCompletion`, free-first Vercel AI Gateway [zai/glm-5.2] > OpenRouter > OpenAI > Anthropic) and `agent/lib/delphi/web-search.ts` (Exa via the same gateway key). Gateway quirks verified live: it rejects `response_format` (400), requires `reasoning: { effort }` (GLM 5.2's reasoning tokens otherwise eat the completion budget and leave `content` empty), and its JSON replies can come fenced — parse with `parseLenientJson`. Do not add per-module fetch plumbing for new LLM surfaces — extend the ladder there.
- **No fabricated fallback data**: Showcase/demo wallets use real public addresses only. Do not add fabricated traders, heatmaps, or percentile defaults to fill empty UI states. Return `null` and show an honest empty state instead.
- **Cross-chain anchoring**: Same `ConvictionRecord` payload sent to Mantle (EVM, viem) and Casper (casper-js-sdk). Hashes computed once via `conviction-core`'s `computeSubjectHash` / `computeThesisHash` — same hash on every chain.
- **Telegram dispatch**: 3-message cycle summary with HTML formatting (`<pre>`, `<code>`, `<b>`). Non-blocking `.catch(() => {})` — env-vars-gated startup/cycle/error alerts.
- **Guardrails**: Pure in-memory state with daily counter reset. Hard limits from `AGENT_CONFIG.trading`.
- **Bankroll management**: BNB reserve + adaptive interval doubling (4h → 8h) when BNB drops below `targetBnbUsd`.
- **Position reconciliation**: at startup, `restoreSnapshot()` cross-checks `state.heldPositions` against live TWAK portfolio and drops ghost positions.
- **Portfolio parser**: Reads `$USD` column from TWAK's column-aligned output. Covered by regression test in `__tests__/twak-executor.test.ts`.
- **TWAK reliability**: The agent resolves the `twak` binary from common install paths (`~/.local/bin`, `~/.twak/bin`, `/usr/local/bin`) in addition to `PATH`. If TWAK is missing, misconfigured, or the wallet is locked, startup diagnostics print the exact failure and a remediation hint. The cycle still runs: portfolio falls back to the on-chain reader, and trades are skipped rather than crashing the loop.
- **Agent-to-agent (A2A)**:
  - MCP server at `/mcp` with Streamable HTTP transport + x402 paywall. Exposes 7 tools: `get_latest_conviction`, `get_by_thesis`, `get_subject_history`, `get_agent_reputation`, `get_jury_deliberation`, `get_live_signals`, and `score_wallet` (behavioral scoring of any wallet — proxies to the web app's wallet-score endpoint). The agent also **consumes** 2 Casper ecosystem MCP servers (CSPR.trade + blockchain) as cross-chain context for the LLM jury — bidirectional MCP participant.
  - CROO CAP client connects to the CROO network via WebSocket and fulfills six CAP serviceIds (`signals-live` and `wallet-score` Store-listed; four reputation services MCP-only). Store orders require `CROO_SIGNALS_LIVE_SERVICE_UUID` on the VPS — see `docs/CROO_INTEGRATION.md`.

### Important Conventions

- All `agent/lib/` imports use `.js` extension (ESM modules compiled from `.ts`).
- Never import Next.js path aliases (`@/`) in agent code.
- Env vars use `TWAK_` prefix (not `TW_`). The portal calls them `TW_ACCESS_ID` and `TW_HMAC_SECRET`, but the agent reads `TWAK_ACCESS_ID` and `TWAK_HMAC_SECRET`.
- `execSync` → prefer `execAsync` for long-running operations (trade execution still uses `execSync` due to TWAK CLI limitations).
- Tests live in `agent/__tests__/` — Vitest framework (503 tests across 36 files).
- `agent/data/state.json` is a runtime artifact — it's in `.gitignore` and should not be committed. If `git status` shows it as modified, run `git rm --cached agent/data/state.json`.
- `agent/data/payment-stats.json` — persisted A2A payment counters (x402 + CAP); survives pm2 restarts.
- `GET /signals/teaser` (and `/signals/preview` alias) — public guidance preview only; full `signals-live/v1.2` is paid via CROO or MCP.
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
  - **Token-bucket rate limiter** (`ssvThrottle` in `data-providers.ts`) wraps every `ssvRestGet` call and enforces the 20 req/min ceiling. The first 20 requests in a window fire immediately, then requests pace at one per 3s.
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
| `agent/delphi-arena-card.tsx` | Delphi Prediction Arena card — runner stats, open forecasts, calibration (Brier + reliability diagram), anchor receipt (Proof view) |
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

## Pinata Deployment

- Build: `npm run build` (runs `tsc`)
- Start: `node dist/index.js`
- Port: 31777 (Hono HTTP server)
- Routes are prefixed by Pinata gateway: `/api/status` → `/status` on port 31777

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

One-time setup (already done): `git init` + remote + `git checkout -f
origin/main` on the server, and `agent/ecosystem.config.cjs` documents the pm2
process. The live process is still managed by name (`pm2 reload earlynotwrong`)
so its injected env vars are preserved — do **not** switch it to start from
`ecosystem.config.cjs` unless you also migrate those env vars into the file.

## TypeDoc Documentation

```bash
cd agent
npm run docs        # generate docs/api/
npm run docs:serve  # serve locally via npx serve
```

- Config: `agent/typedoc.json`
- Output: `agent/docs/api/`
- 217 HTML pages covering all 14 lib modules + src/ server + MCP tools
