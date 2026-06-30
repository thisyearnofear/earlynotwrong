# BNB Hack: AI Trading Agent Edition — Submission

## Project

**Name**: Early, Not Wrong — Conviction-Native Trading Agent
**Tagline**: *Being early feels like being wrong. Until it doesn't.*

**Track 1 (primary)**: Autonomous Trading Agents ($24K) — live PnL on BSC, ranked by total return with 30% max-drawdown gate
**Track 2 (secondary)**: Strategy Skills ($6K) — the 6-factor conviction signal below is the strategy spec
**Also targeting**: Best Use of TWAK ($2K), Best Use of Agent Hub ($2K)

---

## Technical Execution

### Architecture

```
CMC Agent Hub ──► Conviction Engine ──► Bankroll-Aware Sizer ──► TWAK Execution ──► Mantle Anchoring
     (data)           (scoring)              (filters)           (swaps)            (proof)
```

The agent is implemented as a standalone Node.js process running autonomously on a VPS (self-hosted, not Pinata). Each 4-hour cycle:

1. **Portfolio State** — Fetches real BNB balance via TWAK (`bsc (BNB) Total: 0.0156 BNB ≈ $9.03`, plus 0.65 USDC and held tokens)
2. **Market Data** — Pulls Fear & Greed Index, funding rates, and token prices from the CMC Pro REST API
3. **Conviction Scoring** — Scores 147 eligible BEP-20 tokens using a 6-factor signal (contrarian + RSI timing + quality + regime + holder growth − volatility penalty)
4. **Liquidity Screening** — Checks DEX liquidity via TWAK swap quotes for the top 20 candidates, keeping up to top-2 with real liquidity
5. **Bankroll-Aware Sizing** — Per-trade cap = `min(portfolio × 15%, (BNB − $5 reserve) × 50%)`. Entries skipped entirely when BNB < $10. Loop interval doubles to 8h when BNB < $25 to preserve anchor gas.
6. **Risk Guardrails** — 8 checks: trading window, portfolio minimum, drawdown (25% hard stop), token allowlist, per-trade limit ($1K), daily limit (6), concentration (20%), conviction floor (58)
7. **TWAK Execution** — Live swaps via Agent Wallet Mode (self-custody, autonomous signing). Pre-flight rechecks live BNB and refuses if the trade would breach the $5 reserve.
8. **Mantle Anchoring** — Analysis hash, conviction score, and archetype written to ERC-8004 registry on Mantle Sepolia (every cycle, even when no trades execute)

### Position Management ("The Soul")

The agent embodies "Early, Not Wrong" through four exit tiers:
- **HOLD** through ordinary drawdown (the default — patience is the strategy)
- **EXIT_PARTIAL** at +50% gain — sell 33%, let the rest ride (capital recycling)
- **EXIT_STOP** at −35% — thesis invalidated, cap the loss
- **EXIT_TRAIL** at +100% peak → 30% give-back — lock the asymmetry

When the EXIT_STOP swap reverts on a thin pool (we hit this on a $3 HOME position pre-fix), an **exit fallback ladder** kicks in: primary swap → 5% slippage → USDC pair → Telegram alert. Same shape on the **harvest ladder** for the self-funding loop (sell weakest 8+ cycle position → BNB direct → USDC intermediate → size probe → alert + cooldown).

### Bankroll Discipline

BNB is both the gas asset and the trade-value asset. A single careless trade can drain the wallet and starve the agent for the rest of the trading window. `AGENT_CONFIG.trading.bankroll` enforces:
- $2.5 non-spendable reserve (gas + emergency exit) — tight for the live competition window
- 50% per-trade cap on tradeable BNB (one trade can never consume more than half)
- Entry-skip below $4.5 BNB (focus cycles on harvest)
- Harvest floor $6 — *above* the entry-skip so harvest fires whenever entries are blocked (no BNB dead zone)
- Position cap of 8 — proactive harvest when over cap, picking the smallest mature position so the strong ones survive
- Adaptive interval: 4h normally, slows when BNB target unmet

Combined with the harvest ladder + 95% sizing, the agent is **self-funding** within the trading window — verified live on Jun 25 with a clean MYX → BNB harvest after the resolver/sizing fixes.

