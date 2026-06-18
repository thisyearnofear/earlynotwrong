# BNB Hackathon: Implementation Plan

> **Event**: BNB Hack: AI Trading Agent Edition (CMC × Trust Wallet)
> **Deadline**: Build window closes June 21, 2026 | Trading window June 22–28
> **Track**: Track 1 — Autonomous Trading Agents ($24K pool)
> **Prize targets**: Best Use of TWAK ($2K), Best Use of Agent Hub ($2K), Best Use of BNB AI Agent SDK ($2K)
> **Core principle**: This plan is governed by `docs/CORE_PRINCIPLES.md` — read that first.

---

## North Star

A **conviction-weighted copy-trader agent** deployed on Pinata Agents that:

1. Ingests wallet behavior data via **CMC AI Agent Hub** (funding rates, Fear & Greed, top-wallet flows)
2. Scores wallet conviction using the **existing ENW conviction engine** (ported, not rewritten)
3. Mirrors the trades of the top-K conviction wallets via **Trust Wallet Agent Kit (TWAK)**
4. Operates autonomously within configurable guardrails (drawdown cap, allowlist, per-trade limits)
5. Anchors its analysis to the **existing Mantle ERC-8004 registry** as verifiable proof-of-analysis
6. Is hosted on **Pinata Agents** with a Routes-exposed API, Telegram channel, and scheduled task loop

**Why copy-trading, not direct strategy execution?** Because copying conviction-weighted wallets directly maps ENW's existing core competency (identifying high-conviction traders) into a forward-actionable trading loop. The conviction engine already computes who has conviction — now we just mirror their behavior through a disciplined filter.

---

## Architecture

```
                    ┌─────────────────────────────┐
                    │      Pinata Agent (host)     │
                    │                              │
                    │  ┌───────────────────────┐  │
  CMC Agent Hub ────►  │   Data Ingestion      │  │
  (funding, F&G,   │  │   (CMC MCP / Skills)   │  │
   top wallets)    │  └──────────┬────────────┘  │
                    │             │               │
                    │  ┌──────────▼────────────┐  │
                    │  │   Conviction Engine   │  │
                    │  │   (ported from ENW)   │  │
                    │  │   - Score wallets     │  │
                    │  │   - Rank by CI ×      │  │
                    │  │     Ethos multiplier  │  │
                    │  │   - Select top-K      │  │
                    │  └──────────┬────────────┘  │
                    │             │               │
                    │  ┌──────────▼────────────┐  │
                    │  │   Mirror Strategy     │  │
                    │  │   - Risk filter       │  │
                    │  │   - Token allowlist   │  │
                    │  │   - Position sizing   │  │
                    │  └──────────┬────────────┘  │
                    │             │               │
                    │  ┌──────────▼────────────┐  │
                    │  │   TWAK Exec Layer     │  │
                    │  │   - Swap (via x402)   │  │
                    │  │   - Autonomous sign   │  │
                    │  └──────────┬────────────┘  │
                    │             │               │
                    │  ┌──────────▼────────────┐  │
                    │  │   Mantle Ancher       │  │
                    │  │   - ERC-8004 registry │  │
                    │  │   - @pinata/erc-8004  │  │
                    │  └───────────────────────┘  │
                    │                              │
                    │  Routes: /api/status         │
                    │          /api/trades         │
                    │          /api/conviction     │
                    │                              │
                    │  Channels: Telegram          │
                    │  Tasks: Every 4h (loop)      │
                    └─────────────────────────────┘
```

---

## What We Keep From ENW (Enhancement First)

**Enhanced — existing code ported to the Pinata Agent workspace:**

| ENW Module | How It's Used | Principle |
|------------|---------------|-----------|
| `src/lib/config.ts` | Chain configs, addresses, program IDs — extracted as a shared config module for the agent | DRY |
| `src/lib/ethos-gates.ts` | `getPerksList`, tier definitions — used for Ethos-weighted conviction ranking | Enhancement |
| `src/lib/alpha/constants.ts` | Conviction archetype labels, score thresholds | Enhancement |
| `src/lib/mantle.ts` | `anchorToMantle` ABI + contract interactions — reused with `@pinata/erc-8004` skill | Enhancement |
| `src/lib/strategist.ts` | Thesis commitment logic — adapted for the agent's analysis anchoring | Enhancement |
| `src/lib/market.ts` | Token metadata, price lookups — adapted for CMC data source | Enhancement |
| `src/lib/alpha/showcase.ts` | Showcase wallet data — used as seed data for backtesting | Enhancement |
| `src/lib/services/market-service.ts` | Market data abstraction — replaced CMC as the provider but keeps the interface | DRY |

