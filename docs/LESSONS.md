# Lessons Learned — Hackathons & Competitions

> Cross-competition post-mortem. Concise by design — the goal is signal, not
> completeness. For per-commit detail, see the **Recently shipped** log in
> `AGENTS.md` and the per-competition docs listed below.

## At a glance

| Competition | Window | Final result | Decision |
|---|---|---|---|
| **Gensyn Delphi Agent Arena** (prediction markets) | 2026-08-10 → 2026-08-24 | Rank 122/159, ~600 TST from 1,000 TST start (PnL −400, 36 trades) | **Archived.** Not enough calibration outperformance vs LMSR. |
| **BNB Hack: AI Trading Agent Edition** (BSC live trading) | 2026-06-22 → 2026-06-28 | Submitted; result not posted publicly | Agent kept live as the **product** (MCP x402, CROO CAP, anchoring). |
| **Alpaca AI Trading Agents Hackathon** (options paper trading) | 2026-08-28 → 2026-09-04 | Live on paper (Aug 29); first fills at Mon open | **In progress.** Pipeline live, adapter verified, strategy predicated on prior lessons — see `docs/ALPACA_HACKATHON_WRITEUP.md` § "Strategy predicate." |

Per-competition source docs: `docs/HACKATHON_SUBMISSION_DELPHI.md`,
`docs/HACKATHON_PLAN.md`, `docs/OKX_HACKATHON.md` (research-only, did not ship).

## Gensyn Delphi Agent Arena

### What was on the line

A 14-day ranked live-trading competition on a permissionless LMSR market.
Prize pool was 1,000 $TST (testnet, but the leaderboard is the public
yardstick). Goal of our entry: prove the agent's **calibration** — Brier
score, log-loss, hit rate, reliability diagram — against the market's own
implicit calibration. Not Sharpe. Calibration was always the right metric
because a prediction market resolves once; you either had the right
probability or you didn't.

### Where we lost

The hole was **exit policy + sizing**, not the model. Two compounding
decisions:

- **Sell-into-convergence was the wrong default for a P&L-ranked arena.**
  The exit fires 7 thesis stops vs 5 take-profits across the run, and
  each exit swaps a 1/0 settlement payoff for the LMSR mid price. On a
  market that resolves in our favor, selling back at mid hands the
  upside to the next buyer. The tournament endgame (`endgameHoldFromUtc`,
  2026-08-20) switched to hold-to-settlement for the last four days; too
  late to recover.
- **15% Kelly cannot 5× from 600 TST to top 5.** We knew this. The
  endgame tried to brute-force rank by dumping 95% of free cash into the
  single highest `forecast/fill` ticket (≥ 2.2× at fill ≤ 0.45; hop-2
  relaxed at 1,500 TST). The intent was `P(top 5)`, ruin accepted. It
  didn't catch the 3× ticket we'd have needed to leap the board — the
  closest tape was UAP YES ~0.32, which would have 3×'d if right.

The model itself was correct more often than it was wrong, but "more
often than wrong" on a 50–60% hit rate is not enough edge to overcome
the exit drag. The takeaway is structural: **a convergence-exit strategy
on a one-shot resolver needs either much higher hit rate (i.e., real
calibration edge) or hold-to-settlement by default**. The current
post-competition config restores convergence exits; the arena-only
tournament knobs are archived in git history.

### Other things that cost real money or trust

- **Correlated overconfidence on Typhoon Dolphin.** Three samples of one
  model family fed one briefing all said 0.95. The market resolved NO.
  Cost: 103 TST. → Built the 4-tier evidence-validation stack
  (resolution authorities, plausibility filter, two-source corroboration,
  cross-family adversarial verification).
- **Free-inference fragility.** The Qwen / GLM / OpenRouter free ladder
  collapsed twice in two weeks (gateway credit exhausted; OpenRouter
  daily cap; hf-qwen community endpoint retired). Estimates fell to 0/cycle
  for stretches. → Multi-rung cascade with per-provider circuit breakers,
  daily-reset sizing on quota 429s, ASCII-header safety, and a
  `b-ai`/OrcaRouter fallback.
