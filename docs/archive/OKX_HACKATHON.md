# OKX.AI Trading Hackathon — Research & Strategy

> Status: **researched, pending go/no-go.** Prize pool doubled to $40K USDT.
> Source: https://okx.ai/hackathon (fetched 2026-08-06).

## The opportunity (at a glance)

| | |
|---|---|
| **Prize pool** | $40,000 USDT (doubled from $20K) |
| **1st** | $10,000 + OKX social & product exposure |
| **2nd** | $7,000 + exposure |
| **3rd** | $4,500 + exposure |
| **Ranks 4–40** | $500 each |
| **Registration** | July 31 – **August 11, 12:00 UTC+8** (closes soon) |
| **Competition** | August 11, 12:00 – August 25, 12:00 UTC+8 (2 weeks) |
| **Format** | Live-trading leaderboard — PnL% + net PnL, ranked live |
| **Entry** | Deploy a **Trading ASP** on OKX.AI (Onchain OS or Agent Trade Kit) |

## Why this is a strong fit for us

This hackathon is **the thesis test** the project has been building toward.
Everything we've built — the conviction engine, the edge report, the
behavioral scoring — is a trading strategy that claims to have edge. This
is a public, ranked, live-money test of that claim.

| Our asset | Hackathon need |
|---|---|
| 7-factor conviction engine (contrarian + RSI + quality + regime + holders + LLM jury) | "Put your trading agent on the leaderboard" — a strategy |
| `runEdgeReport()` — conviction vs naive baseline, regime-conditional | Proof the strategy has edge *before* we risk capital |
| Live agent on BSC (TWAK + SoDEX) | A running autonomous trader |
| `signals-live` CROO product | Already a "Trading ASP" in spirit — a signal service |
| On-chain anchoring (Casper + Mantle) | Verifiable track record, not self-reported |
| `wallet-score` (just built) | The behavioral-scoring framework that scores *our* trades too |

**The core pitch:** "Early, Not Wrong" is a conviction-weighted trading ASP
that holds through drawdown and anchors every thesis on-chain. The edge
report proves it beats a naive baseline in fear regimes. The hackathon is
2 weeks of live PnL to prove it in public.

## The two entry paths — and which one we take

The hackathon offers two accounting bases. **This is the critical decision.**

### Path A: Onchain OS (✅ recommended)

- **How it works:** Bind an Agentic Wallet address, execute on-chain trades
  through Onchain OS. Leaderboard tallies on-chain trading performance for
  that wallet.
- **Instruments:** No restrictions — any on-chain trade the wallet makes.
- **Fit for us:** **Strong.** Our agent already trades on-chain (BSC via
  TWAK/SoDEX). The Agentic Wallet can be funded and the agent's existing
  BSC execution path can target it. Our conviction signals → on-chain BSC
  swaps → leaderboard PnL.
- **The work:** Adapt the agent to trade through the OKX Agentic Wallet
  (via the `onchainos` CLI / Onchain OS) instead of (or alongside) TWAK.
  The OKX agentic-wallet skill covers swap/bridge/limit-order flows.

### Path B: Agent Trade Kit (❌ not recommended)

- **How it works:** Bind an OKX UID, trade through Agent Trade Kit (OKX
  Trade CLI / MCP). **USDT Perpetual instruments only.**
- **Fit for us:** Weak. Our entire stack is spot BSC conviction (holder
  growth, on-chain liquidity, BEP-20 tokens). We have no perps engine, no
  funding-rate-aware position sizing for perps, and no OKX exchange
  integration. Building a perps trader in 5 days is a different product.
- **Verdict:** Skip. We'd be competing with our weak hand.

**Decision: Path A (Onchain OS).** Our conviction engine is built for spot
on-chain; Onchain OS lets us trade on-chain and have it count.

## The hard constraints (read these twice)

1. **$300 USDT minimum principal.** The ASP must start with ≥ 300 USDT
   equivalent. This is real money at risk for 2 weeks.
2. **≥ 1 valid trade during the competition.** No-trade = invalid entry.
   Our 4h cycle produces trades; this is easy.
3. **ASP must stay online the whole 2 weeks.** Downtime = lost trades +
   lost leaderboard position. Our agent is already pm2-managed on Vultr;
   we need to harden uptime + add a monitor.
4. **One subscription service required.** The ASP must offer one
   subscription service (snapshotted at start as the scoring basis). This
   is literally our `signals-live` CROO product — we already have it.
5. **Registration closes August 11, 12:00 UTC+8.** That's the hard
   deadline. ASP review takes ~24h, so we need to submit by **August 10**.

## The thesis we're proving

> **"Early, not wrong" — a conviction-weighted trading agent that holds
> through drawdown beats a naive baseline on risk-adjusted return in fear
> regimes, verifiable on-chain.**

The edge report already tests this against a naive random-entry baseline.
The hackathon tests it against **other people's strategies** — a stronger
test. If we land in the top 40, that's $500 + the on-chain track record
becomes a marketing asset. If we land top 3, the prize + OKX exposure is
material.

**The honest risk:** Our edge report shows regime-conditional edge (fear
regimes), and the competition is 2 weeks. If the window is greed-dominated,
our contrarian signal is *designed* to underperform there — we'd be
"early, not wrong" but the leaderboard measures PnL, not thesis fidelity.
This is the same honesty tension as the regime-conditional edge report:
we should compete, but we should compete *as the thing we are* and say so.

## What we'd need to build (5-day sprint to Aug 10)

