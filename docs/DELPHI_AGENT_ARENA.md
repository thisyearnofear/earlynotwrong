# Delphi Agent Arena (Gensyn) — Strategy & Integration

> Competition page: https://dorahacks.io/hackathon/delphi-agent-competition/detail
> Competition app / leaderboard: https://competition.delphi.fyi/
> Trading window: **2026-08-10 → 2026-08-24** · $10,000 USDC pool (1st $5k / 2nd $3k / 3rd $2k)

## What this competition actually is

Not a "submit your project" hackathon. A **live two-week trading arena**:

- **Judged on P&L only.** Entrants trade a curated set of multi-outcome **LMSR prediction markets** on Gensyn Testnet (politics, econ, sports, crypto, tech, current events). Ranked by realized + unrealized P&L in competition tokens after all markets settle.
- **Nothing to submit but a wallet.** One registered wallet per entry is your leaderboard identity. No repo, no code review; the strategy stays private. Run the agent from our existing VPS.
- **Everyone starts equal.** Identical starting competition-token balance; gas is Gensyn Testnet ETH (Alchemy faucet needs 0.001 ETH mainnet anti-bot, or Sepolia → bridge).
- **Real market mechanics.** LMSR always quotes a price for every outcome; every trade moves the price. Quote before trading; expect slippage on size. Winners redeem 1 token/share at settlement; losers pay 0. Settlements roll in throughout the window via AI oracles.

## Where Early, Not Wrong fits

The **harness transfers wholesale**; the **scoring domain does not**.

| Existing piece | Reuse |
|---|---|
| 8-step loop orchestrator, pm2 + VPS deploy discipline | Same loop shape: discover markets → estimate probabilities → size vs. slippage → trade → redeem/liquidate |
| LLM jury pattern (`agent/lib/llm-jury.ts`) | Repointed at market questions: "is this outcome underpriced vs. my estimate?" — this IS the prediction-market edge |
| Risk guardrails (drawdown, concentration, sizing) | Directly apply to LMSR bankroll management |
| Composite data-providers pattern | Same shape for ingesting external signal per market topic |
| MCP + x402 paywall, CROO CAP adapter, edge report, buyer agent | **Second paid signal SKU with zero new billing infrastructure** |
| TypeScript + Node, 356-test Vitest discipline | Delphi SDK is TypeScript/Node 18+ (`@gensyn-ai/gensyn-delphi-sdk` v2.1.0) |

What **doesn't** port: the 6 deterministic token factors (contrarian 7d return, synthesized RSI, holder growth, DexScreener liquidity). Prediction markets resolve **once** — no trailing exits, no "hold through drawdown". The game is probability-vs-price calibration, not dip-buying. Even evidence of edge needs a different yardstick: **calibration / Brier score across many markets**, not a Sharpe backtest.

## Why it's accretive beyond the prize

Framed as *"Delphi executor + prediction-market signal product on existing rails"* rather than a side quest:

1. **A road to Delphi mainnet.** Gensyn explicitly designed the SDK + LMSR mechanics to carry over to live markets. Two weeks of hardened executor + real logs means mainnet isn't a cold start.
2. **Gensyn ecosystem proximity.** A running Delphi agent is demonstrated alignment with their agentic-trading stack — the kind of participation that surfaces in grants, showcases, and follow-on competitions. A third ecosystem where the agent is a visible participant (alongside Mantle and Casper).
3. **A second product surface.** Today we sell exactly one thing: crypto conviction signals. A Delphi agent turns "prediction-market probabilities + reasoning" into a second paid signal, exposed as new MCP tools / CAP serviceIds on infrastructure we already operate and documented sell paths we already have (`examples/buyer-agent`).
4. **Framework generalization.** `packages/conviction-core` currently scores *holding behavior*. Prediction markets force it to model *estimation accuracy* (calibration, Brier) — a genuine conceptual upgrade that broadens who the framework serves.
5. **Public performance credential.** A real leaderboard with uniform rules and equal starting balances is third-party-attested performance — better marketing for the signal products than any self-reported backtest.

## Honest counterweights (and how we bound them)

- **Scope dilution.** Surface area is already large; a third venue rots if unmaintained. Bound it: the Delphi surface lives in `agent/lib/delphi/` as a self-contained module with its own loop entry (`agent/lib/delphi/runner.ts`), behind `DELPHI_ENABLED`; the BSC pipeline doesn't import it.
- **Attention split.** The competition overlaps in-flight OKX / wallet-score work. Rule: the Delphi build is time-boxed (days, not weeks); after 08-24 it either graduates to a maintained surface (mainnet + signals SKU) or is archived.
- **Edge evidence.** Don't overclaim. Report calibration and Brier scores, not Sharpe. Two weeks of testnet trading proves infrastructure, not edge.

