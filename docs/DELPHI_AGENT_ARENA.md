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
| TypeScript + Node, 657-test Vitest discipline | Delphi SDK is TypeScript/Node 18+ (`@gensyn-ai/gensyn-delphi-sdk` v2.1.0) |

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
| `BAI_API_KEY` | B.AI API key (free DeepSeek-V4-Flash promo) — rung 3 of the forecaster ladder. Set in `agent/.env` on the VPS (chmod 600), never committed |
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
| 4d | Evidence-validation stack: fact authorities, plausibility filter, two-source corroboration, adversarial pre-entry verification | **landed** — `fact-check.ts` (verifier registry + Wikimedia pageviews authority: completed day → direct probability, open window → evidence-only), `evidence-filter.ts` (deterministic stale-year stripping), `web-search.ts` Tier 3 cross-check (`corroborationOverlap` — shared domain / ≥3 significant tokens, one extra rung call from the shared budget), `verification.ts` (cross-family-first red-team verifier, discount policy, re-gated edge), `llm-providers.ts` `providerOrder` override. Full provenance (`factAuthority`/`corroborated`/`verified`) through positions, Telegram, and the arena card. See below |
| 5 | Post-mortem: run the calibration report over `forecasts.jsonl`; decide graduate-or-archive | after 08-24 |
| 6 | If graduate: `DELPHI_NETWORK=mainnet`, MCP tool `getPredictionSignals`, CAP serviceId `predictions-live` | later |

### Alpha stack (Phase 4c)

Five sources of edge, all behind the free Vercel AI Gateway promo
(`VERCEL_AI_GATEWAY_API_KEY` — GLM 5.2 inference free through 2026-08-27,
Exa search free through 2026-08-31). The paid ladder (OpenRouter > OpenAI >
Anthropic) stays wired as fallback when the promo ends.

1. **Context injection** (`web-search.ts` → prompt). Markets about *current*
   events are where a model's training cutoff costs the most calibration.
   `briefing()` walks a three-rung search ladder — **firecrawl** (keyless
   `POST /v2/search`, highlights on by default, no synthesis LLM) >
   **parallel** (free anonymous Parallel Search MCP, objective-based with
   LLM-excerpted passages) > **exa-gateway** (the original Exa/via-gateway
   design; needs the gateway promo credit, so it sits last) — and the first
   rung that answers wins. Each rung has its own circuit breaker on the
   shared provider map (quota-exhaustion errors get a daily-reset window,
   explicit 429s a 5-min one, anything else 30 min). Verified live
   2026-08-18: on "BTC above $150k on Aug 24?" the uninformed estimate was
   ~0.35 (stale priors); with a sourced briefing (BTC at ~$63k) it dropped
   to ~0.02 — the whole trade. Provenance records which rung supplied the
   evidence (`webSource`: firecrawl/parallel/exa).
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
`thesisStopEdge`, `endgameHoldFromUtc`, `tournamentMode`,
`maxNewEntriesPerCycle`, `minPayoutMultiple`, `maxFillPrice`,
`hop2BankrollTst` / `hop2MinPayoutMultiple` / `hop2MaxFillPrice`,
`entryResolveBufferHours`, `postCloseGraceHours`,
`webSearchMaxCallsPerCycle`, `webCorroborationEnabled`,
`verificationEnabled`, `verificationWeight`,
`verificationDisagreementThreshold`, `forecastCacheTtlMinutes`.

### Evidence-validation stack (4 tiers, shipped 2026-08-18)

The ensemble's failure mode is **correlated overconfidence**: three samples of
one model family fed one briefing agree with each other and with the
briefing's blind spots (Typhoon YES estimated 0.95, settled NO). Four tiers
intercept that before money moves, cheapest-first:

