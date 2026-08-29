# Alpaca AI Trading Agents Hackathon — Submission Write-up

**Project:** Early, Not Wrong — Conviction-Native Options Agent
**Repository:** https://github.com/thisyearnofear/earlynotwrong
**Domain:** Options (paper trading) — autonomous agent built on a domain-agnostic harness

---

## One-page write-up

### The pitch

Early, Not Wrong is an autonomous options trading agent. It is not an options
strategy with an agent bolted on — it is an **agent harness** (a battle-tested
autonomous trading skeleton) with options as its first proof-of-pattern domain.
The same skeleton that runs our crypto conviction agent (LLM ensemble, adversarial
verification, risk guardrails, self-analysis, on-chain thesis anchoring) now runs
options on Alpaca's paper trading environment. One skeleton, two domains, zero
strategy-specific rewrites.

### AI logic

Each hourly cycle:

1. **Fetch** — Alpaca Market Data API pulls option chain quotes, underlier
   snapshots, and underlier bars for a curated universe (SPY, QQQ, AAPL,
   MSFT, NVDA, TSLA). The Basic plan's indicative feed exposes no option
   IV/greeks, so we derive them from the two-sided quote via Black-Scholes
   inversion, and score premium *relative to the underlier's realized vol*.
2. **Score** — an 8-factor conviction model (IV contrarian 20, quality 20,
   regime 15, RSI+delta 10, OI growth 10, gamma squeeze risk 10, earnings vol
   crush 10, vanna/charm decay penalty 5) produces a 0–100 conviction per
   contract. The thesis: **cheap premium, not momentum** — an option priced
   below its underlier's realized vol (IV/RV ≪ 1) has room to expand, so it
   scores high; rich premium (IV/RV ≫ 1) is crush-prone and scores low. The
   agent is **long-only** (buy-to-open), so IV drives *which* contract to buy,
   not a sell side.
3. **Verify** — the cross-family LLM adversarial verifier attacks the thesis
   before entry (base rates, timing, evidence quality); flagged disagreement
   blocks the entry.
4. **Manage** — open positions are re-quoted every cycle; conviction decay
   (>25pt drop) or max-hold triggers exit. The calibration ledger scores every
   forecast (Brier, log-loss) — "calibration, not Sharpe."
5. **Learn** — self-analysis computes behavioral conviction from the ledger,
   and the cycle thesis is anchored on-chain (Mantle ERC-8004 + Casper) for
   tamper-evident decision provenance.

### Risk gates

- **Drawdown cap** — 25% peak-to-current portfolio drawdown halts new entries.
- **Concentration cap** — no single underlier exceeds 20% of portfolio.
- **Position cap** — 10 open contracts max; entries fail closed without a
  portfolio snapshot.
- **Buying-power check** — per-trade size = min($500, 10% of portfolio, 25% of
  cash); insufficient buying power blocks the order.
- **Liquidity filter** — contracts below $10k volume×price are skipped.
- **Fail-closed defaults** — no portfolio, no keys, no data → no entries.
  Exits are never blocked.

### Alpaca infrastructure implementation

- **Trading API** — order placement (`POST /v2/orders`), position close
  (`POST /v2/positions/{id}/close`), account + portfolio reads (`/v2/account`,
  `/v2/positions`), and the options chain (`GET /v2/options/contracts?underlying_symbols=`).
  Paper environment by default (`ALPACA_PAPER=0` for live).