## Architecture

```
agent/lib/delphi/
  executor.ts      — DelphiExecutor: listMarkets/quote/buy/sell/redeem/liquidate
                     wrapper with retry + slippage guard + simulator mode. Position
                     lifecycle reads (listPositions/getErc20Balance/getOpenPositions).
                     Lazy-imports the SDK; tests inject a DelphiClientLike fake.
  probability.ts   — probability estimation + sizing. estimateProbability (Vercel
                     gateway > OpenRouter > OpenAI > Anthropic > injected via the
                     shared llm-providers ladder; N-sample ensemble combined by
                     per-outcome median, blended toward the crypto vol baseline),
                     evaluateProbabilitySignal (pure, category-aware edge gate),
                     evaluateConvergenceExit (sell-into-convergence / thesis stop),
                     normalizeEstimate (sum-to-1 invariant on both paths), and
                     sizeSharesBudget/perTradeBudget (Kelly-lite bankroll fractions).
  vol-baseline.ts  — quantitative anchor for crypto threshold markets: driftless
                     log-normal P(close > threshold) from realized daily vol
                     (SoSoValue klines) + spot, with question parsing (threshold /
                     expiry date / asset symbol). Zero inference cost; the Delphi
                     analog of the edge report's naive baseline.
  web-search.ts    — DelphiWebSearch: Exa-sourced briefings via the Vercel AI
                     Gateway (`gateway.tools.exaSearch`, free promo) injected into
                     the forecaster prompt. Per-cycle budget + TTL cache; failures
                     and budget exhaustion skip context, never block.
  lifecycle.ts     — settled-market redemption + expired/failed liquidation sweep.
                     Per-market failure isolation; sized by groupOutcomesByMarket.
  anchoring.ts     — on-chain thesis anchoring (the analog of BSC cycle step 8).
                     Quantizes the cycle's decisions (edges bucketed to 0.05, neutrals
                     dropped, sorted) into a digest, hashes via conviction-core, and
                     publishes through the shared Mantle + Casper adapters with
                     thesis-hash dedup persisted in the snapshot.
  runner.ts        — standalone loop entry (pm2 process earlynotwrong-delphi): sweep
                     → convergence-exit pass → discover → brief + vol-anchor →
                     estimate → gate → size → trade → anchor. JSONL trade ledger,
                     open-position ledger (positions.json), resolved-forecast
                     calibration ledger (forecasts.jsonl), snapshot, and exposure.json
                     under AGENT_DATA_DIR/delphi/; DELPHI_ENABLED is a runtime check,
                     not a build-time config value. Side-effect-imports env-bootstrap
                     (its own entry point, not index.ts) so agent/.env keys are live.
  status.ts        — disk-backed read of the runner's persisted state for the main
                     HTTP server (separate pm2 process, so no shared memory). Powers
                     GET /delphi/status and the dashboard's Prediction Arena card.

packages/conviction-core/src/calibration.ts
                   — pure calibration metrics shared with any future consumer:
                     brierScore, logLoss, hitRate, reliabilityBuckets (10 equal-width
                     bins), calculateCalibrationMetrics. Prediction markets resolve
                     once, so estimation accuracy — not Sharpe — is the yardstick.
```

LLM plumbing note: the Vercel AI Gateway > OpenRouter > OpenAI > Anthropic
ladder lives in `agent/lib/llm-providers.ts` (`chatCompletion`) and is shared
by the token jury (`llm-jury.ts`) and the Delphi forecaster
(`delphi/probability.ts`) — one place to change model defaults, timeouts, or
add a provider. Gateway specifics (verified live, 2026-08-15): the gateway
rejects `response_format` (400), so JSON comes from the system prompt;
`reasoning: { effort: "none" }` must always be sent because GLM 5.2 is a
reasoning model and unbounded reasoning tokens leave `content` empty; JSON
replies are parsed leniently (`parseLenientJson` — strips Markdown fences).

Env (added to `agent/manifest.json` secrets + `.env.example`):

| Var | Purpose |
|---|---|
| `DELPHI_ENABLED` | Master switch (default off until registered/funded) |
| `DELPHI_NETWORK` | `competition-testnet` now, `mainnet` later |
| `DELPHI_API_ACCESS_KEY` | REST reads (markets/positions). Generate at https://delphi-api-access.gensyn.ai/ |
| `DELPHI_WALLET_PRIVATE_KEY` | Fresh, competition-only keypair. Never the TWAK or Casper operator key |
| `VERCEL_AI_GATEWAY_API_KEY` | Free-first inference (zai/glm-5.2) + Exa web search for the Delphi forecaster. Promo window; the paid ladder below stays wired as fallback |