**Kept in the Next.js app (unchanged):**
- `src/app/page.tsx` — main analyzer UI
- `src/components/` — all UI components remain as the analytics dashboard
- `src/hooks/` — all React hooks remain for the web frontend
- `src/app/leaderboard/` — leaderboard page
- `src/app/alpha/` — alpha discovery page
- Aleo privacy layer — unchanged, still the private credential system
- Mantle contract — unchanged, still the anchoring target

**The Next.js app becomes the analytics dashboard and monitoring UI for the agent**, showing its trades, conviction scores, and performance. Users interact with the agent via Telegram or the dashboard.

---

## What We Extract (Modular Port)

The conviction scoring engine is the core IP. It lives in ENW as a combination of API routes and hook logic. For the agent, we extract the **pure computation layer** into a standalone module that the Pinata Agent can import:

```
agent/
  lib/
    conviction-engine.ts   # The scoring logic: patience tax, upside capture, CI
    tier-weights.ts        # Ethos tier multipliers for ranking
    config.ts              # Constants: score thresholds, archetype labels
    cmc-client.ts          # CMC Agent Hub data ingestion
    twak-executor.ts       # TWAK trade execution
    mantle-anchor.ts       # ERC-8004 anchoring
    risk-guardrails.ts     # Drawdown cap, allowlist, position sizing
  index.ts                 # Main loop orchestrator
  SOUL.md                  # Agent personality (ENW narrative)
  manifest.json            # Pinata Agent manifest
```

