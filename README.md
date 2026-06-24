# EARLY, NOT WRONG

> Being early feels like being wrong. Until it doesn't.

An agentic on-chain behavioral analysis app that combines a **conviction analysis dashboard** (Next.js web app) with an **autonomous trading agent** (Node.js CLI/background process) for the BNB Hack: AI Trading Agent Edition.

## Quick Start

```bash
# Install dependencies
npm install
cd agent && npm install && cd ..

# Start in simulator mode (no credentials needed)
AGENT_MODE=simulator npm run --prefix agent dev

# Start in live mode (requires env vars)
export TWAK_ACCESS_ID=...
export TWAK_HMAC_SECRET=...
export CMC_API_KEY=...
npm run --prefix agent dev

# Start the web app (separate terminal)
npm run dev
```

## Key Documents

| Document | Purpose |
|----------|---------|
| [`SOUL.md`](./SOUL.md) | Design philosophy and architectural soul |
| [`AGENTS.md`](./AGENTS.md) | Agent orchestration guide for AI agents |
| [`docs/HACKATHON_PLAN.md`](./docs/HACKATHON_PLAN.md) | BNB Hack implementation plan |
| [`docs/SUBMISSION.md`](./docs/SUBMISSION.md) | Mantle Turing Test Hackathon submission |

---

An agentic on-chain behavioral analysis app that helps crypto traders understand whether their biggest losses came from being wrong — or from not staying right long enough. The app analyzes **Solana** and **Base** wallet behavior, then anchors AI-generated conviction records to **Mantle** as a verifiable agent reputation layer. "Early, Not Wrong" uses **Aleo ZK-Proofs** so traders can build and prove portable behavioral reputation without revealing their underlying wallet history.

## Chain Architecture

- **Solana + Base**: Source chains for wallet history, trade behavior, exits, holding periods, and conviction analysis.
- **Mantle**: Agent identity and reputation settlement layer for anchoring thesis hashes, conviction scores, and verification events.
- **Aleo**: Private credential and selective-disclosure layer for proving conviction predicates without exposing raw wallet history.

---

## Mantle Phase II Submission