- **Subgraph staleness.** `listPositions` kept reporting the resolved
  Chess-Wikipedia market as `awaiting_settlement`; the runner retried
  `quoteSellExactIn` hourly for hours, pinning 92.5 TST. → Pre-sell
  maturity check via `getMarket().resolvesAt` + reactive `MarketNotOpen`
  detection (viem's `BaseError.toString()`, not `err.message`).
- **6 vs 18 decimals bridge.** TST collateral is 6-dec; outcome shares
  18-dec. `quoteBuy`/`quoteSell` divided raw 6-dec tokens by raw 18-dec
  shares and the result rounded every buy to **0 shares**. Survived 500+
  tests because the fakes modeled an 18-dec token world that didn't
  exist. → `SHARE_TOKEN_DECIMAL_SCALE` + `priceRatioScaled()` and
  conversion of every fake to real 6-dec TST.
- **Both-sides self-hedge.** Cycle #27 bought Typhoon YES (edge 0.64);
  cycle #29 bought the same market's NO (edge 0.24). 193 TST self-hedged
  into a guaranteed loss minus fees. → One-thesis-per-market guard.
- **Orphaned positions on pm2 reload.** A deploy reloaded the runner
  before `positions.json`/`exposure.json` were written → next cycle
  entered blind. → `reconcileWithChain()` at cycle start; the chain is
  the source of truth.
- **Serial re-entry into a stopped market.** Bought Chess 4× in 4 days,
  net −89 TST. → 12h thesis-stop re-entry cooldown, edge-strict bypass,
  persisted in the trade ledger (no new state file).
- **Stuck redeem loop.** Typhoon settled NO while we held YES; `redeem()`
  reverted for losing shares; the sweep retried hourly ~50× over 36h,
  pinning 103 TST. → `winningOutcomeIdx` from `getMarket()` lets the
  sweep emit `redeem-lost` and stop.
- **WTI settle-below YES trap.** A "below $65" market priced at YES ~0.3
  when spot was ~$86 — a textbook longshot the model kept saying yes to.
  → Hard-refused in tournament mode.

### What we built that worked

- **The harness, not the strategy.** SDK timeouts, cycle watchdog,
  per-provider circuit breakers, daily-quota 429 sizing, share-decimal
  bridge, maturity pre-check, chain reconciliation, ledger persistence,
  idempotent closeout. Every one of those was a real-money incident.
  The harness is the artifact, not the predictions.
- **4-tier evidence validation.** Tier 1 (deterministic resolution
  authorities — the Chess pageviews verifier resolves the market with
  zero LLM), Tier 2 (stale-passage filter), Tier 3 (two-source
  corroboration), Tier 4 (cross-family adversarial pre-entry verifier).
  Cheap-first. Full provenance threads through forecast → position →
  Telegram tags → arena card.
- **The all-forecasts calibration ledger.** Traded-only calibration is
  selection-biased (you only score markets where edge + sizing let you
  in). The `forecasts-all.jsonl` ledger scores every estimate every
  cycle — that's the number a signal buyer should care about. Still
  didn't beat LMSR mid prices in the window we had. Honest answer:
  archive.
- **Free-first LLM ladder with a real cascade.** Verified-live $0 tiers
  with per-provider breakers. When a rung dies, the next picks up —
  the runner doesn't stop cycling.

### Decision

**Archive.** The all-forecasts calibration didn't clearly beat the
market's own LMSR-implied calibration in the window we had. The model
isn't wrong often — it's just not right *enough*, and the exit policy
plus free-inference fragility ate whatever edge it had. The repo's
post-competition defaults are sane: convergence exits, Kelly-lite
sizing (15% / 35%), normal mode re-arms the 8–14¢ category edge gates,
hourly cadence, `tournamentMode: false`. The arena-only knobs
(`endgameHoldFromUtc`, `tournamentMode`, `tournamentPositionFraction`,
`tournamentMarketFraction`, 30-min cadence) live in git history and
can be re-enabled for a future P&L-ranked window — but only then.

## BNB Hack: AI Trading Agent Edition (BSC, June 2026)

### What was on the line

CMC × Trust Wallet × BNB Chain. 7-day live-trading window, ranked by
total return with a 30% max-drawdown disqualification cap. Track 1
("Autonomous Trading Agents", $24K pool) with three $2K special prizes
(TWAK, Agent Hub, BNB AI Agent SDK). The strategy: the 7-factor
contrarian conviction engine running the 8-step loop on BSC mainnet via
TWAK.

### Where the strategy did and didn't work

- **Bankroll was always going to be the limit.** Testnet BNB worth a
  few dollars through the trading week; the conviction engine wanted to
  size into 15%-of-portfolio positions and a 30% drawdown cap means a
  single bad position can end the run. The contrarian thesis (assets
  down 7d during fear) had the right structural shape but the math
  doesn't work on a $9 entry bankroll.
- **Stuck positions were the operational story.** TWAK's harvest path
  had to learn a ladder (default → 10% → 20% → 49% slippage → USDC
  hop → size probe) because BSB and GWEI were honeypots / blacklisted
  sellers. UAI had a real `SafeTransferFromFailed()` allowance/spender
  mismatch that quote-only false positives can't catch → built a
  pre-entry execution probe (real buy/sell round-trip with a wide
  slippage, reject if the round-trip loss exceeds the cap).
- **SoSoValue rate limits nearly killed the cycle.** First month: 147
  tokens × per-cycle snapshot refresh thrashed the 20-req/min token
  bucket and tripped the 15-min circuit breaker; `Fetched 57/147` was
  normal. → Rolling-window rate limiter + jittered per-token TTL.
- **CMC composite vs SoSoValue-first.** CMC's 147-token batch was
  reserved as a fallback so a healthy SoSoValue cycle spends ~0 CMC
  credits on token quotes; CMC is still used every cycle for global
  metrics and derivatives that SoSoValue doesn't carry. Saves real
  money on the free tier.
- **Pre-trade discovery cohesion.** Discovery inverted the product
  thesis for one cycle — it ranked wallets by conviction × Ethos
  social multiplier (up to 1.5×). → Fixed: behavioral conviction is
  the only ranking weight. Ethos is the access gate, never the
  ordering. Dead multiplier machinery deleted.

### What was worth shipping from the BNB run

- The **harvest fallback ladder** (default → 10% → 20% → 49% → USDC hop
  → size probe). Every TWAK-backed agent will eventually need this.
- The **pre-entry execution probe** for thin-liquidity tokens
  (`< $20k DexScreener`). Catches honeypots and allowance/spender
  mismatches that quote-only paths can't.
- **Stuck-position blocklist + active-only position cap.** Stuck tokens
  no longer consume the open-position cap.
- **The 7-factor scoring engine itself.** Contrarian + RSI + quality +
  regime + holder growth + volatility penalty + LLM jury. The
  LLM-jury digest + thesis-hash dedup is what made the cross-chain
  anchoring cheap enough to run every cycle.

### Decision

**Keep the agent alive.** The BNB run closed, but the agent is the
product now. The 8-step loop is the substrate for the paid surfaces:
MCP x402 reputation tools, CROO CAP `signals-live` (live), CROO CAP
`wallet-score` (live, $0.05 USDC, behavioral conviction scoring of any
wallet), Mantle + Casper anchoring receipts, the wallet-score SKU.
Running it is the demo; turning it off is throwing away a live A2A
node.

## Cross-cutting lessons

1. **Calibration, not Sharpe, is the right yardstick for prediction
   markets.** The yardstick the strategy doc promised. The Brier score
   on the all-forecasts ledger is the number — and if it doesn't beat
   the LMSR's own implicit calibration, there is no signal to sell.
2. **Test fakes must mirror the production unit world exactly.**
   6 vs 18 decimals survived 500+ tests because the fakes invented a
   different world. The lesson is structural, not delphi-specific.
3. **Free inference is a fragility tax, not a budget line.** Every
   free rung we used died at some point during the run. The cascade
   matters more than any individual rung; the per-provider circuit
   breaker is what kept cycles alive.
4. **Cross-chain anchoring is cheap, not free.** The thesis-hash
   dedup (quantized: 5-pt adjustment buckets, drop neutrals, sort by
   symbol) is what made every-cycle anchoring viable on the testnet
   CSPR balance. Without it, anchors churn on LLM jitter and the
   operator wallet drains.
5. **Operate, don't just develop.** The agent had a `pm2` process
   that was silently idling (`argv[1]` mismatch in the entry guard) on
   day one. The `withTimeout` / cycle-watchdog / chain-reconciliation
   trifecta is the difference between a hackathon demo and a live
   process. None of those ship themselves.
6. **Honeypots are a fact of BSC, not an edge case.** The TWAK
   harvest ladder and pre-entry probe are the table stakes for
   permissionless DEX work; the same shape (fallback ladder + probe
   + blocklist) generalizes to any venue where a quote can lie.
7. **Document the failure modes with the same energy as the
   features.** Every "shipped" bullet in `AGENTS.md` started as a
   real-money or live-bankroll incident. The "Recently shipped" log
   is the only durable record of what the harness actually protects
   against — features, by themselves, are not.

## What we'd do differently next time

- **Run a 7-day offline calibration backtest on a comparable LMSR
  market before going live.** We went straight to live trading and
  discovered the calibration gap on the leaderboard.
- **Default to hold-to-settlement on any one-shot resolver** unless
  the convergence-exit edge is independently proven.
- **Cap single-position sizing at 15% even in tournaments.** The 95%
  dump is ruin-accepted sizing and it didn't pay off; a Kelly-fractional
  alternative probably preserves the upside without the blowup tail.
- **Pre-flight the LLM ladder at boot, not at first use.** Discovering
  the gateway was 402-throttled after the bankroll landed cost a
  measurement cycle. The boot probe should walk every rung with a
  throwaway prompt and fail loudly if any are dead.
- **Persist every estimate, not just the traded ones, from day one.**
  We added `forecasts-all.jsonl` mid-run; it should have been the
  default.
