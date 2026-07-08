# AGENTS.md — Agent Orchestration Guide

> How AI agents should navigate and modify the Early, Not Wrong codebase.

## Project Overview

Two main entry points:

```
agent/       — Autonomous trading agent (Node.js, TypeScript, Hono)
src/         — Next.js web app (frontend + API routes)
```

The **agent** is the autonomous trading core; the **web app** is its monitoring dashboard and the Conviction Analysis surface for end users.

---

## Agent Architecture (`agent/`)

### Entry Points

| File / Module | Purpose |
|---------------|---------|
| `agent/index.ts` | Startup, main loop orchestrator (`.env` inline loader, `runCycle()`, `restoreSnapshot()`) |
| `agent/src/server.ts` | HTTP server (routes: `/status`, `/trades`, `/conviction`, `/mcp`, `/reputation/stats`, `/aleo/sign-voucher`, `/cap/status`) |
| `agent/src/mcp/` | MCP server + x402 paywall — exposes cross-chain conviction data to AI agents |
| `agent/src/cap/` | CROO Agent Protocol adapter — reputation services settled in USDC on Base |
| `agent/src/payment-stats.ts` | Shared A2A payment counters for x402 and CAP |
| `agent/lib/config.ts` | Single config object (`AGENT_CONFIG`), competition constants, block-explorer URL builders |
| `agent/lib/agent-state.ts` | Shared mutable state (`state`), 10 type interfaces, helper maps, utility functions |
| `agent/lib/cycle-runner.ts` | All 8 pipeline steps + helpers (`closePosition`, `finalizeExit`, `printCycleSummary`) |
| `agent/lib/data-providers.ts` | Composite market data: `CmcClient` (CMC Pro REST) + `SosovalueClient` (SoSoValue OpenAPI) |
| `agent/lib/dex-trading.ts` | SoDEX spot REST client + EIP-712 signing (`SodexClient`, `SodexNonceManager`) |
| `agent/lib/holders.ts` | On-chain holder counts (NodeReal JSON-RPC + CoinGecko fallback), growth computation |
| `agent/lib/conviction-signal.ts` | 6-factor contrarian conviction scoring engine (pure functions) |
| `agent/lib/risk-guardrails.ts` | Risk limits (drawdown, position size, daily count, concentration) |
| `agent/lib/twak-executor.ts` | TWAK CLI wrapper (trade execution, address resolution, portfolio) |
| `agent/lib/telegram.ts` | Telegram dispatch (3-message cycle summaries, startup, error alerts) |
| `agent/lib/persistence.ts` | SQLite Sync state persistence (cross-restart position ledger) |
| `agent/lib/errors.ts` | Standardized error types (`AgentError`, `TradeError`, `GuardrailError`, etc.) |
| `agent/lib/onchain-portfolio.ts` | On-chain portfolio reader — values BEP-20 positions TWAK can't see |
| `agent/lib/market-narrative.ts` | AI market narrative generation from SoSoValue feeds + macro events |
| `agent/lib/anchors/` | Cross-chain anchoring adapters — `MantleAnchorAdapter` + `CasperAnchorAdapter` |

### Module Dependency Graph

```
index.ts
  └─ agent-state.ts ───┐
  └─ cycle-runner.ts ───┤
  └─ config.ts ─────────┤
  └─ data-providers.ts ─┤
  └─ errors.ts ─────────┤
  └─ telegram.ts ───────┤ (all leaf modules)
  └─ persistence.ts ────┤
  └─ cap/client.ts ─────┤
  └─ payment-stats.ts ──┘
  └─ (src/ imports)

cycle-runner.ts
  ├─ agent-state.ts
  ├─ config.ts
  ├─ data-providers.ts (cmcClient, sosovalueClient)
  ├─ dex-trading.ts (sodexClient)
  ├─ holders.ts (holder cache, fetchHolderCount)
  ├─ conviction-signal.ts (scoring engine)
  ├─ risk-guardrails.ts
  ├─ twak-executor.ts
  ├─ onchain-portfolio.ts
  ├─ anchors/index.ts (anchorAll, computeSubjectHash)
  ├─ market-narrative.ts (generateNarrative)
  ├─ telegram.ts (sendErrorAlert)
  └─ errors.ts (summarizeError)
```

