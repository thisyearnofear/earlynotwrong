# Agentic Harness: Domain-Agnostic Autonomous Agent Framework

> Vision: the skeleton is the product. The domain is a plugin.

---

## Vision

Early Not Wrong is an **agentic harness** — a proven autonomous agent architecture that can be plugged into any market domain. The core loop, LLM ladder, jury, adversarial verification, calibration ledger, thesis anchoring, and self-analysis are all domain-agnostic. What changes per domain are three extension points: data source, conviction factors, and trade executor.

The Alpaca AI Trading Agents Hackathon (Aug 28 – Sep 4, 2026) is the proof point: an options trading agent built entirely from the harness skeleton in 7 days.

### Current State

**Updated 2026-08-29:** the harness is now built and the options domain is
**live on Alpaca paper**. The full 8-step cycle runs end-to-end against the
real paper account — 718 contracts fetched/scored across SPY, QQQ, AAPL, MSFT,
NVDA, TSLA, orders submitted to the paper Trading API (market-hours gated).
The three adapter interfaces are the real, tested plug-in boundary:

- `DataSource` — sosovalue-adapter (crypto) / alpaca-data (options, verified
  against the live API: contracts via `GET {paper-api}/v2/options/contracts?underlying_symbols=`,
  quotes via `v1beta1/options/snapshots`, bars via `v2/stocks/bars` with `feed=iex`).
- `ConvictionFactors` — crypto-conviction / options-conviction (8 factors summing to 100).
- `TradeExecutor` — twak-adapter / alpaca-executor (paper orders, positions, risk).

The skeleton was previously proven but buried inside the BSC crypto agent:

- **Autonomous loop** — fetch → score → LLM ensemble → verify → execute → self-analyze → anchor
- **Free-first LLM ladder** — Vercel AI Gateway > OpenRouter > OpenAI > Anthropic > OrcaRouter, with circuit breakers and backoff
- **Conviction jury** — 7th factor: LLM reviews top candidates, adjusts scores ±15, reasoning anchored on-chain
- **Adversarial verification** — cross-family red-team prompt attacks the thesis before entry
- **Calibration ledger** — per-cycle Brier score, log-loss, reliability diagram (conviction-core)
- **Thesis anchoring** — quantized digest → keccak256 hash → Mantle + Casper (ERC-8004)
- **MCP server** — 7 tools for agent-to-agent consumption
- **CROO CAP adapter** — Store-listed signals-live and wallet-score services

The skeleton works. The problem is nobody can tell it's a skeleton. Every time someone asks "can you do X?" the answer is "for BSC crypto, yes; otherwise you'd need to rewrite half of it."

### Target State

The skeleton ships as the product. The pitch changes from:

> "We built an autonomous BSC conviction agent."

to:

> "We built an autonomous agent harness. Here's an options agent we shipped in 7 days."

---

## Architecture

### The Three Extension Points

```
harness/
  loop.ts              — the agent loop (unchanged)
  llm-ladder.ts        — free-first cascade (unchanged)
  verification.ts      — cross-family adversarial (unchanged)
  self-analysis.ts     — calibration ledger (unchanged)
  anchoring.ts         — domain-agnostic record anchor (unchanged)
  mcp-server.ts        — tool surface (unchanged)
  cap-adapter.ts       — CROO CAP (unchanged)
  ──
  adapters/            — these are the plug-in boundary
    data-source.ts     — interface: fetch market data
      ├─ alpaca-adapter.ts
      └─ sosovalue-adapter.ts
    conviction-factors.ts — interface: score a signal
      ├─ options-factors.ts
      └─ crypto-conviction.ts
    executor.ts        — interface: place & manage trades
      ├─ alpaca-executor.ts
      └─ twak-executor.ts
```

### Adapter Interfaces

**`data-source.ts`** — Fetch market data for the scoring layer.

```ts
interface DataSource {
  fetchSignals(config: SignalRequest): Promise<MarketSignal[]>;
  fetchHistorical(symbol: string, days: number): Promise<Kline[]>;
  healthCheck(): Promise<boolean>;
}
```

**`conviction-factors.ts`** — Score a signal into a conviction score (0–100).

```ts
interface ConvictionFactors {
  score(signal: MarketSignal, historical: Kline[]): Promise<ConvictionResult>;
  factors(): FactorDefinition[]; // metadata for dashboard
}
```

**`executor.ts`** — Place and manage trades.