Key SDK facts (v2.1.0): `competition-testnet` network auto-sends `X-Delphi-Mode: competition`; chain ID 685685; competition gateway `0x097599c9D966fF496284b892A8F13BF885b258ef`; market statuses `open | awaiting_settlement | settled | expired | failed` — `settled` → `redeemMarket`, `expired`/`failed` → `liquidate`. **`listMarkets` nests `question`/`outcomes` under `market.metadata`** — flat top-level fields exist only in test fakes, which is why `listOpenMarkets` maps through `mapSdkMarket` (the first live cycle produced estimates=0 until this was fixed). **The SDK has no HTTP timeout of its own** — every executor call is therefore wrapped in `withTimeout` (`sdkTimeoutMs`, default 60s) and the runner loop has a 50-minute cycle watchdog; without these a single hung RPC/subgraph request froze the runner for 13.5h in production (2026-08-15).

## Phased plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Register wallet on DoraHacks, faucet gas, API key | **done (2026-08-14)** — wallet `0x884c…dEa9` registered + 0.05 testnet ETH funded; API key validated live (29 markets); $TST starting bankroll pending the organizer's daily distribution |
| 1 | `agent/lib/delphi/executor.ts` + config + tests | **landed** — 14 tests, `DelphiExecutor` with lazy SDK import, slippage guard, simulator mode |
| 2 | Probability estimation: LLM jury for market questions + deterministic edge gate | **landed** — `agent/lib/delphi/probability.ts`, `estimateProbability` (shared `llm-providers` ladder) + `evaluateProbabilitySignal` (edge vs. minEdgeToTrade + slippage) + `normalizeEstimate` invariant |
| 3 | Standalone runner loop + pm2 process + Telegram reporting | **landed** — `agent/lib/delphi/runner.ts`, `earlynotwrong-delphi` pm2 app, `sendDelphiCycleSummary`, JSONL trade ledger + snapshot under `AGENT_DATA_DIR/delphi/`, gated by `DELPHI_ENABLED` (checked per cycle, not at build) |
| 4 | Position lifecycle, redemption scanner, bankroll-aware sizing | **landed** — `agent/lib/delphi/lifecycle.ts` (settled→redeem / expired+failed→liquidate sweep, per-market failure isolation), executor extended with `listPositions`/`liquidate`/`getErc20Balance`/`getOpenPositions`, `sizeSharesBudget` + `perTradeBudget` (Kelly-lite: `maxPositionFraction`/`maxMarketFraction` caps), per-market exposure ledger (`exposure.json`) |
| 4b | On-chain anchoring + calibration ledger + dashboard surfacing | **landed** — `delphi/anchoring.ts` publishes a quantized per-cycle thesis via the shared Mantle + Casper adapters (thesis-hash dedup persisted across restarts); resolved redemptions feed `forecasts.jsonl`; `packages/conviction-core/src/calibration.ts` computes Brier / log-loss / hit-rate / reliability buckets; `GET /delphi/status` + the dashboard's Prediction Arena card (Proof view) surface it live |
| 4c | Alpha stack: context injection, vol pricing, category gates, ensemble, sell-into-convergence | **landed** — free-first inference (Vercel AI Gateway, GLM 5.2) at the top of the shared ladder; Exa web briefings (`web-search.ts`, 10/cycle budget + 6h cache); driftless log-normal vol baseline (`vol-baseline.ts`) blended into crypto threshold estimates at w=0.35; category-aware edge gates (crypto 0.08 → culture 0.14); 3-sample median ensemble; executor `quoteSell`/`sellShares` + the runner's convergence-exit pass (take profit at forecast−2¢, stop at entry−10¢). See below |
| 5 | Post-mortem: run the calibration report over `forecasts.jsonl`; decide graduate-or-archive | after 08-24 |
| 6 | If graduate: `DELPHI_NETWORK=mainnet`, MCP tool `getPredictionSignals`, CAP serviceId `predictions-live` | later |

### Alpha stack (Phase 4c)

Five sources of edge, all behind the free Vercel AI Gateway promo
(`VERCEL_AI_GATEWAY_API_KEY` — GLM 5.2 inference free through 2026-08-27,
Exa search free through 2026-08-31). The paid ladder (OpenRouter > OpenAI >
Anthropic) stays wired as fallback when the promo ends.