- **Market Data API** — options quotes (`v1beta1/options/snapshots`), underlier
  snapshots + daily bars (`v2/stocks/{s}/snapshot`, `v2/stocks/bars`) for
  RSI/regime. Implied vol + greeks are derived from quotes via Black-Scholes
  inversion (the Basic plan's indicative feed exposes no IV/greeks directly).
- **MCP / CLI** — orders are placed through Alpaca's official **CLI**
  (`alpacahq/cli`, v0.0.14 prebuilt binary on the VPS) via a `execFile`
  wrapper (`agent/lib/adapters/alpaca-cli.ts`) — the hackathon's "MCP or CLI"
  requirement. The CLI is agent-first: structured JSON output, no prompts,
  idempotent `--client-order-id` for retry safety, `--dry-run` preview. The
  executor is CLI-first with an automatic REST fallback, so a missing/failing
  CLI can never break the live path. (The harness also runs its own MCP server
  exposing our conviction tools for agent-to-agent consumption.)
- **Fresh paper account** — dedicated hackathon account, `PA34CZ7DH98R`
  (ACTIVE, $100k starting balance, options level 3, 4× Reg-T buying power),
  per the judging requirements.

### Partner technology: Featherless AI

Featherless AI is a hackathon **technology partner** — "to be eligible for
partner prizes, the relevant partner technology must be integrated into a
project submitted under the challenge." We use it as a **real rung in the
shared LLM provider ladder** (`agent/lib/llm-providers.ts`), not a token
credit:

- **Position** — after the free tiers (Vercel AI Gateway, OpenRouter `:free`,
  B.AI, OrcaRouter) but before the paid keys (OpenAI, Anthropic). Sponsor
  credits get spent before a real billing key is touched.
- **Why it's an edge, not a checkbox** — the ladder already feeds the token
  conviction jury, the Delphi forecaster, the adversarial pre-entry verifier,
  and the market narrative. Adding Featherless means every one of those
  surfaces inherits a genuine open-source-inference fallback rung, so a free
  tier 402/429 degrades to an equally-capable (open-source, sponsor-backed)
  model instead of falling to a paid key or a template. The cross-family
  verifier treats Featherless as family `qwen` (distinct from the `deepseek`
  family), so adversarial cross-examination still works.
- **Model** — `Qwen/Qwen2.5-72B-Instruct` via the OpenAI-compatible
  `FEATHERLESS_BASE_URL` (default `https://api.featherless.ai/v1`). Keyed by
  `FEATHERLESS_API_KEY`. Configurable per-surface
  (`FEATHERLESS_JURY_MODEL` / `FEATHERLESS_DELPHI_MODEL` /
  `FEATHERLESS_NARRATIVE_MODEL`).
- **Documented access** — `$25` participant credits, first-come first-served,
  activated via lablab; `FEATHERLESS_API_KEY` + `FEATHERLESS_BASE_URL` are
  documented in `agent/.env.example` and set locally and on the VPS.

### Harness architecture (the meta-point)

The agent is built on a domain-agnostic harness with three extension points —
`DataSource`, `ConvictionFactors`, `TradeExecutor`. The options domain
(`HARNESS_DOMAIN=options`) is one registered adapter triple alongside the crypto
domain. Everything else — the loop, LLM ladder, jury, verification,
self-analysis, anchoring — is shared and unchanged. A new market (equities,
crypto, futures) is three new adapter files, not a new agent.

---

## Judging criteria mapping

| Criterion | Where we hit it |
|-----------|----------------|
| **P&L performance** | Paper-traded options with conviction overlay; self-analysis + calibration ledger prove the agent measures its own edge |
| **Technology implementation** | Trading API + Market Data API + paper trading; Alpaca **CLI** for order execution (IDempotent client-order-id, REST fallback); harness MCP server; autonomous loop; adversarial verification; cross-chain anchoring |
| **Creativity & originality** | Agent harness as the product — same skeleton ships crypto and options; cheap-premium (IV vs realized-vol) long-only overlay is not a generic buy-the-dip bot |
| **Presentation & execution** | Full 8-step pipeline with per-cycle evidence, Telegram dispatch, honest empty states, public repo |

## How to run

```bash
export HARNESS_DOMAIN=options
export ALPACA_API_KEY_ID=...
export ALPACA_API_SECRET_KEY=...
cd agent
npm start
```

Startup banner confirms the domain + adapters; the first cycle fetches chains,
scores conviction, checks risk, and places orders in the paper account.

---

## Live status (2026-08-29)

The options agent is **live on Alpaca paper** — the full 8-step cycle runs
end-to-end against the real paper account, not a simulator:

- **Real portfolio** — reads the dedicated $100k hackathon account
  (`PA34CZ7DH98R`, ACTIVE, options level 3, 4× Reg-T buying power).
- **Real market data** — 718 contracts fetched + scored across SPY, QQQ,
  AAPL, MSFT, NVDA, TSLA (7–90d expiries); IV + greeks derived from live
  quotes via Black-Scholes inversion (the Basic plan's indicative feed
  exposes no IV/greeks, so we compute them ourselves).
- **Real orders** — proposals ≥ 40 conviction are executed through Alpaca's
  official CLI (`alpaca order submit`, idempotent `--client-order-id`, REST
  fallback). Inside market hours they fill; outside market hours they are
  correctly rejected (`options market orders are only allowed during market
  hours`) and the cycle fails closed — no entries, exits never blocked.

### Free-data prep (2026-08-29) — what we tap before Monday's open

Alpaca's Basic plan is quote-only: no option IV/greeks, no open interest, no
option volume, no option bars. We don't pay for OPRA. Instead we derive the
edges from what the free tier does expose, so the agent's conviction is
relativized rather than absolute:

- **Realized vol vs. implied vol (IV/RV)** — we fetch each underlier's 30
  daily `iex` bars and compute annualized realized vol, then score every
  option's IV *relative* to its underlier's RV. IV/RV ≪ 1 → cheap premium
  (buyside edge, IV has room to expand); IV/RV ≫ 1 → rich premium
  (crush risk, avoid). This is the real "is the option cheap or rich?"
  signal and replaces the naive absolute-IV cutoff.
- **Free news feed** (`/v1beta1/news`) — per-underlier headlines + summaries
  (6h-cached) seed an earnings-timing flag (`earningsNear`) that drives the
  existing earnings-vol-crush factor, and a lexical sentiment bias that
  nudges conviction toward the aligned side (bullish headline → call premium).
  Couldn't get a real earnings calendar (Alpaca doesn't expose one on this
  plan), so the news feed is the proxy.