### Trading Loop (8 Steps)

1. **Fetch portfolio** from TWAK + augment with on-chain BEP-20 positions
2. **Fetch market data** — SoSoValue token prices (preferred) + CMC global metrics & derivatives (composite)
3. **Score market regime + token conviction**: Fear & Greed (CMC v3), funding rates (CMC v5), then 6-factor per-token scoring:
   - Contrarian (30) — rewards assets down 7d during fear
   - RSI timing (10) — synthesized RSI(14) from 7d return; bonus for oversold
   - Quality (20) — market cap × liquidity filter
   - Regime (20) — fear & greed + funding rate composite
   - Holder growth (10) — on-chain holder base expansion (NodeReal + CoinGecko)
   - Volatility penalty — subtracted for erratic 7d price paths
4. **Manage open positions** — tiered exits:
   - `HOLD` through ordinary drawdown ("early, not wrong")
   - `EXIT_PARTIAL` at +50% gain — sell 33%, let the rest ride (capital recycling)
   - `EXIT_STOP` at −35% — thesis invalidated, cap the loss
   - `EXIT_TRAIL` at +100% peak → 30% give-back — lock the asymmetry
4b. **Harvest for BNB** — when BNB balance < `bankroll.harvestMinBnbUsd` (default $6) or over capacity, sell the weakest mature position. **Fallback ladder:**
   - Primary: position → BNB direct swap
   - Fallback A: position → USDC → BNB (deeper USDC liquidity on BSC)
   - Fallback B: size probe ($0.50 then $1) to diagnose tax-token reverts
   - Final: Telegram alert + 5-cycle cooldown on the broken token
5. **Create trade proposals** — top-K tokens by conviction score with DEX liquidity check. **Bankroll-aware sizing:** per-trade cap = `min(portfolio × 15%, (BNB − reserve) × 50%)`. Entries skipped when BNB < `entrySkipBelowBnbUsd` (default $4.50).
6. **Check guardrails** — drawdown, daily limit, position concentration. Adaptive sizing: each guardrail rejection reduces the next proposal by 20% per token.
7. **Execute trades** — SoDEX testnet preferred → TWAK fallback. Pre-flight BNB re-check with reserve enforcement. Linear retry backoff (1s, 2s).
8. **Anchor to Mantle + Casper** — submit thesis hash + score to both ERC-8004 registry and Casper ConvictionRegistry (sequential per-adapter).
8b. **Generate market narrative** — AI-composed headline + summary from SoSoValue feeds and macro events.

### Key Patterns

- **Simulator mode**: Auto-detected when `TWAK_ACCESS_ID` is not set. Uses in-memory mock portfolio.
  - **Composite market data**: SoSoValue token prices are preferred (higher refresh rate); CMC fills missing tokens and provides Fear & Greed / funding rates that SoSoValue doesn't offer. CMC's per-token quote pull (a 147-token batch) is deferred — `cycle-runner.fetchMarketData()` only calls `cmcClient.getEligibleTokenQuotes()` as a fallback when SoSoValue returns no prices, so a healthy SoSoValue run spends ~0 CMC credits on token quotes (CMC is still used every cycle for global metrics + derivatives, which SoSoValue lacks).
  - **Holder data (on-chain conviction)**: NodeReal MegaNode JSON-RPC (`nr_getTokenHolderCount`, 50 CUs/call) is the primary source; CoinGecko token info (`holders.count`) is the fallback. Results cached in `agent/data/holders.json`; growth computed over 7d lookback after 24h+ of snapshots. Agent pre-scores tokens to target the top 15 candidates, not the full universe. The CoinGecko fallback is rate-limited (`COINGECKO_MIN_INTERVAL_MS = 12s`) with a 10-min per-contract cache in `holders.ts`, so a NodeReal outage can't cascade into a CoinGecko 429 storm.