```ts
interface TradeExecutor {
  placeOrder(signal: SignalWithScore, position: PositionConfig): Promise<TradeResult>;
  closePosition(symbol: string, positionId: string): Promise<TradeResult>;
  manageRisk(signal: SignalWithScore, portfolio: Portfolio): RiskCheck;
  healthCheck(): Promise<ExecutorHealth>;
}
```

**Key design principle:** The harness loop imports from interfaces, not implementations. Each adapter is independently testable and swappable. The loop itself, the ladder, the jury, the verification — all unchanged.

### Config Layer

```ts
type Domain = 'crypto' | 'options' | string;

interface HarnessConfig {
  domain: Domain;
  adapters: {
    dataSource: string;   // 'sosovalue' | 'alpaca' | ...
    convictionFactors: string; // 'crypto' | 'options' | ...
    executor: string;    // 'twak' | 'alpaca' | ...
  };
  // Everything else (ladder, verification, anchoring) stays the same
}
```

---

## Phase 0: Harness Boundary Design (Days 1–2)

> **Status: COMPLETE** — `agent/lib/adapters/` with three extension-point
> interfaces, the crypto wrappers conforming existing code, and the registry
> all shipped in PR #35 (merged 2026-08-28, squash `0980c911`).

### 0.1 Factor out the domain adapter interfaces

Create `agent/lib/adapters/` with three extension point files:

- `data-source.ts` — interface definition
- `conviction-factors.ts` — interface definition
- `executor.ts` — interface definition

### 0.2 Create harness config layer

`agent/lib/harness-config.ts` — top-level config that selects which adapter set to use.

### 0.3 Rename conviction-signal.ts for clarity

`agent/lib/conviction-signal.ts` → `agent/lib/adapters/crypto-conviction.ts` (or `bsc-conviction.ts`). The generic "conviction scoring" concept is now also in `options-factors.ts`. The harness loop calls a unified `scoreSignal()` that delegates to whichever factor set the config selected.

---

## Phase 1: Alpaca Domain Adapter (Days 2–4)

> **Status: COMPLETE** — all three adapters implemented, type-checked, tested
> (28 adapter tests), and **verified against the live paper API** (2026-08-29).
> The data adapter was rewritten after live endpoint mapping: contracts come
> from the **Trading API** (`GET {paper-api}/v2/options/contracts?underlying_symbols={SYM}`),
> not the data API's `/v2/stocks/{sym}/options/contracts` (404). IV/greeks are
> derived from mid quotes via Black-Scholes inversion because the Basic plan's
> indicative feed exposes no IV/greeks; bars need `feed=iex`. Contract fields
> are `type`/`close_price`/`open_interest` (not `option_type`/`close`). A
> 7–90d expiration window skips nearest-weekly contracts whose stale quotes
> degrade the IV solver.

### 1.1 Data source adapter — `alpaca-data.ts`

Fetch what the options conviction factors need (as implemented):

- **Options chains** per underlier (API: `GET {trading-base}/v2/options/contracts?underlying_symbols=`)
- **Implied volatility** per contract — derived from the mid quote via a
  Black-Scholes bisection solver (no IV in the Basic-plan payload)
- **Greeks** (delta, gamma, theta, vega — from the solved IV)
- **Underlier price + historical klines** (for RSI, regime — `v2/stocks/{s}/snapshot`
  singular + `v2/stocks/bars` multi-symbol with `feed=iex`)

Not implemented on the Basic plan (no paid OPRA feed): real-time greeks,
option-volume fields, and per-contract historical option bars. The strategy
works without them (IV from quotes; underlier bars for RSI/regime).

### 1.2 Options conviction factors — `options-conviction.ts`

Map the harness scoring concept to options-specific signals. The scoring framework stays the same (weighted factors, total 0–100), but the factors change:

| Crypto Factor | Options Equivalent | Weight |
|---|---|---|
| Contrarian (30) | IV contrarian — extreme IV rank on mean-reverting underlier | 20 |
| RSI timing (10) | Underlier RSI + delta sensitivity | 10 |
| Quality (20) | Underlier liquidity, AUM, institutional ownership | 15 |
| Regime (20) | VIX regime, funding rate proxy, market regime | 15 |
| Holder growth (10) | N/A → replaced by Open interest growth | 10 |
| Volatility penalty (−) | Vanna/Charm decay risk | 5 |
| **New** | **Gamma squeeze risk** | 10 |
| **New** | **Earnings vol crush timing** | 10 |

Total: 100, weighted differently. The harness loop doesn't care about the individual factors — just that they sum to a conviction score.

### 1.3 Alpaca executor — `alpaca-executor.ts`

Interface implementation for the harness executor contract:

- `placeOrder(signal, position)` → Alpaca options order API (multi-leg supported)
- `closePosition(symbol, contractId)` → close options position
- `manageRisk(signal, portfolio)` → margin check, position sizing via Alpaca portfolio endpoint
- `healthCheck()` → verify API keys, paper account active, options trading approved

Uses Alpaca's paper trading environment for all operations. CLI and MCP server are alternatives — the executor picks the best path available.

### 1.4 Alpaca config profile

New domain profile in harness config:

```ts
DOMAINS = {
  crypto: { adapters: { dataSource: 'sosovalue', convictionFactors: 'crypto', executor: 'twak' } },
  options: { adapters: { dataSource: 'alpaca', convictionFactors: 'options', executor: 'alpaca' } },
}
```

---

## Phase 2: Harness Loop Integration (Days 3–4)

> **Status: COMPLETE** — `agent/lib/options-cycle.ts` (8-step options pipeline),
> `options-state.ts` (parallel state container), and domain-aware dispatch in
> `agent/index.ts` (`HARNESS_DOMAIN=options` runs the options loop; crypto
> unchanged). Committed `6a9d0a12`. Verified live: portfolio ($100k paper),
> 718 contracts, conviction scoring, proposals, and order submission.

### 2.1 Update the main loop

`agent/index.ts` and `cycle-runner.ts` become domain-aware:

```
START → load harness config (domain = 'options')
  → load adapters from config
  → fetchMarketData()   // calls alpaca-adapter
  → scoreMarket()       // calls options-conviction factors
  → LLM jury review     // unchanged
  → verification pass   // unchanged
  → risk guardrails     // unchanged (domain-agnostic)
  → execute trade       // calls alpaca-executor
  → self-analyze        // unchanged
  → anchor thesis       // unchanged (Mantle or domain-specific)
  → Telegram dispatch   // unchanged (message format adapts)
  → sleep(interval)
```

### 2.2 Domain-agnostic Telegram messaging

Telegram message format adapts to domain: crypto shows token prices + holder counts; options shows contract details + Greeks + P&L. Same dispatch mechanism, different template per domain.

### 2.3 Domain-agnostic self-analysis

`self-analysis.ts` consumes conviction-core's `calculateBehavioralMetrics` — this is already domain-agnostic (it works on any ledger entry). The dashboard card adapts labels. No code change needed.

### 2.4 Domain-agnostic anchoring

Thesis hash and conviction record are already domain-agnostic (they hash the digest, not the domain data). The Mantle + Casper chains are domain-agnostic too. No change needed.

---

## Phase 3: Hackathon Deliverables (Days 4–6)

> **Status: IN PROGRESS.** Done: one-page write-up
> (`docs/ALPACA_HACKATHON_WRITEUP.md`), runnable options agent on the live
> paper account, public repo, adapter + cycle tests. Outstanding: demo
> dashboard, video presentation, and the build-in-public social posts.

### 3.1 Options strategy narrative

**"IV edge + conviction overlay"** — identify underliers where implied vol is mispriced relative to your conviction score. The harness detects mean-reverting IV extremes (high IV rank on fundamentally strong underliers → sell premium; low IV rank on weak underliers → buy premium). The LLM jury reviews macro context and earnings timing. The verification layer attacks the thesis. Risk guardrails limit exposure per underlier. This mirrors the conviction-core approach: probability-vs-mispricing edge, not random speculation.

### 3.2 One-page write-up

Cover:
- AI logic: IV factors + LLM ensemble + adversarial verification
- Risk gates: margin limits, position sizing, drawdown stop, concentration limits
- Alpaca infrastructure: Trading API (options orders), Market Data API (chains + Greeks), paper trading, MCP server usage
- Harness architecture: diagram showing the skeleton + options adapter as a plug-in

### 3.3 Demo application

Running agent on Alpaca paper account with:
- Live market data feed
- Scoring dashboard (conviction scores + factors breakdown)
- Trade log (entries, exits, P&L)
- Self-analysis metrics (calibration, Brier score)

### 3.4 GitHub repo

Public repo structured to showcase the harness:

```
agentic-harness/
  README.md          — "Domain-agnostic autonomous agent framework"
  examples/
    crypto/          — current BSC agent (reference)
    options/         — Alpaca hackathon submission (demo)
  packages/conviction-core/  — shared ledger + calibration
  agent/lib/
    harness/         — the skeleton (loop, ladder, jury, verification...)
    adapters/        — domain plug-ins
```

### 3.5 Video presentation

Show the harness architecture, then demonstrate the options agent running. Emphasize: "one skeleton, two domains."

---

## Phase 4: Post-Hackathon Productization (Days 7+)

