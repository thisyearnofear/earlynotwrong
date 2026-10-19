# Hackathon Archive

---

## 1. SigNoz Observability Hackathon (2026)

### Overview

SigNoz is an open-source observability platform built on OpenTelemetry. This hackathon requires deep integration with SigNoz — traces, metrics, logs, dashboards, and alerts.

**Tracks:** AI & Agent Observability, Signals & Dashboards, Build Your Own.

**Required tech:** Must use or integrate SigNoz. Install via Foundry. Repo must include `casting.yaml` and `casting.yaml.lock`.

**Judging:** The more deeply you lean on SigNoz and OpenTelemetry — traces, metrics, logs, dashboards, alerts — the stronger your submission.

### EarlyNotWrong's Fit

| Criterion | EarlyNotWrong's Position |
|---|---|
| **Agent complexity** | 8-step autonomous trading pipeline (`runCycle`): portfolio → market data → conviction scoring (6 deterministic + LLM jury) → position management → trade proposals → guardrails → execution (SoDEX/TWAK) → cross-chain anchoring (**Mantle + Casper** on the agent). Plus self-analysis, market narrative, and adaptive interval doubling. **Aleo** is a separate user-facing proof path via the web analyzer (`/analyzer`), not part of the agent's per-cycle anchor loop |
| **Existing observability** | Ad-hoc: Hono HTTP server with `/status`, `/trades`, `/conviction` endpoints; Telegram 3-message cycle summaries; SQLite persistence; console logging. No structured tracing, no metrics aggregation |
| **OpenTelemetry surface** | Every step of `runCycle` maps to a trace span. The 8-step pipeline + sub-steps (7-factor scoring, LLM jury, TWAK execution, cross-chain anchoring) produce 15–20 spans per cycle. Perfect for trace waterfall visualization |
| **Dashboard value** | Cycle-by-cycle conviction scores, trade PnL over time, bankroll health, guardrail hit rate, **agent anchor success rate (Mantle vs Casper)**, LLM jury adjustment distribution, SoSoValue/CMC API latency per cycle |
| **Alert potential** | Guardrail breaches (drawdown, daily limit), TWAK execution failures, anchor failures/skips on Mantle or Casper, LLM jury timeout, stuck positions detected, bankroll below reserve |

**Best track:** **AI & Agent Observability** — The autonomous trading agent with LLM jury, multi-chain anchoring, and 8-step pipeline is the archetypal AI agent observability use case.

### Proposed Integration

| SigNoz Feature | EarlyNotWrong Integration |
|---|---|
| **Traces** | OpenTelemetry spans around every `runCycle` step: `fetch_portfolio`, `fetch_market_data`, `score_conviction` (with sub-spans for regime + top candidates), `llm_jury`, `manage_positions`, `create_proposals`, `check_guardrails`, `execute_trades`, `anchor_chains`, `generate_narrative`, `self_analysis`. Trace attributes for cycle number, conviction scores, trade count, per-adapter anchor status |
| **Metrics** | Portfolio value over time, conviction score distribution, guardrail hit rate, trade win/loss ratio, anchor success rate per chain (Mantle, Casper), API latency (SoSoValue, CMC, NodeReal), LLM jury latency per cycle, cycle duration |
| **Logs** | Structured JSON replacing ad-hoc console.log. Route existing Telegram-level cycle summaries through OTel logs with trace context |
| **Dashboards** | Trading operations dashboard: portfolio health, conviction signals over time, guardrail activity, Mantle/Casper anchor reliability, API dependency health, agent treasury |
| **Alerts** | Alert on: drawdown breach, guardrail hit in 3+ consecutive cycles, TWAK unavailable, **both agent anchor adapters failing in the same cycle**, stuck position detected, bankroll below harvest reserve |
| **Foundry** | `casting.yaml` declares SigNoz stack; agent exports OTLP to the local collector (Hono on 31777). Web app is optional for hackathon demo (dashboard at `/agent`) |

### Build Plan