- **Cross-chain anchoring**: Same `ConvictionRecord` payload sent to Mantle (EVM, viem) and Casper (casper-js-sdk). Hashes computed once in `anchors/hashes.ts` via keccak256 — same hash on every chain.
- **Telegram dispatch**: 3-message cycle summary with HTML formatting (`<pre>`, `<code>`, `<b>`). Non-blocking `.catch(() => {})` — env-vars-gated startup/cycle/error alerts.
- **Guardrails**: Pure in-memory state with daily counter reset. Hard limits from `AGENT_CONFIG.trading`.
- **Bankroll management**: BNB reserve + adaptive interval doubling (4h → 8h) when BNB drops below `targetBnbUsd`.
- **Position reconciliation**: at startup, `restoreSnapshot()` cross-checks `state.heldPositions` against live TWAK portfolio and drops ghost positions.
- **Portfolio parser**: Reads `$USD` column from TWAK's column-aligned output. Covered by regression test in `__tests__/twak-executor.test.ts`.
- **Agent-to-agent (A2A)**:
  - MCP server at `/mcp` with Streamable HTTP transport + x402 paywall. Exposes 5 tools: `getLatestConviction`, `crossChainLookup`, `getSubjectHistory`, `getByThesis`, `getAgentReputation`.
  - CROO CAP client connects to the CROO network via WebSocket and advertises 4 reputation services (`reputation-latest`, `reputation-history`, `reputation-cross-chain`, `reputation-agent`) settled in USDC on Base.

### Important Conventions

- All `agent/lib/` imports use `.js` extension (ESM modules compiled from `.ts`).
- Never import Next.js path aliases (`@/`) in agent code.
- Env vars use `TWAK_` prefix (not `TW_`). The portal calls them `TW_ACCESS_ID` and `TW_HMAC_SECRET`, but the agent reads `TWAK_ACCESS_ID` and `TWAK_HMAC_SECRET`.
- `execSync` → prefer `execAsync` for long-running operations (trade execution still uses `execSync` due to TWAK CLI limitations).
- Tests live in `agent/__tests__/` — Vitest framework (151 tests across 10 files).
- `agent/data/state.json` is a runtime artifact — it's in `.gitignore` and should not be committed. If `git status` shows it as modified, run `git rm --cached agent/data/state.json`.
- `agent/data/holders.json` is a runtime cache — also gitignored.
- `agent/docs/api/` is TypeDoc output — gitignored, regenerate via `npm run docs`.

### SoSoValue API Efficiency

SoSoValue rate limits: **20 req/min**, **100,000 req/month** per API key. The agent historically bursts ~150 individual `/currencies/{id}/market-snapshot` calls per cycle, which trips the per-minute limit.

`SosovalueClient` (`agent/lib/data-providers.ts`) mitigates this with tiered caching:

| Cache | TTL | Purpose |
|-------|-----|---------|
| Currency ID list | 5 min | Symbol → ID resolution |
| Market snapshots | 12 h | Avoid re-fetching 150+ snapshots every 4h cycle |
| Daily klines | 4 h | RSI input changes once per day |
| Hot news | 30 min | Shared between sentiment + narrative |
| Featured news | 30 min | Shared between sentiment + narrative |
| Macro events | 1 h | Shared between guardrail pause + narrative |

  Additional protections:

  - If `SOSOVALUE_API_KEY` is missing, all SoSoValue calls short-circuit and CMC/fallback data is used.
  - **Token-bucket rate limiter** (`ssvThrottle` in `data-providers.ts`) wraps every `ssvRestGet` call and enforces the 20 req/min ceiling. The first 20 requests in a window fire immediately, then requests pace at one per 3s. This is what prevents the cold-cache burst (147 snapshot calls + 10 klines + news) from tripping the per-minute limit and getting the key deactivated.
  - A circuit breaker tracks consecutive 401/403/429 responses. After 3 failures, SoSoValue is suspended for 15 minutes.
  - `fetchKlinesBySymbol` is only called for the top 10 conviction candidates and only when `SOSOVALUE_API_KEY` is set.