- **Track**: AI Alpha & Data
- **Registry**: `0x81226e8894D334c790D9a972855592E6C4eeB15C` (BNB Hack agent; Mantle Turing Test submission uses `0xBd93c9...`)
- **First Anchor Tx**: `0xf0ef9259...` (BNB Hack agent cycle #1)
- **Demo Wallet**: Jesse Dixon showcase wallet on Base, `0x32DA784C5A5813bAB4D52e84840869c273E15E28`
- **Agent Card**: `lens://3d290df5a33aefd485a09d6f5170b8169c198d6ac35a560335fab19e01ca5acf`

[Full submission copy →](docs/SUBMISSION.md)

---

## Aleo Privacy Integration

### The Privacy Dilemma
In traditional Web3, building reputation as a "skilled trader" requires exposing your entire wallet history. This creates a trade-off between **Public Identity** (trust but exposure) and **Anonymous Identity** (privacy but lack of credentials).

### The Solution: Selective Disclosure
"Early, Not Wrong" decouples behavioral verification from wallet identity using Aleo.
1. **Private Commitment**: Mint your Conviction Metrics as encrypted Aleo records.
2. **ZK-Proofs**: Generate proofs for specific predicates (e.g., "Score > 80") without revealing the raw data.
3. **Shield Wallet**: Secure, off-chain management of your behavioral credentials.
4. **Patience Rebates**: Unlock behavioral incentives using the signed-voucher ("pull") treasury model.

[Read our full Privacy Model →](docs/PRIVACY_MODEL.md)

---

## Core Thesis

In asymmetric markets, conviction isn't tested when you're wrong — it's tested when you're early. Losses are capped (−1x), but wins are uncapped. The most expensive mistake isn't being wrong — it's selling winners too early.

## The Problem

Crypto traders systematically:
- Exit profitable positions prematurely due to volatility or social pressure
- Hold losers longer than winners, despite asymmetric payoff structures
- Misinterpret "early" as "wrong" due to short-term drawdowns
- Lack objective, wallet-level evidence of how patience/impatience affects their P&L
- Have no portable reputation that proves their conviction quality across platforms

**No tool exists that reframes trading history through the lens of conviction vs timing, and no composable reputation layer captures this behavioral truth.**

---

## What It Does

An autonomous agent that analyzes historical trades on Solana and Base to:

### Identify
- Positions sold early before significant upside
- Losses capped correctly vs allowed to spiral
- Drawdowns that preceded outsized gains

### Quantify
- Dollar value of impatience vs conviction
- Asymmetry score (capped losses vs uncapped gains captured)
- Patience tax (value lost to premature exits)

### Surface
- **"Early, Not Wrong" events** — trades exited at loss/small gain that later mooned
- **Conviction wins** — holding through drawdowns → outsized returns
- **False conviction** — stubbornness that destroyed asymmetry

---

## User Flow

1. Connect wallet (Solana/Base or both) + Ethos profile
2. Agent autonomously explores token interactions, entry/exit timing, holding periods, post-exit price trajectories
3. Receive **Conviction Report** with behavioral scores, missed upside vs avoided downside, comparative insights
4. Optionally mint private Aleo records and generate ZK-proofs of conviction predicates
5. **Conviction Index anchors to Mantle** — portable, verifiable, composable reputation

---

## Innovation: Conviction Index (CI) as Reputation

A wallet-level score measuring how consistently a trader:
- Allows upside to compound
- Caps downside efficiently
- Holds through drawdowns when asymmetry remains
- Avoids reflexive exits

**CI is not performance. CI is behavior under uncertainty.**

### Conviction Labels

| Label | Characteristics |
|-------|----------------|
| **High Conviction** | Rare trades, large outcome dispersion, thesis-driven exits |
| **Early but Right** | Often underwater initially, disproportionate upside capture |
| **Reactive** | High turnover, frequent early exits, low asymmetry |
| **Stubborn** | Holds losers beyond asymmetry, low signal quality |

---

## Ethos Integration

- **Credibility Score as Entry Point** — filter sybil wallets and wash trading before analysis.
- **Conviction Index → Ethos Reputation** — CI scores written as attestations; behavioral labels become reputation badges.
- **Meta-Signal Attribution** — Ethos credibility score adds a trust layer to behavioral insights surfaced by the agent.

---

## What This Is NOT

❌ Trading bot
❌ Signals platform
❌ Leaderboard for speculation
❌ Financial advice

**This is self-knowledge for asymmetric markets — backed by portable, composable reputation.**

---

## Tone & Aesthetic

Calm, clinical, contrarian. Minimalist, data-forward. No hype, no price predictions.

Inspired by value investing, risk asymmetry, behavioral finance, quiet conviction.

---

## What's Actually Built

This is the live, shipped surface area of the repo today.

### Conviction analysis engine
- Wallet search + connect (Solana, Base, Aleo Shield wallet)
- Analysis pipeline: `src/app/api/analysis/route.ts`, transaction + price + batch endpoints
- Position explorer, history panel, score breakdown, animated conviction score
- Analysis filters and scan-progress UI
- Share dialog + OG image generation (`/api/og`)
- Ethos credibility gating (`src/lib/ethos.ts`, `src/lib/ethos-gates.ts`)
- Farcaster / Neynar identity resolution (`/api/farcaster/resolve`, `/api/identity/resolve`)

### Reputation tier system
- **Tier card** showing current Ethos tier, score, progress bar to next tier, active perks, and locked-perk preview (`src/components/reputation/reputation-tier-card.tsx`)
- **Reusable TierGate** wrapper — any gated UI can drop in `<TierGate requiredScore={X} currentScore={Y} .../>` to render a blurred preview + unlock CTA when locked (`src/components/reputation/tier-gate.tsx`)
- **Perks registry** — `getPerksList(tier)` in `src/lib/ethos-gates.ts` is the single source of truth for what each tier unlocks; drives the tier card and any future gate UI
- Tier tiers (visitor → member → premium @ 1000 → whale @ 1400 → alpha @ 1700 → elite @ 2000)

### Alpha Discovery
- **`/alpha` page** with two tabs: High-Conviction Traders and Token Conviction Heatmap (`src/app/alpha/page.tsx`)
- Traders ranked by conviction score × Ethos multiplier (Elite 1.5x, Alpha 1.3x, Whale 1.15x, Premium 1.05x)
- Token heatmap shows tokens with highest concentration of credible high-conviction holders; intensity = holderCount × avgConvictionScore, normalized 0–100
- Gated at Ethos ≥ 1000 (premium); lower tiers see a blurred showcase preview with unlock CTA
- API routes: `/api/alpha/traders`, `/api/alpha/tokens` (both server-side gated)
- Showcase data fallback when the DB is empty so judges and new users see the intended UX
- Nav link in the navbar (desktop + mobile)

### Cohort Comparison
- Embedded panel in the conviction results that benchmarks the analyzed wallet against its Ethos tier's median: conviction score, patience tax, win rate + percentile
- Gated at Ethos ≥ 1400 (whale); lower tiers see a TierGate teaser
- API route: `/api/cohort/compare?address=…&chain=…&score=…` (pulls from the `cohort_stats` Postgres view)
- Hook + component: `src/hooks/use-cohort-comparison.ts`, `src/components/analysis/cohort-comparison.tsx`

### Private Treasury (Privacy Cash)
- Displays the connected Solana wallet's **private SOL balance** (LightProtocol state) via the `privacycash` SDK
- Server-side SDK execution — the SDK depends on Node-only modules (`fs`, `node-localstorage`), so we run it on the server behind `/api/privacy/balance`; the browser bundle never imports it (configured via `serverExternalPackages` in `next.config.ts`)
- Hook + component: `src/hooks/use-privacy-cash.ts`, `src/components/privacy/private-balance-card.tsx`
- Explorer link + refresh button; read-only for now (deposit/withdraw require server-held session keys, deferred)

### Aleo privacy layer (Phase 5 — complete)
- Leo program `early_not_wrong_v3.aleo` (`aleo/src/main.leo`) with `ConvictionRecord`, `PrivateThesis`, and the signed-voucher `claim_rebate` transition
- Aleo conviction card, private thesis composer, and proof dialog (`src/components/aleo/`)
- Client + treasury libraries (`src/lib/aleo/client.ts`, `src/lib/aleo/treasury.ts`)
- API routes: `/api/aleo/rebate`, `/api/aleo/thesis`, `/api/aleo/verify`
- `use-aleo-conviction` hook and Shield wallet adaptor integration

### Mantle agent layer (Phase 8 — in progress)
- `MantleConvictionRegistry.sol` — anchors cross-chain subject hashes, thesis hashes, conviction scores, and archetypes on Mantle L2
- Mantle conviction card + strategy lens (`src/components/mantle/`)
- Agent card published to Grove (`lens://…`)
- `scripts/publish-agent-card-to-grove.mjs`

### Autonomous Trading Agent (BNB Hack — live)
- **8-step autonomous loop**: portfolio → market data → 6-factor conviction scoring → position management → proposals → bankroll-aware sizing → guardrails → TWAK execution → Mantle anchoring
- **6-factor conviction signal**: contrarian (30) + RSI timing (10) + quality (15) + regime (20) + holder growth (10) − volatility penalty. Pure functions in `agent/lib/conviction-signal.ts`, fully testable.
- **On-chain behavioral conviction**: NodeReal MegaNode JSON-RPC (`nr_getTokenHolderCount`) + CoinGecko fallback query BEP-20 holder counts for the top 15 conviction candidates. Growth tracked over 7d in `agent/data/holders.json` — tokens with expanding holder bases earn a bonus ("smart money accumulating").
- **Tiered position management**: HOLD through ordinary drawdown ("early, not wrong"), take 33% profit at +50% (capital recycling), full exit only at −35% stop or +100% trail. Self-funding: harvests weakest mature position to BNB when balance runs low.
- **Bankroll management** (`agent/lib/config.ts` → `AGENT_CONFIG.trading.bankroll`): $5 non-spendable reserve, 50% per-trade cap on tradeable BNB, entry-skip below $10, adaptive interval (4h normally, 8h when BNB < $25). Per-trade cap = `min(portfolio × 15%, (BNB − reserve) × 50%)`. Pre-flight live BNB check refuses trades that would breach the reserve.
- **Harvest + exit fallback ladders**: when the primary swap reverts on thin pools (we hit `execution reverted: 0xf4059071` on HOME→BNB), the agent routes through USDC intermediate, then size-probes for tax tokens, then alerts via Telegram. Same shape on stuck exits.
- **Startup reconciliation**: `restoreSnapshot()` cross-checks `state.heldPositions` against the live TWAK portfolio and drops ghost positions (in-memory entries with no on-chain balance). Pruned 13 stuck positions on first run.
- **Self-custody execution**: TWAK (Trust Wallet Agent Kit) for BSC testnet swaps with DEX liquidity checks and address resolution via `twak search`. Portfolio parser reads the `$USD` column (column-aware), not the balance — covered by a regression test.
- **Live dashboard**: `/agent` page with real-time conviction signals, regime score, held positions, and trade history — proxied from the VPS agent at `http://144.202.117.160:31777`.
- **Agent API**: `GET /status`, `GET /trades`, `GET /conviction` — served by Hono HTTP server on port 31777.
- **Telegram alerts**: Cycle summaries with per-trade details, portfolio status, regime score, and Mantle anchoring confirmation.

### Leaderboard
- `/leaderboard` page and `/api/leaderboard` route
- `leaderboard-table` component with conviction + data-quality badges

### Watchlist
- Postgres-backed personal watchlist (`/api/user/watchlist`, `use-personal-watchlist`)

---

## BNB Hack Progress

| Date | Milestone |
|------|-----------|
| Jun 24 | **Conservative bankroll management** — `$5 reserve`, 50% per-trade cap on tradeable BNB, entry-skip below $10, adaptive interval (4h → 8h when BNB < $25). Cycle 4 self-throttled cleanly when BNB dropped below the floor. |
| Jun 24 | **Portfolio parser fix** — `parsePortfolioOutput` now reads the `$USD` column from TWAK's column-aligned output instead of the first numeric token (which was the on-chain balance). Regression test pinned. |
| Jun 24 | **Startup reconciliation** — `restoreSnapshot()` drops ghost positions from `state.heldPositions` when they have no on-chain balance. Pruned 13 stuck positions on first run, freeing the conviction ledger. |
| Jun 24 | **Harvest + exit fallback ladders** — primary → 5% slippage → USDC pair → Telegram alert. Handles `execution reverted: 0xf4059071` and similar. |
| Jun 21 | **Self-funding agent** — harvests mature positions (8+ cycles) to BNB when balance runs low, no manual top-ups needed |
| Jun 21 | **Tiered profit-taking** — sell 33% at +50% gain, remainder trails at +100% → 30% give-back |
| Jun 21 | **Live trades on BSC mainnet** — 6 trades executed, 12 positions held through drawdown |
| Jun 21 | **Mantle on-chain anchoring** — conviction records anchored to Mantle Sepolia (ERC-8004) |
| Jun 21 | **On-chain holder conviction** — NodeReal JSON-RPC + CoinGecko fallback query BEP-20 holder counts for top 15 candidates |
| Jun 21 | **6-factor conviction signal** — contrarian + RSI timing + quality + regime + holder growth − volatility penalty |
| Jun 20 | **Thesis realignment** — conviction-native strategy replacing momentum bot |
| Jun 20 | **TWAK integration** — self-custody execution via Trust Wallet Agent Kit |

**Current state**: Agent running live under pm2, cycling every 4 hours (8h adaptive when BNB < $25), trading on BSC mainnet, anchoring to Mantle, posting to Telegram. 13 ghost positions pruned on the last restart; conviction ledger reconciled with on-chain reality. 3 positions held across BNB + USDC + INJ + FET (the latter two entered via bankroll-aware sizing on Jun 24).

---

## Roadmap Status

Staying on **testnet** until all phases below are complete.

| Phase | Scope | Status |
|-------|-------|--------|
| **5 — Aleo Privacy** | Leo program, selective disclosure, signed-voucher treasury | ✅ Shipped |
| **8 — Mantle Agentic** | Registry contract + agent card + strategy lens | 🚧 Partial (ERC-8004 registration, RWA strategy engine for USDY/mETH, A2A/MCP endpoints, validation registry still planned) |
| **6 — Mainnet** | Deploy `early_not_wrong_v3.aleo` to Aleo mainnet; DeFi partnerships; anonymous reputation | 🔜 After 5+8 |
| **7 — Cross-Chain** | Arbitrum/Optimism, NFT positions, private peer comparison, ZK-endorsements | 🔮 Future |

Features that were previously described in older "Recent Updates" sections but not built have either now been shipped in this codebase (reputation tier perks, Alpha Discovery, token heatmap, cohort analysis, Privacy Cash private balance) or remain intentionally deferred until their infrastructure criteria in `ROADMAP.md` are met (cluster signals, Email/Telegram alerts, Farcaster Frames endpoints, EAS on-chain attestations, anonymous peer comparison).

---

## API Documentation

### Core Endpoints
```
GET /api/analysis                  - Run conviction analysis on a wallet
GET /api/analyze/transactions      - Fetch transaction history
GET /api/analyze/prices            - Price lookups for post-exit trajectories
GET /api/analyze/batch             - Batched analysis requests
GET /api/leaderboard               - Conviction leaderboard
GET /api/alpha/traders             - Ethos-weighted top conviction wallets (gated: Ethos ≥ 1000)
GET /api/alpha/tokens              - Token conviction heatmap (gated: Ethos ≥ 1000)
GET /api/cohort/compare            - Tier-benchmarked comparison (gated: Ethos ≥ 1400)
GET /api/privacy/balance           - Solana wallet's private SOL balance (Privacy Cash)
GET /api/identity/resolve          - Cross-chain identity resolution
GET /api/farcaster/resolve         - Farcaster / Neynar profile resolution
GET /api/user/profile              - User profile + Ethos reputation
GET /api/user/watchlist            - Personal watchlist CRUD
GET /api/aleo/rebate               - Issue signed rebate voucher
GET /api/aleo/thesis               - Commit private thesis to Aleo
GET /api/aleo/verify               - Verify Aleo ZK-proof
GET /api/og                        - OG image generation for shares
```

### Authentication
All API calls require:
- Connected wallet address (Solana, Base, or Aleo)
- Ethos credibility verification where applicable

---

## Self-Hosted Deployment

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Aleo toolchain (for local Leo development)
- Hardhat (for Mantle contract deployment)

### Environment Variables
```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/earlynotwrong"
POSTGRES_URL=""                 # @vercel/postgres alternate

# API Keys
ETHOS_API_KEY=""
NEYNAR_API_KEY=""
ALCHEMY_API_KEY=""              # Base RPC / webhooks
HELIUS_API_KEY=""               # Solana RPC
HELIUS_RPC_URL=""               # Optional explicit Solana RPC for Privacy Cash (falls back to mainnet-beta)

# Farcaster
FARCASTER_DEVELOPER_ID=""
FARCASTER_SIGNER_UUID=""

# Aleo
ALEO_PRIVATE_KEY=""
ALEO_TREASURY_PRIVATE_KEY=""    # Signs rebate vouchers
NEXT_PUBLIC_ALEO_PROGRAM_ID="early_not_wrong_v3.aleo"

# Mantle
NEXT_PUBLIC_MANTLE_CONVICTION_REGISTRY="0x81226e8894D334c790D9a972855592E6C4eeB15C"
MANTLE_RPC_URL=""

# Trading Agent
TWAK_ACCESS_ID=""                  # TWAK credentials (live mode)
TWAK_HMAC_SECRET=""                # TWAK credentials (live mode)
AGENT_WALLET_KEY=""                # Agent wallet address
CMC_API_KEY=""                     # CMC Pro REST API key
NODEREAL_API_KEY=""                # NodeReal MegaNode — BSC holder counts
COINGECKO_API_KEY=""               # CoinGecko demo — holder count fallback
MANTLE_OPERATOR_KEY=""             # Mantle anchoring private key
TELEGRAM_BOT_TOKEN=""              # Telegram cycle alerts
TELEGRAM_CHAT_ID=""                # Telegram chat target

# Security
JWT_SECRET=""
ENCRYPTION_KEY=""
```

### Running locally
```bash
npm install
npm run dev            # Next.js dev server
npm run mantle:deploy  # Deploy Mantle registry to Sepolia
```

### Monitoring
- Health checks at `/api/health` (planned)

---

## Philosophy

**In asymmetric markets, conviction itself is a signal — but only if it's earned.**

**With portable ZK-proven reputation, that conviction travels with the trader.**

---

## Architecture & Design Principles

This project is governed by a set of core principles that guide every decision — from component design to code deletion. These principles are codified in [`docs/CORE_PRINCIPLES.md`](docs/CORE_PRINCIPLES.md) and referenced in our planning documents.

Key documents:
- **[Core Principles](docs/CORE_PRINCIPLES.md)** — Enhancement First, Consolidation, DRY, and more
- **[Hackathon Plan](docs/HACKATHON_PLAN.md)** — Implementation plan for the BNB Hack: AI Trading Agent Edition
- **[Privacy Model](docs/PRIVACY_MODEL.md)** — Aleo ZK-powered private credential system
- **[Security Model](docs/SECURITY.md)** — Signed-voucher treasury and replay protection
- **[Submission Copy](docs/SUBMISSION.md)** — Mantle Turing Test Hackathon submission

## License

MIT
