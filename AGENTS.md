# AGENTS.md — Agent Orchestration Guide

> How AI agents should navigate and modify the Early, Not Wrong codebase.

## Project Overview

Two main entry points:

```
agent/       — Autonomous trading agent (Node.js, TypeScript, Hono)
src/         — Next.js web app (frontend + API routes)
```

The **agent** is the primary focus for BNB Hack. The **web app** is the Conviction Analysis dashboard.

## Agent Architecture (`agent/`)

### Entry Points

| File | Purpose |
|------|---------|
| `agent/index.ts` | Main loop — 8-step trading cycle |
| `agent/src/server.ts` | HTTP server (3 routes: `/status`, `/trades`, `/conviction`) |
| `agent/lib/config.ts` | Single config — trading params, chain configs, thresholds, signal weights |
| `agent/lib/cmc-client.ts` | CMC Pro REST API client (market data) |
| `agent/lib/conviction-signal.ts` | 6-factor conviction scoring engine (pure functions) |
| `agent/lib/bscscan-client.ts` | On-chain holder counts via NodeReal JSON-RPC + CoinGecko fallback |
| `agent/lib/holder-growth.ts` | Holder growth % computation and scoring fraction |
| `agent/lib/twak-executor.ts` | TWAK CLI wrapper (trade execution + address resolution) |
| `agent/lib/mantle.ts` | Mantle ERC-8004 anchoring (viem) |
| `agent/lib/risk-guardrails.ts` | Risk limits (drawdown, position size, daily count) |
| `agent/lib/telegram.ts` | Telegram dispatch (cycle summaries, errors) |
| `agent/lib/persistence.ts` | SQLite Sync state persistence |
| `agent/lib/env-loader.ts` | Loads `.env` before module construction |
| `agent/lib/errors.ts` | Standardized error types |

### Trading Loop (8 Steps)

1. **Fetch portfolio** from TWAK
2. **Fetch market data** from CMC REST API
3. **Score market regime + token conviction** — Fear & Greed (CMC v3), funding rates (CMC v5), then 6-factor per-token scoring:
   - Contrarian (30) — rewards assets down 7d during fear
   - RSI timing (10) — synthesized RSI(14) from 7d return; bonus for oversold
   - Quality (15) — market cap × liquidity filter
   - Regime (20) — fear & greed + funding rate composite
   - Holder growth (10) — on-chain holder base expansion (NodeReal + CoinGecko)
   - Volatility penalty — subtracted for erratic 7d price paths
4. **Manage open positions** — tiered exits:
   - HOLD through ordinary drawdown ("early, not wrong")
   - EXIT_PARTIAL at +50% gain — sell 33%, let the rest ride (capital recycling)
   - EXIT_STOP at −35% — thesis invalidated, cap the loss
   - EXIT_TRAIL at +100% peak → 30% give-back — lock the asymmetry
4b. **Harvest for BNB** — when BNB balance < `bankroll.harvestMinBnbUsd` (default $8), sell the weakest position held 8+ cycles. **Fallback ladder** (since v0.2):
   - Primary: position → BNB direct swap
   - Fallback A: position → USDC → BNB (deeper USDC liquidity on most BSC pairs)
   - Fallback B: size probe ($0.50 then $1) to diagnose amount-related reverts (catches tax tokens)
   - Final: Telegram alert + 5-cycle cooldown on the broken token
5. **Create trade proposals** — top-K tokens weighted by conviction, with DEX liquidity check. **Bankroll-aware sizing** (since v0.2): per-trade cap = `min(portfolio × 15%, (BNB − reserve) × 50%)`. Entries skipped entirely when BNB < `bankroll.entrySkipBelowBnbUsd` (default $10).
6. **Check guardrails** — drawdown, daily limit, position concentration. **Peak value tracking** (since v0.2): seeded only at end of cycle from a post-trade portfolio snapshot, never from a pre-trade value (avoids phantom drawdowns on every restart).
7. **Execute trades** via TWAK. **Pre-flight** (since v0.2): re-checks live BNB and refuses if the trade would breach `bankroll.minBnbReserveUsd` (default $5). **Exit fallback ladder**: primary → 5% slippage → USDC pair → Telegram alert.
8. **Anchor to Mantle** — submit thesis hash + score to ERC-8004 registry

### Key Patterns

