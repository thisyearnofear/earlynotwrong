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
  executor.ts      — DelphiExecutor: listMarkets/quote/buy/redeem/liquidate wrapper
                     with retry + slippage guard + simulator mode. Position lifecycle
                     reads (listPositions/getErc20Balance/getOpenPositions). Lazy-imports
                     the SDK; tests inject a DelphiClientLike fake.
  probability.ts   — probability estimation + sizing. estimateProbability (OpenRouter >
                     OpenAI > Anthropic > injected via the shared llm-providers ladder),
                     evaluateProbabilitySignal (pure edge gate), normalizeEstimate
                     (sum-to-1 invariant on both paths), and sizeSharesBudget/
                     perTradeBudget (Kelly-lite bankroll fractions).
  lifecycle.ts     — settled-market redemption + expired/failed liquidation sweep.
                     Per-market failure isolation; sized by groupOutcomesByMarket.
  anchoring.ts     — on-chain thesis anchoring (the analog of BSC cycle step 8).
                     Quantizes the cycle's decisions (edges bucketed to 0.05, neutrals
                     dropped, sorted) into a digest, hashes via conviction-core, and
                     publishes through the shared Mantle + Casper adapters with
                     thesis-hash dedup persisted in the snapshot.
  runner.ts        — standalone loop entry (pm2 process earlynotwrong-delphi): sweep
                     → discover → estimate → gate → size → trade → anchor. JSONL trade
                     ledger, open-position ledger (positions.json), resolved-forecast
                     calibration ledger (forecasts.jsonl), snapshot, and exposure.json
                     under AGENT_DATA_DIR/delphi/; DELPHI_ENABLED is a runtime check,
                     not a build-time config value.
  status.ts        — disk-backed read of the runner's persisted state for the main
                     HTTP server (separate pm2 process, so no shared memory). Powers
                     GET /delphi/status and the dashboard's Prediction Arena card.

packages/conviction-core/src/calibration.ts
                   — pure calibration metrics shared with any future consumer:
                     brierScore, logLoss, hitRate, reliabilityBuckets (10 equal-width
                     bins), calculateCalibrationMetrics. Prediction markets resolve
                     once, so estimation accuracy — not Sharpe — is the yardstick.
```

LLM plumbing note: the OpenRouter > OpenAI > Anthropic ladder lives in
`agent/lib/llm-providers.ts` (`chatCompletion`) and is shared by the token
jury (`llm-jury.ts`) and the Delphi forecaster (`delphi/probability.ts`) —
one place to change model defaults, timeouts, or add a provider.

Env (added to `agent/manifest.json` secrets + `.env.example`):

| Var | Purpose |
|---|---|
| `DELPHI_ENABLED` | Master switch (default off until registered/funded) |
| `DELPHI_NETWORK` | `competition-testnet` now, `mainnet` later |
| `DELPHI_API_ACCESS_KEY` | REST reads (markets/positions). Generate at https://delphi-api-access.gensyn.ai/ |
| `DELPHI_WALLET_PRIVATE_KEY` | Fresh, competition-only keypair. Never the TWAK or Casper operator key |

Key SDK facts (v2.1.0): `competition-testnet` network auto-sends `X-Delphi-Mode: competition`; chain ID 685685; competition gateway `0x097599c9D966fF496284b892A8F13BF885b258ef`; market statuses `open | awaiting_settlement | settled | expired | failed` — `settled` → `redeemMarket`, `expired`/`failed` → `liquidate`.

## Phased plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Register wallet on DoraHacks, faucet gas, API key | **in progress (user)** |
| 1 | `agent/lib/delphi/executor.ts` + config + tests | **landed** — 14 tests, `DelphiExecutor` with lazy SDK import, slippage guard, simulator mode |
| 2 | Probability estimation: LLM jury for market questions + deterministic edge gate | **landed** — `agent/lib/delphi/probability.ts`, `estimateProbability` (shared `llm-providers` ladder) + `evaluateProbabilitySignal` (edge vs. minEdgeToTrade + slippage) + `normalizeEstimate` invariant |
| 3 | Standalone runner loop + pm2 process + Telegram reporting | **landed** — `agent/lib/delphi/runner.ts`, `earlynotwrong-delphi` pm2 app, `sendDelphiCycleSummary`, JSONL trade ledger + snapshot under `AGENT_DATA_DIR/delphi/`, gated by `DELPHI_ENABLED` (checked per cycle, not at build) |
| 4 | Position lifecycle, redemption scanner, bankroll-aware sizing | **landed** — `agent/lib/delphi/lifecycle.ts` (settled→redeem / expired+failed→liquidate sweep, per-market failure isolation), executor extended with `listPositions`/`liquidate`/`getErc20Balance`/`getOpenPositions`, `sizeSharesBudget` + `perTradeBudget` (Kelly-lite: `maxPositionFraction`/`maxMarketFraction` caps), per-market exposure ledger (`exposure.json`) |
| 4b | On-chain anchoring + calibration ledger + dashboard surfacing | **landed** — `delphi/anchoring.ts` publishes a quantized per-cycle thesis via the shared Mantle + Casper adapters (thesis-hash dedup persisted across restarts); resolved redemptions feed `forecasts.jsonl`; `packages/conviction-core/src/calibration.ts` computes Brier / log-loss / hit-rate / reliability buckets; `GET /delphi/status` + the dashboard's Prediction Arena card (Proof view) surface it live |
| 5 | Post-mortem: run the calibration report over `forecasts.jsonl`; decide graduate-or-archive | after 08-24 |
| 6 | If graduate: `DELPHI_NETWORK=mainnet`, MCP tool `getPredictionSignals`, CAP serviceId `predictions-live` | later |

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

### Runbook (once registration completes)

```bash
# On the VPS — set the three Delphi env vars on the earlynotwrong-delphi process
pm2 env earlynotwrong-delphi
# (or set in agent/.env on the server, then:)
pm2 reload earlynotwrong-delphi --update-env

# One-shot smoke test before the loop takes over:
DELPHI_SINGLE_CYCLE=1 node /home/linuxuser/earlynotwrong/agent/dist/lib/delphi/runner.js
```

The runner checks `DELPHI_ENABLED` at cycle time, not at process start, so flipping the var is a reload, not a rebuild.