1. **Context injection** (`web-search.ts` → prompt). Markets about *current*
   events are where a model's training cutoff costs the most calibration. One
   gateway `generateText` call gives GLM the `exa_search` tool; it searches,
   reads, and returns a short sourced briefing that is injected into the
   forecaster prompt as evidence. Live verification: on "BTC above $150k on
   Aug 24?" the uninformed estimate was ~0.35 (stale priors); with the Exa
   briefing (BTC at ~$63k) it dropped to ~0.02 — the whole trade.
2. **Crypto vol baseline** (`vol-baseline.ts` → blend). For threshold markets
   ("Will X close above $K on date D?") we compute
   P(close > K) = Φ(ln(S₀/K)/(σ√T)) from realized daily vol (SoSoValue
   klines) and spot — arithmetic, not opinion. The final estimate is
   (1−w)·LLM + w·quant with w=0.35. The quant reference is never shown to the
   LLM so ensemble samples stay independent. Pure functions, zero inference
   cost; when parsing fails (no threshold/date/symbol) the blend is skipped.
3. **Category-aware edge gates** (`probability.ts` → config). The gate is now
   per-category: crypto 0.08 (has the vol anchor), economics 0.10,
   politics/sports 0.12, culture/miscellaneous 0.14 — LLM-only estimates on
   soft categories need more edge before we trust them against the market.
4. **Ensemble forecasting** (`combineEstimates`). N=3 independent LLM samples
   per market, combined by per-outcome **median** — a single overconfident
   outlier ("obviously 0.95") gets no pull. Sequential sampling respects
   free-tier rate limits; a degraded ensemble (1-2 samples) still ships with a
   warning rather than blocking.
5. **Sell-into-convergence** (`evaluateConvergenceExit` + executor sells).
   We bought because our forecast beat the price; when the price converges to
   within 2¢ of the forecast, the edge we paid for is realized — sell and
   redeploy instead of holding for a 1/0 payoff. A price drop of 10¢ below
   entry is a thesis stop. The exit pass re-quotes the full position
   (realizable average incl. depth impact) every cycle; quote failures hold
   rather than sell blind. Early exits are deliberately *not* scored for
   calibration — no ground truth yet, so no fabricated Brier points.

Config knobs (`AGENT_CONFIG.delphi`): `ensembleSamples`, `volBaselineWeight`,
`categoryEdgeGates` + `defaultCategoryGate`, `convergenceTolerance`,
`thesisStopEdge`, `webSearchMaxCallsPerCycle`, `forecastCacheTtlMinutes`.

### Inference cost & efficiency (audited 2026-08-14, pre-trading)

The entire stack runs on **zero-cost providers** today, with guards so it
stays that way (or degrades explicitly) after the promos end:

| Surface | Provider | Cost | Guard |
|---|---|---|---|
| Forecaster ensemble (3 samples/market) | Vercel AI Gateway · GLM 5.2 | Free through **2026-08-27** | `vercelGatewayFreeActive()` drops it from the ladder on/after `VERCEL_GATEWAY_PROMO_ENDS` (default 2026-08-28) |
| Web briefings (Exa) | same gateway key | Free through **2026-08-31** | gates off with the promo; forecaster falls back to implied odds alone |
| Ladder fallback | OpenRouter · `nvidia/nemotron-3-ultra-550b-a55b:free` | Free | pinned `:free` model — the account holds paid credits, and `openrouter/auto` on a credited account routes to **paid** models |
| Vol baseline | SoSoValue klines + spot (arithmetic) | Free (existing 20 req/min key) | blend skipped on parse failure — never billed, never blocks |

Efficiency mechanisms:

- **Forecast cache** (`forecastCacheKey`): estimate reuse keyed on market +
  implied probs bucketed to 2¢ + briefing fingerprint, TTL 6h. Unchanged
  markets cost zero inference across hourly cycles; a 1¢+ price move, a new
  briefing, or a restart re-estimates. Vol-anchored markets are never cached
  (the blend is baked in and the anchor tracks live spot).
- **Briefing cache**: 12h TTL (competition markets resolve at most daily) +
  10 fresh searches/cycle hard budget.
- **429/5xx backoff**: `fetchWithBackoff` retries rate-limit and server
  errors (2s→4s, max 2) across every ladder call; 4xx fail fast.
