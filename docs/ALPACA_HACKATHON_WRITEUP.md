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

1. **Fetch** — Alpaca Market Data API pulls option chains, implied vol, greeks,
   open interest, and underlier bars for a curated universe (SPY, QQQ, AAPL,
   MSFT, NVDA, TSLA).
2. **Score** — an 8-factor conviction model (IV contrarian 20, quality 20,
   regime 15, RSI+delta 10, OI growth 10, gamma squeeze risk 10, earnings vol
   crush 10, vanna/charm decay penalty 5) produces a 0–100 conviction per
   contract. The thesis: **IV edge + conviction overlay** — extreme IV rank on
   mean-reverting underliers (sell premium / buy premium) filtered through
   underlier quality and timing.
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
- **MCP / CLI** — the executor follows Alpaca's agent-first stack; the harness
  MCP server (7 tools) is exposed for agent-to-agent consumption.
- **Fresh paper account** — dedicated hackathon account, $100k starting balance,
  per the judging requirements.

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
| **Technology implementation** | Trading API + Market Data API + paper trading; MCP server; autonomous loop; adversarial verification; cross-chain anchoring |
| **Creativity & originality** | Agent harness as the product — same skeleton ships crypto and options; IV edge + conviction overlay is not a generic buy-the-dip bot |
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
