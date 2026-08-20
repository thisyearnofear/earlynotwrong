# Early, Not Wrong — Gensyn Delphi Agent Arena

> Submission draft · trading window 2026-08-10 → 2026-08-24
> Competition: https://competition.delphi.fyi/

**An autonomous prediction-market forecaster that shows its work.**

Every probability it trades is built from visible evidence, adversarially cross-examined before money moves, scored against an unbiased calibration record, and anchored on-chain. Being early feels like being wrong. With the right calibration, it isn't.

## Core Stack

| Layer | Technology |
| --- | --- |
| Markets | Gensyn Testnet · Delphi LMSR · competition gateway |
| Estimation | 3-sample LLM ensemble (per-outcome median) · sourced web briefings · realized-vol anchor for crypto thresholds |
| Evidence validation | 4-tier stack: resolution authorities → plausibility filter → two-source corroboration → cross-family adversarial verification |
| Inference | Free-first provider ladder (Vercel AI Gateway → OpenRouter → B.AI DeepSeek → OrcaRouter) with per-provider circuit breakers |
| Risk | Kelly-lite sizing · category-aware edge gates · one-thesis-per-market · thesis-stop re-entry cooldown |
| Exits | Sell-into-convergence (profit at forecast ±2¢, stop at entry −10¢) · settled→redeem / expired→liquidate sweep |
| Proof of view | Mantle ERC-8004 + Casper Odra — every cycle's thesis hashed on-chain |
| Distribution | MCP tools + CROO CAP adapter (x402 micropayments) — predictions go paid only if calibration proves out |

## How It Works

Instead of chasing price, the agent finds markets where its probability estimate disagrees with the LMSR-implied odds by more than an evidence-weighted threshold — and wins when it's calibrated, not just when a coin lands right.

Every hour it:

1. Sweeps settled/expired positions (redeem wins, liquidate dead markets)
2. Checks open positions against their entry thesis (convergence exit / thesis stop)
3. Discovers live markets and scores each with a deterministic resolution authority when one exists (e.g. the Wikimedia pageviews API for a pageview-count market — ground truth, zero inference)
4. Injects a freshness-windowed web briefing (Firecrawl / Parallel rungs), stripped of implausible stale-year passages
5. Estimates probabilities with a 3-sample ensemble, blended with a driftless log-normal vol anchor on crypto thresholds
6. Red-teams each candidate entry with a **different model family** (cross-family adversarial verification) and discounts or blocks on disagreement
7. Sizes via Kelly-lite bankroll fractions with market-exposure caps
8. Anchors the quantized thesis on-chain and appends every estimate — traded or not — to the calibration ledger

## Key Features

**Calibration, not Sharpe.** Prediction markets resolve once, so the submission metric that matters is honest: Brier score, log-loss, and a 10-bin reliability diagram. The agent maintains **two** ledgers — traded forecasts, and every estimate it made (traded or not) — because a forecaster that only scores its convictions can't prove they're real. The all-forecasts number is the one we'd show a signal buyer.

**Visible epistemology.** Every forecast carries provenance — which model, how many samples, whether a sourced briefing or resolution authority backed it, whether a second search rung corroborated it, whether the adversarial verifier cleared it. Telegram, the dashboard card, and the on-chain anchor all surface the same tags.

**Battle-tested resilience.** Two weeks of live trading exposed failure modes no staging environment would, and every one shipped a fix the same day. This is the part we're proudest of:

| Incident (live) | Cost | Fix shipped same day |
| --- | --- | --- |
| Bought both sides of one market 1.5h apart | 193 TST self-hedged | One-thesis-per-market guard + chain reconciliation that adopts orphans |
| 0.95-confidence ensemble collapse (Typhoon YES, settled NO) | 103 TST | 4-tier evidence validation + ensemble median + temperature lift |
| Serial re-entry into a stopped thesis (Chess, 4 buys / 4 days) | −89 TST | 12h thesis-stop cooldown unless new edge strictly beats stop |
| SDK subgraph lag ghosts (settled market listed open) | 92.5 TST pinned | REST maturity guard + `MarketNotOpen()` revert detection |
| Retry loop redeeming losing shares (50× / 36h) | pit gas | REST `winningOutcomeIdx` → close as scored loss |
| Free-LLM ladder collapse (2 providers died mid-run) | estimates → 0 | Per-provider circuit breakers + B.AI DeepSeek rung swapped in hours |
| Hung SDK call froze the runner 13.5h | 13.5h silence | Per-call timeouts + 50-min cycle watchdog |
| 10¹² unit skew made every buy size 0 | 25 dead cycles | 6-dec ↔ 18-dec bridge across all quote/sizing paths |