### Startup Reconciliation

On every restart, `restoreSnapshot()` cross-checks `state.heldPositions` against the **live on-chain balances** (`balanceOf` via NodeReal RPC) and drops ghost positions only when the chain confirms zero. Earlier we relied on `twak wallet portfolio`, which only reports native + USDC and *not* BEP-20 holdings — so legitimate positions were being silently wiped as "ghosts" on every restart. The new reader (`agent/lib/onchain-portfolio.ts`) verifies real balances and prices each holding **by contract** (CoinGecko → DexScreener; never CMC-by-symbol, which once valued a fake "ETH" lookalike at real ETH's $1,567 and corrupted the drawdown peak).

### Defense-in-Depth Against Fake Tokens

A scam-lookalike resolution bug had been silently mis-routing entries (e.g. `twak search INJ` returning KaiChain because its CMC logo URL outranked the real Injective listing). Live wallet audit found four illiquid honeypot positions — KAI ($37.95 paper value, $951 DEX pool, $0 24h volume, swap reverts with `SafeMath: subtraction overflow`), plus NXPC, KITE, CYS. Defense now stacks six layers:

| Layer | Where | Catches |
|-------|-------|---------|
| **1. Exact symbol + reference-price gate** | `selectBestTokenMatch` in `lib/twak-executor.ts` | INJ → KaiChain, ETH → 0x000008D2… (fake at $0.00001 vs ref $1500) |
| **2. DexScreener pool depth** | `checkLiquidity` (new gate) | Pools < $5k, 24h volume < $100 |
| **3. TWAK quote-only check** | existing | Router can't route it at all |
| **4. 95% harvest sizing** | `harvestForBnb` in `index.ts` | `ExceedsBalance (0xf4059071)` reverts on 100%-of-balance swaps |
| **5. Position cap (8)** | `AGENT_CONFIG.trading.maxOpenPositions` | Sub-$5 dust accumulating beyond a manageable count |
| **6. Wallet audit + prune** | `agent/scripts/audit-holdings.mjs --prune` | Honeypots already in the wallet from pre-fix days |

The first three gates fire **before** any BNB is committed; the bottom three keep the existing portfolio clean. Verified with 19 new unit tests (resolver pickers, DexScreener gate behaviour, on-chain valuation fallbacks).

### On-Chain Evidence

| Component | Address / Evidence | Network |
|-----------|-------------------|---------|
| **Agent wallet** | `0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a` | BSC Mainnet |
| **Compete registration** | Registered (`twak compete status` → `registered: true`, live PnL window Jun 22–28) | BSC Mainnet |
| **TWAK swaps** | Multiple live entries (INJ, FET, RAVE, AXS, BSB, …) + first qualifying harvest trade Jun 25 (MYX → BNB) | BSC Mainnet |
| **Mantle registry** | `0x81226e8894D334c790D9a972855592E6C4eeB15C` (anchored every cycle, even when no trades execute) | Mantle Sepolia |
| **Agent card** | Published to Grove storage (`lens://3d290df5...`) | IPFS |
| **Current portfolio** (Jun 25) | ≈$88 across 13 tradeable positions after pruning 4 illiquid honeypots ($46 paper value). Real BSC capital: BNB + USDC + 13 BEP-20s. | BSC Mainnet |

### Key Files

| File | Purpose |
|------|---------|
| `agent/index.ts` | Main loop orchestrator (all 8 steps + bankroll + reconciliation) |
| `agent/lib/config.ts` | `AGENT_CONFIG.trading.bankroll` block (reserve, entry-skip, max-trade-fraction, adaptive interval) |
| `agent/lib/cmc-client.ts` | CMC Pro REST API data ingestion |
| `agent/lib/conviction-signal.ts` | 6-factor token conviction scoring engine (pure functions) |
| `agent/lib/twak-executor.ts` | TWAK CLI wrapper with DI for testing; `selectBestTokenMatch` (exact-symbol + reference-price gate) + DexScreener pool-depth gate; column-aware portfolio parser |
| `agent/lib/onchain-portfolio.ts` | `balanceOf`-based on-chain reader with layered pricing (CoinGecko → DexScreener, contract-only) — single source of truth for portfolio value across loop + API + guardrails |
| `agent/lib/risk-guardrails.ts` | 8 guardrail checks; peak seeded only at end of cycle (no phantom drawdowns) |
| `agent/src/server.ts` | Hono HTTP server exposing `/status`, `/trades`, `/conviction` on port 31777 — uses the same augmented portfolio as the cycle |
| `agent/scripts/scan-holdings.mjs` | Discovers every BEP-20 the wallet holds via ERC-20 Transfer log scan; classifies each as bought-by-agent vs airdrop spam by transfer initiator |
| `agent/scripts/recover-positions.mjs` | Re-adopts legit on-chain bought tokens into `state.json` (`--apply`); excludes airdrops and illiquid paper-pumps |
| `agent/scripts/audit-holdings.mjs` | DexScreener-backed liquidity/legitimacy audit of held positions; `--prune` mode removes illiquid + no-pair entries from the ledger |

---

## Originality

### Why Conviction-Weighted Direct Execution?

Most trading agents fall into one of three categories:

1. **Signal-based** — Trade on technical indicators (RSI, MACD, etc.). Prone to overfitting and regime changes.
2. **Copy-trading** — Mirror top wallets by volume. Copies noise and wash trading as much as signal.
3. **LLM-prompted** — Ask an LLM "what should I trade?" with no structured risk framework.

Our agent does something different: **it scores conviction as a behavioral metric, not a price prediction**, and then trades directly into tokens that exhibit strong behavioral signals — *not* into whatever top wallets happen to be moving.

### The 6-Factor Conviction Signal

Instead of asking "which token will go up?", the agent asks "which tokens have the strongest behavioral conviction right now?":

- **Contrarian (30)** — Rewards assets down 7d during fear (the "early, not wrong" thesis literalized)
- **RSI timing (10)** — Synthesized RSI(14) from 7d return; bonus for oversold
- **Quality (15)** — Market cap × liquidity filter (capped downside, room to run)
- **Regime (20)** — Fear & Greed + funding rate composite (entering when market is fearful)
- **Holder growth (10)** — On-chain holder base expansion via NodeReal JSON-RPC + CoinGecko fallback ("smart money accumulating")
- **Volatility penalty** — Subtracted for erratic 7d price paths

### Bankroll Awareness as a First-Class Concern

Most trading agents treat capital as effectively infinite and size trades off portfolio value. Ours treats **BNB as the binding constraint** — it's both the gas asset and the trade-value asset. Per-trade sizing caps at `min(portfolio × 15%, (BNB − reserve) × 50%)` so a single trade can never consume more than half of what's available. Entries auto-skip below $10 BNB; the loop interval doubles to 8h below $25. **The agent manages its own runway.**

### Self-Funding Harvest Ladder

When BNB drops, the agent sells its weakest held position (≥8 cycles old) back into BNB. If the direct swap reverts (thin pool, tax token, or `execution reverted: 0xf4059071`), it falls back to a USDC intermediate, then to a size probe to diagnose tax tokens, and finally to a Telegram alert + 5-cycle cooldown. Same fallback shape on the exit ladder.

### Novel Contributions

1. **Behavioral conviction as a trading signal** — Not price prediction, not volume copying, but conviction scoring across 6 factors
2. **Bankroll-aware sizing** — Per-trade caps are derived from BNB availability, not portfolio value (portfolio value can lie; BNB is the binding constraint)
3. **Self-funding with fallback ladder** — Single point of failure on harvest breaks the entire trading loop; we route through USDC when direct reverts
4. **Reconciliation on startup** — Cross-checks in-memory positions against on-chain balances; drops ghosts that would otherwise haunt the ledger forever
5. **Full-stack autonomous loop** — CMC data → scoring → bankroll → TWAK execution → Mantle anchoring, all in one self-contained process
6. **DI-based testing** — TWAK executor uses dependency injection (`execFileOverride`) + injectable DexScreener fetcher; 120 unit tests cover resolver, DexScreener gate, on-chain valuation, harvest logic, guardrails, and the full simulator path — no mocks of Node.js built-ins

---

## Real-World Relevance

### The Problem

Crypto copy-trading is broken:
- **Top-wallet copying** includes wash traders, bots, and lucky gamblers
- **Signal services** sell noise and rarely disclose their methodology
- **No guardrails** — most copy-trading tools have no drawdown protection or position concentration limits

### Our Solution

A transparent, verifiable agent that:
- Publishes its **full methodology** in open-source code
- Enforces **hard risk limits** (25% drawdown, 20% concentration, 10 trades/day)
- **Anchors every decision** to an on-chain registry (Mantle ERC-8004)
- Uses **self-custody signing** via TWAK — no third-party key custody
- Is **auditable** — every trade, every score, every rejection is logged

### Target Users

- **Hackathon competitors** needing a reproducible reference architecture
- **Retail traders** who want automated copy-trading with institutional-grade risk controls
- **Researchers** studying behavioral finance in crypto markets

---

## Demo

### Live Agent

The agent is running autonomously on a VPS (nuncio-vultr):

```
HTTP: http://<vps-ip>:31777
Routes:
  GET /status      — Agent status, portfolio, guardrail state
  GET /trades      — Trade history
  GET /conviction  — Market data and conviction scores
```

### Demo Script — Step by Step

#### Step 1: Health Check Startup

Run the agent and show its startup banner and health check:

```
╔═══════════════════════════════════════╗
║  EARLY, NOT WRONG — Trading Agent     ║
║  BNB Hack: AI Trading Agent Edition   ║
╚═══════════════════════════════════════╝

Top-K: 2
Interval: 240 minutes (×2 when BNB < $25)
Max drawdown: 25%
Eligible tokens: 147
Default slippage: 100 bps
Bankroll: reserve=$5, target=$25, max-trade-fraction=50%, entry-skip-below=$10
[server] Running on port 31777

── Startup Health Check ──
[CMC] Connected via REST API
  TWAK:      ✓ (live)
  CMC MCP:   ✓ (connected)
  Wallet:    0xA1Dd482E...888a
  Guardrails: ✓ (0/6 trades today)
  Mode:      LIVE
  Market:    BSC Testnet
  Snapshot: restored N open position(s) from last cycle
  [reconcile] All N positions confirmed on-chain (or: Pruned X ghost position(s))
```

Demonstrates: TWAK live mode, CMC connected, bankroll config surfaced, ghost-position reconciliation on restart.

#### Step 2: GET /status — Agent Status Endpoint

Open a browser or curl to `http://<vps-ip>:31777/status`. Show this response:

```json
{
    "agent": "Early, Not Wrong",
    "version": "0.1.0",
    "hackathon": "BNB Hack: AI Trading Agent Edition",
    "status": "idle",
    "cycle": 1,
    "lastRunAt": 1782305323826,
    "nextRunAt": 1782319793869,
    "totalTrades": 6,
    "totalVolumeUsd": 16,
    "errors": 0,
    "portfolio": {
        "totalValueUsd": 14.62,
        "positions": 3,
        "chains": ["bsc"]
    },
    "guardrails": {
        "drawdownPercent": 0.4,
        "peakValueUsd": 14.68,
        "tradesToday": 0,
        "dailyLimit": 6,
        "drawdownExceeded": false,
        "allOk": true
    }
}
```

Demonstrates: live trading active, peak tracked at end-of-cycle (not phantom-flagged), guardrails reporting cleanly, $14.62 portfolio > $1 floor.

#### Step 3: GET /conviction — Market Data & Scoring

Open `http://<vps-ip>:31777/conviction`. Show:

```json
{
    "regime": {
        "score": 85,
        "label": "DEEP FEAR — PRIME CONTRARIAN",
        "fearGreedIndex": 20,
        "fearLevel": "extreme-fear"
    },
    "marketData": {
        "fearGreedIndex": 20,
        "fearGreedLabel": "Extreme Fear",
        "totalMarketCapUsd": 2.14e12,
        "btcFundingRate": 0.0001,
        "ethFundingRate": 0.0002,
        "tokensTracked": 145
    },
    "anchoring": {
        "hash": "0x95710c98c50b7015e1ea407b25172436275c8e7baa1a05d4f4a81ab51ff9bb74",
        "mode": "on-chain",
        "blockNumber": 40380360,
        "gasUsed": "190156"
    },
    "anchoredUrl": "https://explorer.sepolia.mantle.xyz/tx/0x95710c98..."
}
```

Demonstrates: CMC market data, Fear & Greed (Deep Fear = strongest contrarian regime), 6-factor conviction scoring, Mantle anchoring on every cycle.

#### Step 4: Terminal Output — Full Cycle

Show the agent terminal log demonstrating the complete pipeline:

```
═══════════════════════════════════════
  CYCLE #1 — 2026-06-24T12:35:21.328Z
═══════════════════════════════════════

[1/8] Portfolio: $28.69 across 3 positions

[1/6] Fetching market data from CMC Agent Hub...
  Fear & Greed: 20/100 (Extreme Fear)
  Total Market Cap: $2.15T
  BTC Funding Rate: 0.0041%
  ETH Funding Rate: 0.0022%
  Token prices: 145 tokens tracked

[3/8] Scoring market regime + token conviction (contrarian)...
  Regime: 85/100 — DEEP FEAR — PRIME CONTRARIAN (FGI=20)
  Top conviction: INJ 72 [down 19% (early) · RSI 2 oversold · extreme fear regime · deep liquidity · -0.0% holders]
                   FET 72 [down 15% (early) · RSI 2 oversold · extreme fear regime · deep liquidity · +0.4% holders]

[4/8] Managing open positions...

[5/8] Creating entry proposals...
  Proposals: INJ $5 (score: 72), FET $5 (score: 72)
  [bankroll] BNB=$33.04, tradeable=$28.04, per-trade cap=$14.02 → sized to $5.22

[6/8] Checking risk guardrails... Passed: INJ, FET

[7/8] Executing 2 entries via TWAK...
  → Swapping $5 BNB → INJ (conviction: 72)
    ✓ Trade executed — https://testnet.bscscan.com/tx/0x...
  → Swapping $5 BNB → FET (conviction: 72)
    ✓ Trade executed — https://testnet.bscscan.com/tx/0x...
  2/2 trades succeeded

[8/8] Anchoring conviction record to Mantle ERC-8004 registry...
  Tx hash: 0xec817b92424fca9ead2bbffe1462a3f12709d79f98f032d6c18d04abaf37bc04
  Block:   40380238
  Anchored on-chain ✓

── Cycle #1 Summary ──
  Duration:     112.1s
  Trades:       2 succeeded, 0 failed
  Total volume: $10.00
  Anchoring:    ✓ on-chain
  Portfolio:    $X.XX (drawdown: 0.0%)

Next cycle in 240 minutes (or 480 when BNB < $25 — adaptive)
```

The bankroll line `[bankroll] BNB=$33.04, tradeable=$28.04, per-trade cap=$14.02 → sized to $5.22` is the new bankroll-aware sizer in action — it caps each trade at half the tradeable BNB, leaving the rest in reserve.

### Demo Video

**asciinema replay:** https://asciinema.org/a/lMVdIaBr9G2KK9Ni

Click the link above to watch a terminal replay of the live demo in your browser. Covers:
1. Connecting to the VPS
2. `GET /status` — cycle count, portfolio, guardrails
3. `GET /trades` — 3 live TWAK swaps (SLX, AXS, BSB)
4. `GET /conviction` — Fear & Greed, market data, on-chain anchored thesis hash

Duration: ~30 seconds playback time.

---

## Special Prize Applications

### Best Use of TWAK ($2K)

| Criterion | Evidence |
|-----------|----------|
| **Integration depth** | TWAK is the sole execution layer — swaps, quotes, balance, portfolio, history, registration, health check, compete status, search (token address resolution), liquidity checks |
| **Self-custody** | Agent Wallet Mode (autonomous, pre-configured rules). Agent orchestrates, TWAK signs. Keys never leave the user's device. Full `executeSwap`, `getBalance`, `getPortfolio`, `getHistory` pipeline. |
| **Autonomous execution** | Genuinely hands-off — the agent runs 24/7 on a VPS under PM2, executing cycles every 4 hours without human intervention. Adaptive interval doubles to 8h when BNB < $25 to preserve anchor gas. |
| **Guardrails** | Drawdown cap (25%), token allowlist (147 BEP-20), per-trade limits, concentration limits, slippage protection, **bankroll reserve ($2.5 non-spendable)**, **entry-skip below $4.5 BNB**, **50% per-trade cap on tradeable BNB**, **position cap of 8**, **DexScreener pre-entry liquidity gate** — all enforced before TWAK is called |
| **x402 usage** | CMC data fetched via Pro REST API (API key). x402 integration planned as stretch goal. |
| **Originality** | Conviction-weighted position sizing + bankroll-aware trade caps + harvest/exit fallback ladders are novel uses of TWAK — not just naive swaps. The reconciliation layer treats TWAK's portfolio output as the source of truth against which in-memory conviction state is verified on every restart. |

### Robustness (Real-World Relevance)

A trading agent that crashes on the first reorg, or worse, that holds a permanently-broken position forever because its exit swap reverts, isn't production-grade. We've shipped:

- **PM2 process supervision** — restarts the agent on crash (9 prior restarts over 2 days; current uptime 2h+, status online)
- **Harvest fallback ladder** — handles `execution reverted: 0xf4059071` and similar by routing through USDC intermediate or size-probing for tax tokens
- **Exit fallback ladder** — same shape on stuck exits (5% slippage → USDC pair → alert)
- **Startup reconciliation** — drops 13 ghost positions on the first post-fix restart, freeing the conviction ledger
- **Pre-flight live BNB check** — refuses to start a trade that would breach the gas reserve (avoids burning gas on transactions that TWAK would reject anyway)
- **State persistence** — `state.json` survives PM2 restarts so open positions aren't abandoned

### Best Use of Agent Hub ($2K)

The CMC Agent Hub (via Pro REST API) is the **primary data source** for the entire conviction engine:

- **Global metrics** — Market cap, BTC dominance, volume (via `/v1/global-metrics/quotes/latest`)
- **Fear & Greed** — Behavioral regime context (via `/v3/fear-and-greed/latest`)
- **Funding rates** — BTC and ETH perpetual funding (via `/v5/cryptocurrency/derivatives/market-pairs/list/latest`)
- **Token prices** — 149 eligible BEP-20 tokens priced (via `/v1/cryptocurrency/quotes/latest`)
- **Token ID resolution** — Symbol → CMC ID cache (via `/v1/cryptocurrency/map`)

The integration is non-trivial — it's the foundation of every trading decision, not a cosmetic add-on.

---

## Submission Checklist

- [x] Agent running autonomously on VPS (24/7) under PM2
- [x] TWAK live mode (not simulator)
- [x] CMC REST API connected
- [x] Risk guardrails active and enforced (8 checks)
- [x] Bankroll management (reserve, entry-skip, adaptive interval)
- [x] Harvest + exit fallback ladders
- [x] Startup position reconciliation
- [x] Mantle anchoring per cycle (even when no trades execute)
- [x] Agent wallet registered for competition (`twak compete status` = `registered: true`)
- [x] Adaptive position sizing implemented
- [x] Unit tests (120 passing — resolver, DexScreener gate, on-chain portfolio, guardrails, simulator path)
- [x] Source code on GitHub (thisyearnofear/earlynotwrong)
- [x] Documentation (README, AGENTS.md, SOUL.md, HACKATHON_PLAN.md)
- [x] Demo video recorded (asciinema: https://asciinema.org/a/lMVdIaBr9G2KK9Ni)
- [ ] Submitted on DoraHacks

---

## Links

- **DoraHacks**: https://dorahacks.io/hackathon/bnbhack-twt-cmc/detail
- **GitHub**: https://github.com/thisyearnofear/earlynotwrong
- **Agent wallet**: `0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a` (BSC Testnet)
- **Mantle registry**: `0x81226e8894D334c790D9a972855592E6C4eeB15C`
- **Agent card (Mantle)**: `lens://3d290df5a33aefd485a09d6f5170b8169c198d6ac35a560335fab19e01ca5acf`