If you rotate the key, restart the process so the singleton client picks it up and resets the suspension.

---

## Web App Architecture (`src/`)

- **Framework**: Next.js 16 with App Router
- **State**: Zustand store (`src/lib/store.ts`)
- **UI**: Tailwind CSS v4 + `framer-motion` + `lucide-react`
- **Styling**: CSS custom properties in `globals.css` — `--signal`, `--patience`, `--impatience`, `--ethos`
- **API routes**: Server-side only (API keys never reach the client)

### Key UI Components

| Component | Purpose |
|-----------|---------|
| `page.tsx` | Main conviction analysis page |
| `navbar.tsx` | Navigation + Ethos tier badge + search + theme toggle |
| `wallet-search-input.tsx` | Wallet/ENS/Farcaster search |
| `scan-progress.tsx` | Animated progress during analysis |
| `terminal.tsx` | Technical trace log during scan |
| `reputation-tier-card.tsx` | Ethos tier display with perks |
| `position-explorer.tsx` | Detailed position table |
| `aleo-conviction-card.tsx` | Aleo private ZK proof card |
| `mantle-conviction-card.tsx` | Mantle anchored conviction card |

## Common Tasks

### Adding an env var
1. Add to `agent/manifest.json` `secrets` array
2. Add to `agent/lib/config.ts` if agent-side (or read via `process.env.YOUR_VAR` at module scope)
3. Add to `agent/.env.example` with a placeholder value

### Adding a route
1. Add to `agent/manifest.json` `routes` array (Port 31777)
2. Add handler in `agent/src/server.ts`
3. Must return JSON — agent loop polls these for dashboard state

### Adding a pipeline step
1. Implement the step function in `agent/lib/cycle-runner.ts` — reads/writes `state` from `agent-state.ts`
2. Export it and import it in `agent/index.ts` — wire it into `runCycle()` in the correct step position
3. Add console logging for observability

### Adding a chain adapter
1. Implement `AnchorAdapter` interface in a new file under `agent/lib/anchors/` (see `mantle.ts` or `casper.ts`)
2. Register the adapter in `agent/lib/anchors/index.ts` `ADAPTER_REGISTRY`
3. Add chain config to `AGENT_CONFIG` in `config.ts`
4. Add the adapter name to `AGENT_CONFIG.anchoring.adapters`

## Pinata Deployment

- Build: `npm run build` (runs `tsc`)
- Start: `node dist/index.js`
- Port: 31777 (Hono HTTP server)
- Routes are prefixed by Pinata gateway: `/api/status` → `/status` on port 31777

### Deploying to the server (`nuncio-vultr`)

The server's `/home/linuxuser/earlynotwrong` is a **git checkout** of this repo
(no more hand-scp). Deploy with the script:

```bash
cd agent
./deploy.sh                 # deploys origin/main
./deploy.sh <commit-sha>    # pin an exact commit for auditability
```

The script runs on the server: `git fetch` → `git checkout -f <ref>` →
`npm ci` → `rm -rf dist && npm run build` → `pm2 reload earlynotwrong
--update-env`. Build runs before the reload, so a failed build never restarts a
working process. `npm run deploy` is an alias. Rollback = `git checkout <prev>`
on the server.

One-time setup (already done): `git init` + remote + `git checkout -f
origin/main` on the server, and `agent/ecosystem.config.js` documents the pm2
process. The live process is still managed by name (`pm2 reload earlynotwrong`)
so its injected env vars are preserved — do **not** switch it to start from
`ecosystem.config.js` unless you also migrate those env vars into the file.

## TypeDoc Documentation

```bash
cd agent
npm run docs        # generate docs/api/
npm run docs:serve  # serve locally via npx serve
```

- Config: `agent/typedoc.json`
- Output: `agent/docs/api/`
- 217 HTML pages covering all 14 lib modules + src/ server + MCP tools