### 4.1 Extract the harness as a standalone package

What gets sold:
- The skeleton as a framework/SDK for building autonomous trading agents
- Pre-built adapters for major domains (crypto via TWAK, options via Alpaca, equities via Alpaca, etc.)
- Each adapter is a drop-in plugin

### 4.2 Monetization paths

| Path | How it works | Current parallel |
|------|-------------|-----------------|
| Harness SDK (open-source-core) | Free skeleton, paid pre-built adapters | Similar to signals-live free tier |
| Domain-specific agent subscriptions | "Options agent" subscription, "crypto agent" subscription | signals-live ($0.05/call) |
| MCP server for harness | Buyer-agents call `build_agent(domain, strategy)` | Current MCP tools (7 tools) |
| White-label for fintechs | Alpaca partners like Kraken/SBI want custom agents | Broker API partners |

### 4.3 Narrative shift

The hackathon isn't a side project — it's the product launch event for the harness positioning.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Alpaca options API complexity | Multi-leg options orders are complex; single-leg is straightforward | Start with single-leg options (calls/puts), add multi-leg if time allows |
| No options domain expertise | Conviction factors may be naive | Use publicly documented options strategies (IV rank, gamma squeeze, vol crush) as factor basis; LLM jury provides qualitative overlay |
| 7-day deadline | Full harness refactor + options adapter may not fit | Scope the harness refactor to the 3 adapter interfaces only; keep everything else identical |
| P&L judging criterion | Paper trading P&L is #1 criterion | Optimize for Technology Implementation (40%) over P&L (30%) — the harness architecture is the tech story |
| Domain lock-in perception | If harness doesn't ship a second adapter, it's just a marketing claim | Ship the crypto agent alongside the options agent as proof of dual-domain capability |

---

## Files to Create / Modify

### New files
- `agent/lib/adapters/data-source.ts` (interface)
- `agent/lib/adapters/conviction-factors.ts` (interface)
- `agent/lib/adapters/executor.ts` (interface)
- `agent/lib/adapters/alpaca-data.ts` (implementation)
- `agent/lib/adapters/alpaca-executor.ts` (implementation)
- `agent/lib/adapters/options-conviction.ts` (implementation)
- `agent/lib/harness-config.ts` (config layer)
- `docs/HARNESS_ARCHITECTURE_PLAN.md` (this file)

### Renamed/moved
- `agent/lib/conviction-signal.ts` → `agent/lib/adapters/crypto-conviction.ts`
- `agent/lib/data-providers.ts` → `agent/lib/adapters/sosovalue-adapter.ts` (refactor)

### Modified
- `agent/lib/cycle-runner.ts` — use adapter interfaces instead of direct imports
- `agent/lib/config.ts` — add domain config
- `agent/index.ts` — domain-aware startup

---

## Market Context: Why Alpaca

Alpaca is not a small niche — it's a growing platform at a scale worth building for:

- **$285M raised in 2026** — $150M Series D at $1.15B valuation (Jan 2026), then $135M Series E (Jul 2026). Investors: Drive Capital, Citadel Securities, Kraken, Peak XV.
- **$1.5B in underlying tokenized stocks** on their balance sheet.
- **Options launched April 2026** — multi-leg strategies, commission-free, full API + MCP + CLI support.
- **Positioning explicitly as "agent-first brokerage"** — dedicated `/agentic` page: "Build autonomous trading agents on Alpaca's AI-native infrastructure."
- **Official MCP Server** (Nov 2025) — lets Claude, Cursor, ChatGPT trade via natural language.
- **50,000+ LinkedIn followers**, partners include Kraken, SBI Securities, Dime!.
- **Paper accounts are free** — no card required. Massive developer funnel.

The platform is building the distribution channel a harness needs. Developers already testing agents on Alpaca are the exact audience for a domain-agnostic agent framework.

---

## Relationship to Current Agent

This plan does **not** replace the current BSC crypto agent. The harness and the current agent coexist:

| | Current Agent | Harness Vision |
|---|---|---|
| What it is | A product (the agent itself) | A framework (the skeleton) |
| Domain | BSC crypto (SoSoValue + TWAK) | Pluggable (crypto, options, equities, ...) |
| Revenue | signals-live, wallet-score, MCP tools | SDK subscriptions, domain adapters, white-label |
| Hackathon role | Not involved | Proof point: options agent from the same skeleton |

The current agent (`agent/`) is `adapter/crypto` running on the skeleton. The harness plan pulls the skeleton out and makes the adapters explicit. The existing code doesn't change — it gets refactored to conform to the interfaces we define.