- **Provider circuit breakers** (generalized per provider, 2026-08-18):
  402 credit exhaustion trips a 30-min breaker; a Retry-After-less 429
  (daily-quota exhaustion — OpenRouter's 50/day cap can't self-heal before
  its 00:00 UTC reset) trips a breaker sized to that reset. Transient 429s
  that carry Retry-After do NOT trip one. The breakers gate BOTH the LLM
  ladder and the Exa briefing budget (`web-search.ts` shares the
  `vercel-gateway` breaker), so a dead provider costs at most one discovery
  round-trip, not one per call (~270/day and ~150/day observed wasted
  before this).
- **Reasoning cap**: `reasoning: { effort: "none" }` on every gateway call —
  GLM 5.2's reasoning tokens otherwise eat the completion budget.
- **Sequential ensemble sampling**: free tiers punish bursts; 3 × ~3s is a
  small fraction of the hourly cycle.
- SoSoValue: rolling-window limiter (20 req/min), circuit breaker (3× 401/
  403/429 → 15m suspend), jittered snapshot TTLs, disk-persisted cache.

`estimatesCached` is surfaced in the snapshot, `/delphi/status`, the arena
card, and the Telegram summary.

Provenance surfacing: every estimate carries a `ForecastProvenance`
(provider, model, ensemble size, `webEvidence`, `volAnchor`), persisted on
each open position in `positions.json` and each entry in `trades.jsonl`.
The Prediction Arena card renders it as tags next to each forecast
(`web` · `vol` · `×N`) with a legend, and the Telegram cycle summary
reports per-cycle evidence counts (`Evidence: 8 web briefings · 2 vol
anchors`) plus per-entry tags. The method behind the number is part of the
brand: calibration claims are only credible when the inputs are visible.

Gotcha — pm2 entry-point detection: the runner is its own pm2 process, and
under pm2 the child's `process.argv[1]` is pm2's launcher container
(`ProcessContainerFork.js`), not the script, which dynamic-imports it. The
original `argv[1].endsWith("runner.js")` guard never fired under pm2 and the
process idled silently (discovered 2026-08-14, before the runner had ever
completed a cycle). The guard now accepts both the direct-run case and the
pm2 container case; do not regress it to an argv-only check.

### Surfacing policy (agreed 2026-08-14)

Three tiers, in order:

1. **Operate** — smoke test + live loop. Nothing is surfaced until it trades.
2. **Observe (free)** — the dashboard's Prediction Arena card shows real runner
   state only: cycle stats, open forecasts (estimate vs implied + edge), the
   calibration report once forecasts resolve, and the on-chain anchor receipt.
   No paid signals at this stage; the card renders honest empty states
   (runner not started / nothing resolved yet) — never fabricated numbers.
3. **Sell (paid)** — only post-competition and only if calibration proves out:
   MCP `getPredictionSignals` + CAP `predictions-live` (Phase 6).

Calibration resolution semantics: a settled market we redeem resolves our
forecast (payout > 0 → the held outcome happened; 0 → it didn't). Expired or
failed markets are liquidated without resolution (no ground truth), and
markets where we hold more than one outcome are closed without scoring —
better no calibration point than a fabricated one.

**Stuck redeems (2026-08-18):** `redeem()` reverts for LOSING shares by
design — a settled market that resolved against us can never redeem. The
sweep detects this via the API's `winningOutcomeIdx`: when the resolution
contradicts every held outcome, it closes the position as a known loss
(forecast scored 0, exposure freed) under a `redeem-lost` ledger event and
stops retrying. A failed redeem where we hold the WINNING outcome stays in
the retry queue (money is owed; the revert is gas/RPC/index lag).

**Thesis-stop re-entry cooldown (2026-08-18):** after an `exit-stop`, the
same market is gated for `stopReentryCooldownHours` (default 12) unless the
new signal's edge strictly beats the stopped thesis's edge. Recovered from
the append-only trade ledger — no extra state file. Prevents the Chess-market
serial re-entry (4 buys in 4 days, net −89 TST).

### Runbook (once registration completes)

> Status: completed 2026-08-14 — `DELPHI_ENABLED=1` is set on the VPS and the
> runner cycles hourly. Kept for future restarts/re-provisioning.

```bash
# On the VPS — set the three Delphi env vars on the earlynotwrong-delphi process
pm2 env earlynotwrong-delphi
# (or set in agent/.env on the server, then:)
pm2 reload earlynotwrong-delphi --update-env

# One-shot smoke test before the loop takes over:
DELPHI_SINGLE_CYCLE=1 node /home/linuxuser/earlynotwrong/agent/dist/lib/delphi/runner.js
```

The runner checks `DELPHI_ENABLED` at cycle time, not at process start, so flipping the var is a reload, not a rebuild.