- **Market-hours clock** (`/v2/clock`) — the execution step is now gated on
  live market open instead of firing orders that Alpaca rejects off-hours.
  Analysis + scoring + proposals still run every cycle so the dashboard stays
  live; orders are deferred to the next open. `nextOpen` is surfaced in
  `/status` so the dashboard shows *when* it can actually trade.

Trading is **market-hours gated** (Mon–Fri 09:30–16:00 ET) and paper only —
no real money is at risk. First paper fills land at Monday's open.

### Strategy predicate — what this builds on

The options strategy is not invented from scratch. It is the same conviction
core we validated — and lost money against — across two prior competitions,
re-expressed for options:

1. **Calibration, not Sharpe** (Gensyn Delphi Arena). A prediction
   instrument is only worth what its probability estimate is worth. The
   agent scores itself with Brier / log-loss on a calibration ledger, and
   every entry thesis is attacked by a cross-family adversarial verifier
   before it fires. IV edge + conviction overlay is the options analog of
   the conviction-core mispricing approach: buy premium when IV rank is
   extreme on a mean-reverting underlier, filtered by quality and timing.
2. **The harness is the artifact** (both runs). What survived real money
   was the skeleton — loop, ladder, verification, risk, ledger, anchoring —
   not any single prediction. Options is proof-of-pattern: same skeleton,
   three new adapter files.
3. **Fail closed by default** (both runs). No portfolio, no keys, no data,
   market closed → no entries. Exits are never blocked. Every real-money
   incident (orphaned positions, both-sides self-hedge, serial re-entry)
   traced back to a missing guard, not a missing model.
4. **Free-first data, with a fallback ladder** (LLM-ladder fragility from
   Delphi). Paid feeds collapse, free ones degrade — so we derive IV from
   the Basic plan's indicative quotes rather than paying for OPRA, and
   underlier bars use the `iex` feed the plan actually allows.
5. **Don't churn** (Delphi exit policy + serial re-entry). Conviction-decay
   and max-hold exits replace the sell-into-convergence behavior that cost
   the arena run; a position cap and liquidity filter keep the agent from
   over-trading illiquid contracts.