| Step | Work | Effort |
|---|---|---|
| 1 | Install SigNoz via Foundry, create `casting.yaml` | 1 hr |
| 2 | Add OTel JS instrumentation to `agent/index.ts` + `agent/lib/cycle-runner.ts` — wrap each pipeline step with spans | 3–4 hrs |
| 3 | Add OTel instrumentation to `agent/lib/conviction-signal.ts` and `agent/lib/llm-jury.ts` — trace scoring + jury with attributes | 2–3 hrs |
| 4 | Replace ad-hoc console logging with structured JSON logger carrying trace context | 1 hr |
| 5 | Create dashboards: portfolio health, conviction signals, trade performance, guardrail activity, anchor reliability | 2–3 hrs |
| 6 | Set up alerts for critical failures (drawdown, anchor failure, TWAK unavailable, bankroll critical) | 1–2 hrs |
| 7 | Demo video showing trace waterfall of a full `runCycle` + alerts firing on guardrail breach | 1 hr |

**Total: ~13 hours.**

### Chain scope (don't conflate)

| Surface | Mantle | Casper | Aleo |
|---|---|---|---|
| Agent auto-anchor each cycle | ✓ EVM mirror (ERC-8004) | ✓ ConvictionRegistry (MCP host) | — |
| User wallet proofs | — | ✓ In-browser sign via Casper Wallet | ✓ ZK proof via `/analyzer` |
| Hackathon OTel focus | ✓ `anchor.mantle` span status | ✓ `anchor.casper` span status | Out of scope for agent traces |

---

## 2. TrendSpider Hackathon 2026

> Status: **GO — building** (decided 2026-10-19). Category: **Most Unique
> Options Indicator**. Full strategy:
> [`archive/TRENDSPIDER_HACKATHON.md`](archive/TRENDSPIDER_HACKATHON.md).

### Overview

TrendSpider's indicator contest. You write a **new indicator** that renders on
their charts (Sidekick AI no-code, or JavaScript via the Custom Indicator API) —
it is not a project submission. **$25,000** in cash & prizes, 4 categories × 3
prizes ($1,500/$750/$250 cash + subscriptions), sponsored by Clear Street.
Deadline extended to **2026-10-26**; winners **2026-11-04**.

**Categories:** Best Buy/Sell Signal Indicator · Most Unique Options Indicator ·
Best Fundamental Analysis Indicator · Most Beautiful On-Chart Indicator.

**Judging:** internal panel — Visual Clarity, Utility, Execution, Presentation.
No profitability criterion; the backtested-edge story argues Utility +
Presentation.

**Rules:** publish the indicator public + free to the TrendSpider Store with
`#TSBuild26` in the description + official form. One script per category.
Caveat: posted registration closed Sept 16 — confirm late entry before building.

### EarlyNotWrong's Fit

| Criterion | EarlyNotWrong's Position |
|---|---|
| **Reusable signal** | The 6-factor conviction engine (contrarian 30 · RSI 10 · quality 20 · regime 20 · holder growth 10 − vol penalty) is a complete buy/sell model with published weights |
| **Options model already spec'd** | `agent/lib/adapters/options-conviction.ts` implements "IV edge + conviction overlay" with the equity-side factor translation done: IV contrarian 20 · underlier RSI+delta 10 · liquidity/AUM 15 · VIX regime 15 · OI growth 10 · vanna/charm 5 · gamma squeeze 10 · earnings vol-crush 10 |
| **Edge justification** | `agent/lib/backtest.ts` (`runEdgeReport()`, `GET /edge-report`) compares against a naive baseline; `hasEdge` needs a Sharpe beat **and** non-negative absolute return |
| **Options data confirmed** | Custom indicators have live OPRA access — IV, greeks, OI, volume by strike/expiry (verified 2026-10-19); HTTP GET to third-party data for gaps |
| **The gap** | TrendSpider is not a data source for the agent (SoSoValue/CMC + Alpaca). This is a **port of the scoring logic with inputs re-sourced** — not a repo submission |

---

*Archived: 2026*