**Adversarial verification before entry.** A candidate trade must survive a red-team prompt run by a *different model family* than the forecaster — same family, same blind spots. Verification can only discount toward its own view on flagged disagreement ≥ 0.15, and a collapsed edge blocks the trade entirely (ledgered, with the attack recorded).

**Honest exits (mid-window).** We used to sell into convergence when the market price reached our forecast and stop at entry −10¢. That recycled capital mid-window and destroyed the 1/0 payoff at the end — 7 stops vs 5 take-profits. From 2026-08-20 the runner **holds to settlement**; redeem is the only exit.

## Live Record (as of 2026-08-20, day 11/14)

Official leaderboard — the only number that counts: **rank 122/159 · 599.99 TST · PnL −400.01 · 36 trades** from a 1,000 TST start.

We are down. The post-mortem is specific: the losses concentrate in the **exit policy and sizing**, not the forecasts. Selling into convergence trades a 1/0 settlement payoff for an LMSR mid price. 15% Kelly cannot 5× to top 5 from 600 TST.

- Historical internal count through 08-19: **18 entries · 12 exits** (5 convergence take-profits, 7 thesis stops). Board 36 trades includes redeems/failed txs; treat the board as canonical for rank.
- **Endgame correction shipped 2026-08-20:** hold-to-settlement, tournament sizer (95% of free cash into the single highest `forecast/fill` ≥ 2.2×), resolution-deadline filter, 12h post-close redeem grace. Ruin of a hop is accepted.
- Calibration, not P&L, remains the forecaster yardstick — see `allForecasts` on `/delphi/status`.
- Zero inference spend: free tiers, per-provider circuit breakers, promo-expiry guards.

## Architecture

```
open markets (SDK subgraph + REST)
        ↓
resolution authorities (deterministic facts — no LLM)
        ↓
web briefings (firecrawl → parallel → exa, corroborated, plausibility-filtered)
        ↓
3-sample ensemble + vol anchor  →  category-aware edge gate
        ↓
cross-family adversarial verifier (blocks collapsed edges)
        ↓
Kelly-lite mid-window / tournament 0.95 endgame · one-thesis-per-market · chain reconciliation
        ↓
hold-to-settlement (endgame) · redeem/liquidate sweep
        ↓
forecasts.jsonl + forecasts-all.jsonl  →  Brier / reliability
        ↓
Mantle ERC-8004 + Casper Odra  (thesis anchored on-chain)
        ↓
MCP tools / CROO CAP  (signals go paid only if calibration proves out)
```

## MCP Tools

Free trust surface (live today): `get_latest_conviction`, `get_by_thesis`, `get_agent_reputation`, `get_jury_deliberation`

Planned after the post-mortem: `get_predictions` — per-market probability + provenance + cumulative calibration receipt. Gated on the all-forecasts Brier beating the 0.25 coin-flip baseline; the agent doesn't sell a signal it can't score.

## Testing

- **657 TypeScript tests** (Vitest) — executor, forecaster, evidence tiers, lifecycle, calibration math, provider cascade, tournament endgame
- Live autonomous deployment under pm2 with cycle watchdogs
- Real P&J on Gensyn Testnet prediction markets throughout the window

## Links

- Repository: https://github.com/thisyearnofear/earlynotwrong
- Strategy doc: `docs/DELPHI_AGENT_ARENA.md` (in-repo)
- Telegram: https://t.me/earlynotwrongbot
- Prior surface (Hackathon 1 — Casper reputation rail): same repo, `AGENTS.md`

## Vision

Prediction markets are the only adversarial arena where an AI's beliefs carry a timestamp, a price, and a resolution. An agent that survives one — publishing its evidence, its mistakes, and its calibration — stops being a chatbot with opinions and becomes a forecaster with a track record. That record, anchored on-chain, is what other agents (and humans) will pay to query. Early, Not Wrong is building the reputation layer underneath: today Delphi, tomorrow any venue where conviction is priced.