This respects **CLEAN** (separation of concerns), **MODULAR** (independent modules), and **ENHANCEMENT FIRST** (we port, don't rewrite).

---

## What We Build New

### 1. CMC Data Ingestion (`agent/lib/cmc-client.ts`)

Fetches wallet behavior signals from CMC AI Agent Hub:
- Top wallet flows (which wallets are accumulating/distributing in-scope tokens)
- Funding rates (perp positioning sentiment)
- Fear & Greed Index (market regime context)
- Token metadata (for allowlist filter)

**Principle**: MODULAR — the CMC client implements a `MarketDataProvider` interface that can be swapped for Helius/Birdeye without changing the engine.

### 2. Risk Guardrails (`agent/lib/risk-guardrails.ts`)

Configurable rules that constrain the agent's autonomous execution:
- Max drawdown (e.g., 30%) — hard stop, disqualification limit
- Per-trade USD cap
- Daily trade count limit
- Token allowlist (149 in-scope BEP-20 tokens)
- Minimum conviction threshold for copying
- Maximum position concentration per token

**Principle**: CLEAN — guardrails are a separate module with explicit config, not inline in the main loop.

### 3. TWAK Execution Layer (`agent/lib/twak-executor.ts`)

The autonomous trade execution module:
- `swap(tokenIn, tokenOut, amount)` — executes via TWAK REST/MCP
- `getBalance(token)` — checks portfolio state
- `getOpenPositions()` — tracks current exposure
- Uses **self-custody local signing** via TWAK — keys never leave the user's device
- Uses `x402` for data/inference payment within the trade loop

**Principle**: ENHANCEMENT FIRST — the swap interface mirrors the existing `market-service.ts` interface so the conviction engine can be tested without a live TWAK connection.

### 4. Main Loop (`agent/index.ts`)

The autonomous trading loop, triggered by a Pinata Task (cron, every 4h):

```
1. Fetch current portfolio state (TWAK getBalance)
2. Fetch market data (CMC: top wallets, funding, F&G)
3. Score visible wallets with conviction engine
4. Rank by CI × Ethos tier multiplier
5. Select top-3 conviction wallets
6. For each: fetch their recent trades via CMC
7. Filter trades: token in allowlist, size in range, not maxed out
8. Execute mirror trades via TWAK (with slippage protection)
9. Anchor analysis hash to Mantle (ERC-8004)
10. Log results, emit status via channel
```

**Principle**: PREVENT BLOAT — this is the only loop. No sub-loops, no parallel strategies, no complex state machine.

---

## What We Remove / Deprecate (Consolidation)

The ENW codebase has domains that are out of scope for this hackathon. We **do not port** them to the agent:

| ENW Module | Status | Rationale |
|------------|--------|-----------|
| Aleo privacy layer (`src/lib/aleo/`, `src/components/aleo/`, `aleo/`) | **Excluded** | Not relevant to BSC trading agent. Remains in the dashboard UI unchanged. |
| Ethos integration (`src/lib/ethos.ts`, `src/lib/ethos-gates.ts`) | **Interface ported** | The tier/weight logic is extracted; the Ethos API client stays in the web app |
| Privacy Cash (`src/lib/privacy-cash.ts`, `src/hooks/use-privacy-cash.ts`) | **Excluded** | Solana-specific privacy feature. Remains in dashboard. |
| Farcaster identity resolution (`src/lib/farcaster-miniapp.ts`) | **Excluded** | Not relevant to agent execution |
| `src/lib/alpha/showcase.ts`, `src/lib/analysis-cache.ts` | **Excluded** | Dashboard-specific |

The agent directory (`agent/`) is a new top-level directory, not nested inside `src/`. This keeps the ENW web app and the agent completely separate — delete `agent/` when the hackathon is over without touching the web app.

---

## Phase Timeline (5 Sprints in 3 Weeks)

### Sprint 1: Foundation (Days 1–3)

**Goal**: Agent skeleton running on Pinata Agents, CMC data flowing.

| Task | Files | Principle |
|------|-------|-----------|
| Create Pinata Agent on Pinata dashboard | — | Organized |
| Set up `agent/` directory structure | `agent/manifest.json`, `agent/SOUL.md`, `agent/lib/` | Organized |
| Port config constants from ENW | `agent/lib/config.ts` | DRY |
| Implement CMC client with MCP integration | `agent/lib/cmc-client.ts` | Modular |
| Verify CMC data ingestion with a manual prompt | — | Performant |

**Gate**: Agent can fetch top-wallet flows and token prices from CMC on demand.

### Sprint 2: Conviction Engine Port (Days 4–6)

**Goal**: Conviction scoring runs inside the agent, ranking CMC wallets.

| Task | Files | Principle |
|------|-------|-----------|
| Extract conviction scoring logic from ENW | `agent/lib/conviction-engine.ts` | Enhancement |
| Port Ethos tier weights | `agent/lib/tier-weights.ts` | DRY |
| Write unit tests for conviction engine | `agent/lib/conviction-engine.test.ts` | Modular |
| Wire scoring into agent's main loop | `agent/index.ts` | Clean |
| Expose `/api/conviction` route on Pinata | `agent/manifest.json` (routes) | Performant |

**Gate**: Agent can score a set of wallet addresses and return ranked conviction scores.

### Sprint 3: TWAK Integration (Days 7–11)

**Goal**: Agent can execute trades autonomously via TWAK.

| Task | Files | Principle |
|------|-------|-----------|
| Implement TWAK swap client | `agent/lib/twak-executor.ts` | Modular |
| Implement balance/portfolio tracking | `agent/lib/twak-executor.ts` | Clean |
| Build risk guardrails module | `agent/lib/risk-guardrails.ts` | Clean |
| Wire TWAK into main loop | `agent/index.ts` | Enhancement |
| Set up self-custody signing flow | TWAK config | Clean |
| **Register agent wallet on BSC** via `twak compete register` | — | Enhancement |

**Gate**: Agent can execute a test swap on BSC testnet with self-custody signing. Portfolio state is queryable.

### Sprint 4: Integration & Mantle Anchoring (Days 12–16)

**Goal**: Complete autonomous loop with Mantle anchoring.

| Task | Files | Principle |
|------|-------|-----------|
| Install `@pinata/erc-8004` skill on the Pinata Agent | Pinata dashboard | Enhancement |
| Register agent on existing Mantle registry | `agent/lib/mantle-anchor.ts` | Enhancement |
| Complete main loop: CMC → Conviction → Filter → TWAK → Mantle | `agent/index.ts` | Clean |
| Add Telegram channel for agent status updates | Pinata dashboard (channels) | Modular |
| Build `/api/status` and `/api/trades` routes | `agent/manifest.json` | Performant |
| End-to-end dry run on testnet | — | — |

**Gate**: Agent runs the full loop autonomously on BSC testnet.

### Sprint 5: Polish & Submission (Days 17–21 + Trading Week)

**Goal**: Agent ready for live trading week, submission materials complete.

| Task | Files | Principle |
|------|-------|-----------|
| Paper-trade through the conviction loop | — | Performant |
| Tune risk guardrails (drawdown cap, position sizing) | `agent/lib/risk-guardrails.ts` | Prevent Bloat |
| Write README for the agent repo | `agent/README.md` | Organized |
| Record demo video | — | — |
| Submit on DoraHacks | — | — |
| **Monitor live trading week** (June 22–28) | — | — |

**Gate**: Agent is submitted, registered, and trading live during competition week.

---

## Judging Criteria Mapping

### Track 1: Live PnL

The agent is ranked by total return during the trading week (June 22–28), with a **max drawdown cap of 30%** as a disqualification threshold.

**How we win**: The conviction engine naturally selects wallets with strong holding behavior and upside capture — this should produce more patient, higher-return copy-trades than naive top-wallet copying. The risk guardrails prevent over-concentration and blowups.

### Best Use of TWAK ($2K Special Prize)

| Criterion | Weight | How We Score |
|-----------|--------|-------------|
| TWAK integration depth | 30% | TWAK is the sole execution layer. Agent uses swap, balance checking, autonomous mode, and x402 — multiple surfaces, not just one swap call. |
| Self-custody integrity | 25% | Keys stay with the user via TWAK local signing. The Pinata Agent orchestrates but never touches the signing key. **Full self-custody, clean local signing** → 20–25 pts. |
| Autonomous execution + guardrails | 20% | Agent signs and processes its own transactions, genuinely hands-off, inside rules: drawdown cap, token allowlist, per-trade limits, slippage protection. |
| Native x402 usage | 10% | Agent uses x402 via `@pinata/api` skill to pay for CMC data requests and inference within the trade loop. Real, not a README mention. |
| Originality + real-world relevance | 10% | Conviction-weighted copy-trading is a new take — not a copy of existing copy-trading bots, because the filter is behavioral conviction, not raw volume. |
| Demo + presentation | 5% | Clear demo showing the self-custody loop end-to-end, backed by on-chain proof on BSC. |

### Best Use of Agent Hub ($2K Special Prize)

The agent uses CMC Agent Hub for:
- Top-wallet flow data (which wallets are moving in-scope tokens)
- Funding rates (regime context for conviction weighting)
- Fear & Greed Index (additional signal for risk guardrails)

The CMC integration is non-trivial — it's the **primary data source** for the conviction engine, not a cosmetic add-on.

### Best Use of BNB AI Agent SDK ($2K Special Prize)

If the BNB AI Agent SDK provides useful primitives (e.g., BSC RPC wrappers, token list, price feeds), we integrate them alongside CMC data. The SDK is evaluated on whether it reduces code or adds unique capabilities.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CMC Agent Hub latency during trading week | Medium | Medium | Cache data locally with staleness tolerance; fall back to previous scores if data is stale < 1h |
| TWAK signing failure / rate limits | Low | High | Implement retry with exponential backoff; skip trade if signing fails after 3 retries |
| Conviction engine produces bad scores due to data gaps | Medium | Medium | Minimum data threshold: skip wallets with < 5 observable trades; log data quality metrics |
| Portfolio drops below $1 (disqualification threshold) | Low | High | Auto-rebalance to maintain minimum position; agent alerts via Telegram if capital is critically low |
| Drawdown hits 30% (disqualification) | Low | Very High | Hard stop at 25% — agent stops all trading and alerts manually. 30% is the disqual line, we trip at 25%. |
| Pinata Agent free trial expires | Medium | Medium | 10-hour trial covers dev. Need to upgrade plan or self-host during trading week. Plan for this in Sprint 4. |
| BSC network congestion | Low | Medium | Slippage tolerance auto-adjusts; trades that fail due to gas are retried once with higher gas |
| Selected conviction wallets stop trading | Medium | Low | Main loop re-ranks every 4h — stale wallets naturally fall out of top-K as new wallets emerge |

---

## Success Criteria

### Minimum Viable (Gate to Trading Week)
- [ ] Agent runs autonomously on Pinata Agents
- [ ] CMC data pipeline delivers wallet flow data
- [ ] Conviction engine scores wallets and ranks top-K
- [ ] TWAK executes mirror trades on BSC testnet
- [ ] Risk guardrails prevent trades outside allowlist and size limits
- [ ] Mantle anchors each analysis cycle
- [ ] Agent registered on BSC competition contract

### Stretch Goals
- [ ] x402 used for CMC data requests within the trade loop
- [ ] `@pinata/erc-8004` skill used for agent identity on Mantle
- [ ] Telegram channel delivers hourly status updates
- [ ] Dashboard in the ENW web app shows agent's live trades
- [ ] Backtest shows conviction-weighted copy trading outperforms naive top-wallet copying

---

## Related Documents

- [Core Principles](CORE_PRINCIPLES.md) — governing design and engineering decisions
- [README.md](../README.md) — project overview and existing architecture
- [docs/CONTRIBUTING.md](../CONTRIBUTING.md) (planned) — contributor guidelines
- [Pinata Agents Docs](https://docs.pinata.cloud/agents/overview) — hosting platform
- [Trust Wallet Agent Kit Docs](https://portal.trustwallet.com) — execution layer
- [CMC AI Agent Hub](https://coinmarketcap.com/api/agent) — data layer
- [BNB AI Agent SDK](https://github.com/bnb-chain/bnbagent-sdk) — optional SDK

---

*Plan governed by `docs/CORE_PRINCIPLES.md`. Last updated: June 18, 2026.*