- **Simulator mode**: Auto-detected when `TWAK_ACCESS_ID` is not set. Uses in-memory mock portfolio.
- **CMC API key**: CMC queries use the Pro REST API with `X-CMC_PRO_API_KEY` header. Fallback to neutral values if the API is unreachable. Fear & Greed from CMC v3 endpoint, derivatives from CMC v5 endpoint.
- **Holder data (on-chain conviction)**: NodeReal MegaNode JSON-RPC (`nr_getTokenHolderCount`, 50 CUs/call) is the primary source; CoinGecko token info (`holders.count`) is the fallback. Both gated on env vars (`NODEREAL_API_KEY`, `COINGECKO_API_KEY`). Results cached in `agent/data/holders.json`; growth computed over 7d lookback after 24h+ of snapshots. Agent pre-scores tokens to target the top 15 candidates, not the full universe.
- **Env loader**: `agent/lib/env-loader.ts` runs `dotenv` before any module construction so API keys resolve at import time.
- **Telegram dispatch**: Non-blocking `.catch(() => {})` — env-vars-gated startup/cycle/error alerts.
- **Guardrails**: Pure in-memory state with daily counter reset. Hard limits from `AGENT_CONFIG.trading`.
- **Bankroll management** (since v0.2): `AGENT_CONFIG.trading.bankroll` defines a non-spendable BNB reserve, an entry-skip floor, and a per-trade cap as a fraction of tradeable BNB. When BNB drops below `targetBnbUsd` (default $25), the loop interval doubles (4h → 8h) to preserve gas spent on Mantle anchoring.
- **Position reconciliation** (since v0.2): at startup, `restoreSnapshot()` cross-checks `state.heldPositions` against the live TWAK portfolio and drops ghost positions (in-memory entries with no on-chain balance). Prevents stuck positions like H-at-−55% from haunting the conviction ledger forever.
- **Portfolio parser** (since v0.2): `parsePortfolioOutput` reads the `$USD` column from TWAK's column-aligned output. Earlier regex matched the first numeric token (balance), reporting BNB's balance (0.057) as its USD value — fixed and covered by a regression test in `__tests__/twak-executor.test.ts`.
- **Retry with backoff**: Trade execution and Mantle anchoring use linear backoff (1s, 2s).

### Important Conventions

- All `agent/lib/` imports use `.js` extension (ESM modules compiled from `.ts`).
- Never import Next.js path aliases (`@/`) in agent code.
- Env vars use `TWAK_` prefix (not `TW_`). The portal calls them `TW_ACCESS_ID` and `TW_HMAC_SECRET`, but the agent reads `TWAK_ACCESS_ID` and `TWAK_HMAC_SECRET`.
- `execSync` → prefer `execAsync` for long-running operations (trade execution still uses `execSync` due to TWAK CLI limitations).
- Tests live in `agent/__tests__/` — Vitest framework.
- `agent/data/state.json` is a runtime artifact — it's in `.gitignore` and should not be committed. If `git status` shows it as modified, run `git rm --cached agent/data/state.json`.

### Important Conventions

- All `agent/lib/` imports use `.js` extension (ESM modules compiled from `.ts`).
- Never import Next.js path aliases (`@/`) in agent code.
- Env vars use `TWAK_` prefix (not `TW_`). The portal calls them `TW_ACCESS_ID` and `TW_HMAC_SECRET`, but the agent reads `TWAK_ACCESS_ID` and `TWAK_HMAC_SECRET`.
- `execSync` → prefer `execAsync` for long-running operations (trade execution still uses `execSync` due to TWAK CLI limitations).
- Tests live in `agent/__tests__/` — Vitest framework.

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
| `search-input.tsx` | Wallet/ENS/Farcaster search |
| `scan-progress.tsx` | Animated progress during analysis |
| `terminal.tsx` | Technical trace log during scan |
| `reputation-tier-card.tsx` | Ethos tier display with perks |
| `position-explorer.tsx` | Detailed position table |

## Common Tasks

### Adding an env var
1. Add to `agent/manifest.json` `secrets` array
2. Add to `agent/lib/config.ts` if agent-side
3. Reference via `process.env.YOUR_VAR`

### Adding a route
1. Add to `agent/manifest.json` `routes` array
2. Add handler in `agent/src/server.ts`
3. Port 3000 only

### Adding a scheduled task
1. Add to `agent/manifest.json` `tasks` array
2. Schedule in minutes, timeout in seconds

## Pinata Deployment

- Build: `npm run build` (runs `tsc`)
- Start: `node dist/index.js`
- Port: 3000 (Hono HTTP server)
- Routes are prefixed by Pinata gateway: `/api/status` → `/status` on port 3000