1. **Deterministic fact verifiers** (`fact-check.ts`) — registry of
   resolution authorities. When a market question matches one
   (`wikimedia-pageviews` ships by default; new authorities register without
   runner changes), the exact number the market resolves against is fetched
   keyless (~0.3s). Two regimes: completed resolution day → direct
   probability (clamped [0.01, 0.99] — a data error must never become
   certainty) and the estimate is built deterministically, **no LLM runs at
   all** (`factAuthorityEstimate`); open window → facts only, injected with a
   "source of record" label that outranks web evidence in the prompt.
   Ground truth beats opinion: authority-direct estimates are exempt from
   Tier 4 (an LLM cannot veto the market's own resolution source).
2. **Deterministic plausibility filter** (`evidence-filter.ts`) — stale-year
   passage stripping before prompt injection (the WTI-1986 incident: a 1986
   price table was served as fresh evidence for a 2026 crude market).
   Passages whose only 4-digit years are all ≥2 years from the question's
   anchor year are dropped; dateless prose passes through; an emptied
   briefing injects nothing. Pure string arithmetic, zero inference.
3. **Two-source corroboration** (`web-search.ts`, Tier 3) — after the
   primary search rung answers, the NEXT eligible rung is asked the same
   question (one extra network call from the shared budget) and the two
   answers are compared deterministically: shared source domain OR ≥3 shared
   significant tokens (numbers/5+-letter words minus stopwords). The result
   is a `corroborated` boolean on the briefing — never an LLM judgment, never
   a gate on the primary. Corroboration failure/absence leaves the flag
   undefined (unattempted ≠ uncorroborated).
4. **Adversarial pre-entry verification** (`verification.ts`) — fires only
   after a signal cleared edge + one-thesis + stop-cooldown gates, so the
   cost is one LLM call per candidate ENTRY, not per market. A red-team
   prompt attacks the thesis (base rates, timing, evidence quality, market
   wisdom) and returns its own calibrated probability + verdict. The
   verifier runs **cross-family-first**: `providerOrder` on the shared
   ladder is rearranged so a Qwen estimate is verified by GLM/GPT/Claude and
   vice versa (same family = same blind spots); `DELPHI_VERIFIER_PROVIDER`
   dedicates one keyed provider to this role. Discount policy
   (`applyVerificationToProbability`, pure): only flagged
   over/under-confidence beyond `verificationDisagreementThreshold` (0.15)
   moves the estimate, by `verificationWeight` (0.5) toward the verifier;
   the edge gate then re-runs and a collapsed edge blocks the entry
   (ledgared as `verification-blocked` with the verifier's attack). A
   verification that can't run never blocks — quality gate, not availability
   gate.

Provenance for all four tiers surfaces end-to-end: `ForecastProvenance`
(`factAuthority`, `corroborated`, `verified`, `verifierModel`) →
`positions.json` → Telegram entry tags (`auth:…`, `2-src`, `verified`) →
arena-card badges + snapshot counters (`factChecks`, `verificationsRun`,
`verificationBlocks`). The traded forecast is always the POST-verification
probability — the calibration ledger scores the view we actually paid for.

### Inference cost & efficiency (audited 2026-08-14, pre-trading)

The entire stack runs on **zero-cost providers** today, with guards so it
stays that way (or degrades explicitly) after the promos end:

| Surface | Provider | Cost | Guard |
|---|---|---|---|
| Forecaster ensemble (3 samples/market) | Vercel AI Gateway · GLM 5.2 | Promo expired / credit exhausted | `vercelGatewayFreeActive()` + circuit breaker on 402 |
| Inference — rung 3 | **B.AI · DeepSeek-V4-Flash** (keyed, `BAI_API_KEY`) | Free promo (2026-08-19: "unlimited, for a limited time") | cascade falls through to OrcaRouter on error |
| Inference — rung 4 | OrcaRouter · `deepseek/deepseek-v4-flash-free` | $0 (rate-limited, ~18% error rate) | same |
| Web briefings — rung 1 | Firecrawl `/v2/search` (keyless) | Free (keyless tier; optional `FIRECRAWL_API_KEY` raises limits) | per-rung breaker; budget counts network calls |
| Web briefings — rung 2 | Parallel Search MCP (anonymous) | Free (no key; optional `PARALLEL_API_KEY` raises limits) | per-rung breaker; daily-reset window on quota errors |
| Web briefings — rung 3 | Exa via the same gateway key | Free through **2026-08-31** | gates off with the promo; forecaster falls back to implied odds alone |
| Ladder fallback | OpenRouter · `nvidia/nemotron-3-ultra-550b-a55b:free` | Free | pinned `:free` model — the account holds paid credits, and `openrouter/auto` on a credited account routes to **paid** models |
| Vol baseline | SoSoValue klines + spot (arithmetic) | Free (existing 20 req/min key) | blend skipped on parse failure — never billed, never blocks |

Retired tiers (2026-08-19): the keyless **hf-qwen** community endpoint was
removed — the deployment was retired as its own docs warned ("retired after
the launch buzz") and every call had started returning 404, collapsing
estimates to 0/cycle until the b-ai rung landed. The OrcaRouter
`qwen/qwen3.8-27b-free` model is similarly abandoned (hard quota).

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

**All-forecasts calibration ledger (2026-08-19):** the rule above makes the
traded-only `forecasts.jsonl` selection-biased — it can only ever reflect
markets the edge gate + sizing let us enter, so it can't answer "how good is
the forecaster overall". `delphi/forecast-log.ts` fixes that: every estimate
(traded or not) is appended to `estimates.jsonl` each cycle, and
`resolveForecastLog()` scores the LAST forecast per (market, outcome) at
settlement into `forecasts-all.jsonl` (same expiry/failed-drop rule). The
dashboard exposes both: `calibration` (traded) and `allForecasts` (every
market) — the all-forecasts number is the one a signal buyer should read.

**Stuck redeems (2026-08-18):** `redeem()` reverts for LOSING shares by
design — a settled market that resolved against us can never redeem. The
sweep detects this via the API's `winningOutcomeIdx`: when the resolution
contradicts every held outcome, it closes the position as a known loss
(forecast scored 0, exposure freed) under a `redeem-lost` ledger event and
stops retrying. A failed redeem where we hold the WINNING outcome stays in
the retry queue (money is owed; the revert is gas/RPC/index lag).

**Stale-subgraph guard (2026-08-19):** the SDK's subgraph can lag behind
actual market settlement, so `listPositions` keeps reporting settled
markets as open (the Chess-Wikipedia market showed `awaiting_settlement` for
days). Every sell into one of these markets reverts with `MarketNotOpen()`
on the LMSR contract, and the naive hourly retry loop would have kept burning
gas/UAP-gateway credit indefinitely. Two fixes work together:

1. **Pre-sell maturity check** — `DelphiExecutor.getMarket()` (REST, not
   subgraph) exposes `resolvesAt`; `convergenceExitPass` skips (and drops from
   tracking) any position whose market is past `resolvesAt + 30 s`. The
   lifecycle sweep then redeems/liquidates it.
2. **Reactive fallback** — if the date check passes but the quote/sell still
   reverts with `MarketNotOpen()` (caught via `err.toString()`; viem hides the
   decoded name in non-enumerable cause-chain properties), the position is
   deleted from `positions.json` so the sweep can handle it.

Restored the stuck Chess-Wikipedia position (92.5 TST) and let the UAP position
stay tracked (its `resolvesAt` was 2026-08-21, still open).

**Thesis-stop re-entry cooldown (2026-08-18):** after an `exit-stop`, the
same market is gated for `stopReentryCooldownHours` (default 12) unless the
new signal's edge strictly beats the stopped thesis's edge. Recovered from
the append-only trade ledger — no extra state file. Prevents the Chess-market
serial re-entry (4 buys in 4 days, net −89 TST).

**Endgame sizing & calibration tuning (2026-08-19):**
- `maxPositionFraction 0.1 → 0.15`, `maxMarketFraction 0.25 → 0.35` —
  Kelly-lite bump (superseded 2026-08-20 by tournament 0.95 / 0.95).
- Forecaster `temperature 0.2 → 0.35` — nudges the model away from the
  default "obviously 0.95" overconfidence that cost 103 TST on Typhoon Dolphin.

## Endgame (Aug 20–24) — tournament all-in

Official board 2026-08-20: **rank 122/159, 599.99 TST, PnL −400**. 5th is
~3034 TST. Kelly-lite 15–20% cannot 5×. This window maximizes **P(top 5)**,
not E[log wealth]. Ruin of a hop is accepted.

**Why we were down:** `evaluateConvergenceExit` sold the 1/0 settlement
payoff back into LMSR (take-profit at forecast−2¢, stop at entry−10¢). Live
record through 08-19: 7 thesis stops vs 5 take-profits. Internal “931.95 TST
recovered” was a local wallet read; the board is source of truth.

**What shipped (do not magic-number `convergenceTolerance: -1`):**

| Knob | Value | Role |
|---|---|---|
| `endgameHoldFromUtc` | `2026-08-20T00:00:00Z` | Skip sell-convergence / thesis-stop. Maturity + `MarketNotOpen` drops still run. |
| `tournamentMode` | `true` | One fat entry/cycle into a strictly +EV side. Kelly 8–14¢ gate does **not** apply (it starved the ranker 08-21). |
| `maxPositionFraction` / `maxMarketFraction` | `0.95` | Dump free cash into that ticket. Exposure is rebuilt from tracked positions after matured drops (no ghost 97 TST). |
| `minPayoutMultiple` / `maxFillPrice` | `3.0` / `0.33` | Wealth multiple `1/fill`, not forecast/fill. Skip anything that cannot 3× the stake. |
| hop-2 (cash ≥ 1500 TST) | `1.6` / `0.65` | So a ~0.58 fill can still compound. |
| WTI settle-below YES | refused | Oil ~$87 vs below $65 on 08-21 — ruin, not a longshot. |
| `entryResolveBufferHours` | `6` | No market that cannot settle+redeem before close. |
| `postCloseGraceHours` | `12` | Loop stays up after 08-24 00:00 for last redeems. |
| `loopIntervalMinutes` | `30` | Hop-1 redeem can recycle same day. |

`convergenceTolerance` / `thesisStopEdge` were **not** moved — rollback is
`endgameHoldFromUtc: undefined` + `tournamentMode: false` + fractions `0.15`
then rebuild + `./deploy.sh <sha>`.

One-thesis, 12h stop-cooldown, and four validation tiers stay ON. Do not
buy WTI YES (spot ~$86 vs below $65 on 08-21). Closest hop-1 tape name on
08-20: UAP YES ~0.32.

### Runbook (once registration completes)

> Status: completed 2026-08-14 — `DELPHI_ENABLED=1` is set on the VPS and the
> runner cycles every 30 minutes (was hourly). Kept for future restarts.

```bash
# On the VPS — set the three Delphi env vars on the earlynotwrong-delphi process
pm2 env earlynotwrong-delphi
# (or set in agent/.env on the server, then:)
pm2 reload earlynotwrong-delphi --update-env

# One-shot smoke test before the loop takes over:
DELPHI_SINGLE_CYCLE=1 node /home/linuxuser/earlynotwrong/agent/dist/lib/delphi/runner.js
```

The runner checks `DELPHI_ENABLED` at cycle time, not at process start, so flipping the var is a reload, not a rebuild.