| Priority | Work | Effort | Why |
|---|---|---|---|
| P0 | **Register the ASP on OKX.AI** (Onchain OS path) — install `onchainos` skills, register an ASP identity, list `signals-live` as the subscription service | 2–4h | The deadline gate. Everything else is moot if we're not registered. |
| P0 | **Fund the Agentic Wallet** with ≥ 300 USDT (competition principal) | 1h | Hard requirement. Real money. |
| P0 | **Adapt the agent to trade via Onchain OS** — swap the TWAK execution path for `onchainos wallet swap` (or run both, with Onchain OS as the leaderboard-counted path) | 1–2 days | The leaderboard only counts on-chain trades through the bound wallet. Our BSC swaps via TWAK won't count unless they're through the Agentic Wallet. |
| P1 | **Uptime hardening** — pm2 restart-on-crash (have it), a heartbeat monitor, and a Telegram alert on cycle failure (have alerts, need a dead-man's-switch) | 4h | 2 weeks of uptime. One 12h outage = lost cycles. |
| P1 | **Leaderboard PnL optimization** — the ranking is PnL% + net PnL. With $300 principal, PnL% is the lever. Our bankroll-aware sizing caps at 15% per trade; we may want to concentrate more during the competition window. | 1 day | Ranking math. $300 × 15% × 4 trades = $180 to win/lose; we need bigger position sizing for the competition to move the needle. |
| P2 | **Public dashboard / proof** — the `/agent` dashboard + edge report as the "proof" surface for the ASP listing. OKX exposure (top-3 prize) is partly social. | 4h | The "OKX social & product exposure" part of the prize rewards a good story. |
| P2 | **Daily PnL + thesis post** — a daily X post with the day's conviction calls + on-chain anchor links, tagged #OKXAIHackathon | 30min/day | Social visibility during the competition. |

**Total: ~3–4 focused days** to be competition-ready by Aug 10.

## The strategic question (go/no-go)

**Arguments for:**
- It's the live, public, ranked test of the thesis. "Prove your strategy in
  public" is literally the hackathon tagline and our project's ethos.
- $40K pool, top-40 pays $500, top-3 pays $4.5K–10K. Even a middling
  showing covers the $300 principal + infra.
- The OKX exposure (top-3) is worth more than the cash if we're building a
  product — it's distribution for `signals-live` + `wallet-score`.
- We already have 90% of the stack: conviction engine, live agent, edge
  report, CROO ASP listing, on-chain anchoring.
- The `signals-live` CROO product is already a "subscription service" —
  we satisfy the ASP service requirement with what we have.

**Arguments against:**
- $300 real money at risk for 2 weeks. If the 2-week window is
  greed-dominated, our contrarian signal is designed to underperform — we
  could lose money *and* rank poorly* while being "right" by our thesis.
- Adapting the execution path to Onchain OS is real work (1–2 days) with
  integration risk (a new swap path, new failure modes) right before a
  hard deadline.
- The leaderboard ranks on PnL, not thesis fidelity. We'd be competing
  against momentum/perps strategies optimized for 2-week PnL, not
  conviction-hold-through-drawdown. Our strategy is *designed* to look bad
  on a 2-week PnL leaderboard in a greed window.
- Registration closes Aug 10–11 — 4–5 days. Tight.

**The honest read:** The fit is real but imperfect. Our edge is
regime-conditional (fear) and behavioral (hold through drawdown); the
leaderboard is unconditional PnL over 2 weeks. We could be "early, not
wrong" and still rank poorly. **But** the upside (prize + exposure +
verifiable public track record) is material, and the work (Onchain OS
execution path) is reusable beyond the hackathon. The thesis is only
"proved in the wild" if we actually run it in the wild.

## Recommendation

**Go, with eyes open.** Register by Aug 9 (leave 24h for ASP review).
Enter via Onchain OS (Path A). Treat the $300 as marketing spend — the
verifiable on-chain track record is worth more than the cash regardless of
ranking. Compete *as the thing we are*: a conviction agent that holds
through drawdown. If the window is greed and we underperform, the edge
report + on-chain anchors let us tell the honest story ("regime-conditional
edge, here's the fear-segment Sharpe") — which is itself the product pitch
for `wallet-score` and `signals-live`.

**Do NOT** pivot the strategy to chase the leaderboard (perps, momentum,
degen sizing). That would test a strategy we don't have, with edge we
haven't measured, and risk capital we can't justify. If we compete, we
compete on conviction or we don't compete.

## Next steps (if go)

1. **Today (Aug 6–7):** Install Onchain OS (`npx skills add okx/onchainos-skills`),
   register an ASP identity, list `signals-live` as the subscription service.
   This is the deadline-critical path.
2. **Aug 7–8:** Fund the Agentic Wallet ($300 USDT). Adapt the agent's
   execution path: add an `onchainos wallet swap` executor alongside TWAK,
   gated so competition trades route through the Agentic Wallet.
3. **Aug 8–9:** Uptime hardening + a competition-mode flag (concentrated
   sizing, daily PnL post). Smoke-test a full cycle through Onchain OS.
4. **Aug 9:** Submit the ASP for review (24h buffer before the deadline).
5. **Aug 11–25:** Run. Daily PnL + thesis post. Let the edge report tell
   the honest story regardless of ranking.

## What this is NOT

- Not a pivot to perps (Path B is explicitly rejected above).
- Not a new strategy — it's our existing conviction engine on a new
  execution rail (Onchain OS) for a public test.
- Not a substitute for the CROO `wallet-score` product — that's the
  scarce product; this is the public proof. They reinforce each other:
  the hackathon track record becomes the `provenance.behavioral` data in
  `signals-live`, and `wallet-score` scores the wallets that beat us.
