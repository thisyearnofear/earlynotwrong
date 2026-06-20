# BNB Hack: AI Trading Agent Edition — Track 2 Submission

## Project

**Name**: Early, Not Wrong — Conviction-Weighted Trading Agent
**Tagline**: *Being early feels like being wrong. Until it doesn't.*

**Track**: Track 2 — Strategy Skills
**Also targeting**: Best Use of TWAK ($2K), Best Use of Agent Hub ($2K)

---

## Technical Execution

### Architecture

```
CMC Agent Hub ──► Conviction Engine ──► Risk Guardrails ──► TWAK Execution ──► Mantle Anchoring
     (data)           (scoring)              (filters)           (swaps)            (proof)
```

The agent is implemented as a standalone Node.js process running autonomously on a VPS. Each 4-hour cycle:

1. **Portfolio State** — Fetches real BNB balance via TWAK (`0.0416 BNB = $24.47`)
2. **Market Data** — Pulls Fear & Greed Index, funding rates, and token prices from the CMC Pro REST API
3. **Conviction Scoring** — Scores 149 eligible BEP-20 tokens using price momentum (24h/7d), volume signals, and market regime context
4. **Liquidity Screening** — Checks DEX liquidity via TWAK swap quotes for up to 30 tokens, selecting top-3 with real liquidity
5. **Adaptive Position Sizing** — Three safety layers: reduced concentration cap (15%), safety margin (0.9x), and rejection decay (0.8^n)
6. **Risk Guardrails** — 8 checks: trading window, portfolio minimum, drawdown (25% hard stop), token allowlist, per-trade limit ($1K), daily limit (10), concentration (20%), conviction floor (60)
7. **TWAK Execution** — Live swaps via Agent Wallet Mode (self-custody, autonomous signing)
8. **Mantle Anchoring** — Analysis hash, conviction score, and archetype written to ERC-8004 registry

### On-Chain Evidence

| Component | Address / Evidence | Network |
|-----------|-------------------|---------|
| **Agent wallet** | `0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a` | BSC Testnet |
| **Compete registration** | Registered and open | BSC Testnet |
| **TWAK swaps (latest cycle)** | 3/3 succeeded: BNB→SLX $3, BNB→AXS $3, BNB→BSB $3 | BSC Testnet |
| **Mantle registry** | `0x81226e8894D334c790D9a972855592E6C4eeB15C` | Mantle Sepolia |
| **Agent card** | Published to Grove storage (`lens://3d290df5...`) | IPFS |
| **Current portfolio** | $24.47 (pre-trade) → $15.45 (post 3 trades) | BSC Testnet |
| **Total volume** | $9.00 (3 × $3.00) in Cycle #1 | BSC Testnet |

### Key Files

| File | Purpose |
|------|---------|
| `agent/index.ts` | Main loop orchestrator (all 8 steps) |
| `agent/lib/cmc-client.ts` | CMC Pro REST API data ingestion |
| `agent/lib/conviction-engine.ts` | Token conviction scoring engine |
| `agent/lib/twak-executor.ts` | TWAK CLI wrapper with DI for testing |
| `agent/lib/risk-guardrails.ts` | 8 guardrail checks + adaptive sizing feedback |
| `agent/src/server.ts` | HTTP server exposing /status, /trades, /conviction |

---

## Originality

### Why Conviction-Weighted Copy-Trading?

Most trading agents fall into one of three categories:

1. **Signal-based** — Trade on technical indicators (RSI, MACD, etc.). Prone to overfitting and regime changes.
2. **Copy-trading** — Mirror top wallets by volume. Copies noise and wash trading as much as signal.
3. **LLM-prompted** — Ask an LLM "what should I trade?" with no structured risk framework.

Our agent does something different: **it scores conviction as a behavioral metric, not a price prediction.**

### The Conviction Signal

Instead of asking "which token will go up?", the agent asks "which tokens have the strongest behavioral conviction right now?":

- **Momentum scoring** — 24h and 7d price trends weighted by volume
- **Market regime context** — Fear & Greed, funding rates (negative = bullish), positive momentum ratio
- **Liquidity-first** — Only tokens with real DEX liquidity are considered (no ghost markets)
- **Adaptive sizing** — Trade size shrinks automatically after guardrail rejections, converging to a passing amount

### Novel Contributions

1. **Behavioral conviction as a trading signal** — Not price prediction, not volume copying, but conviction scoring
2. **Adaptive position sizing with rejection feedback** — The agent learns from its own guardrail rejections, reducing position size exponentially (0.8^n) until trades pass
3. **Full-stack autonomous loop** — CMC data → scoring → guardrails → TWAK execution → Mantle anchoring, all in one self-contained process
4. **DI-based testing** — TWAK executor uses dependency injection (`execFileOverride`) enabling 24 unit tests without mocking Node.js built-in modules

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
  TWAK:      ✓ (live)
  CMC MCP:   ✓ (connected)
  Wallet:    0xA1Dd482E...888a
  Mode:      LIVE
  Market:    BSC Testnet
```

Demonstrates: TWAK live mode, CMC connected, wallet on-chain.

#### Step 2: GET /status — Agent Status Endpoint

Open a browser or curl to `http://<vps-ip>:31777/status`. Show this response:

```json
{
    "agent": "Early, Not Wrong",
    "version": "0.1.0",
    "hackathon": "BNB Hack: AI Trading Agent Edition",
    "status": "idle",
    "cycle": 1,
    "totalTrades": 3,
    "totalVolumeUsd": 9,
    "portfolio": {
        "totalValueUsd": 15.45,
        "positions": 2
    },
    "guardrails": {
        "tradesToday": 3,
        "dailyLimit": 10,
        "drawdownExceeded": false,
        "allOk": true
    }
}
```

Demonstrates: 3 trades executed, $9 volume, guardrails active.

#### Step 3: GET /trades — Trade History

Open `http://<vps-ip>:31777/trades`. Show:

```json
{
    "totalSessionTrades": 3,
    "totalVolumeUsd": 9,
    "recentTrades": [
        {
            "tokenIn": "BNB",
            "tokenOut": "SLX",
            "amountIn": "3",
            "success": true
        },
        {
            "tokenIn": "BNB",
            "tokenOut": "AXS",
            "amountIn": "3",
            "success": true
        },
        {
            "tokenIn": "BNB",
            "tokenOut": "BSB",
            "amountIn": "3",
            "success": true
        }
    ]
}
```

Demonstrates: All 3 swaps executed successfully via TWAK.

#### Step 4: GET /conviction — Market Data & Scoring

Open `http://<vps-ip>:31777/conviction`. Show:

```json
{
    "marketData": {
        "fearGreedIndex": 21,
        "fearGreedLabel": "Extreme Fear",
        "totalMarketCapUsd": 2.19e12,
        "btcFundingRate": 0.00024,
        "ethFundingRate": 0.0022,
        "tokensTracked": 145
    },
    "portfolio": {
        "totalValueUsd": 15.45,
        "positions": [
            {"symbol": "BNB", "valueUsd": 0.03},
            {"symbol": "USD", "valueUsd": 15.42}
        ]
    },
    "anchoredHash": "0x81c0e2824bba827aa208f1a533118c6a635c3e4d5970525f860489eab7b42440",
    "anchoredUrl": "https://explorer.sepolia.mantle.xyz/tx/0x81c0e2..."
}
```

Demonstrates: CMC market data, Fear & Greed (Extreme Fear = contrarian opportunity), Mantle anchoring.

#### Step 5: Terminal Output — Full Cycle

Show the agent terminal log demonstrating the complete pipeline:

```
CYCLE #1 — 2026-06-20T12:15:38.592Z

[1/6] Fetching market data from CMC Agent Hub...
  Fear & Greed: 21/100 (Extreme Fear)
  Top gainers: SLX +122.4%, AXS +22.8%, EDGE +22.4%

[2/6] Scoring market regime and token conviction...
  Regime score: 31/60 (MODERATE CONVICTION)
  Top conviction tokens: SLX (76), AXS (72), BSB (70)

[3/6] Creating trade proposals...
  Proposals: SLX $3 (76), AXS $3 (72), BSB $3 (70)

[4/6] Checking risk guardrails...
  Passed: SLX, AXS, BSB

[5/6] Executing 3 trades via TWAK...
  → Swapping $3 BNB → SLX  ✓ Trade executed
  → Swapping $3 BNB → AXS  ✓ Trade executed
  → Swapping $3 BNB → BSB  ✓ Trade executed
  3/3 trades succeeded

── Cycle #1 Summary ──
  Trades:       3 succeeded, 0 failed
  Total volume: $9.00
  Portfolio:    $24.47 (drawdown: 0.0%)
```

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
| **Integration depth** | TWAK is the sole execution layer — swaps, quotes, balance, portfolio, history, registration, health check |
| **Self-custody** | Agent Wallet Mode (autonomous, pre-configured rules). Agent orchestrates, TWAK signs. Keys never leave the user's device. Full `executeSwap`, `getBalance`, `getPortfolio`, `getHistory` pipeline. |
| **Autonomous execution** | Genuinely hands-off — the agent runs 24/7 on a VPS with tmux, executing cycles every 4 hours without human intervention |
| **Guardrails** | Drawdown cap (25%), token allowlist, per-trade limits, concentration limits, slippage protection — all enforced before TWAK is called |
| **x402 usage** | CMC data fetched via Pro REST API (API key) — x402 integration planned as stretch goal |
| **Originality** | Conviction-weighted position sizing is a novel use of TWAK — not just naive swaps |

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

- [x] Agent running autonomously on VPS (24/7)
- [x] TWAK live mode (not simulator)
- [x] CMC REST API connected
- [x] Risk guardrails active and enforced
- [x] Mantle anchoring per cycle
- [x] Agent wallet registered for competition
- [x] Adaptive position sizing implemented
- [x] Unit tests (64 passing)
- [x] Source code on GitHub (thisyearnofear/earlynotwrong)
- [x] Documentation (README, SOUL.md, HACKATHON_PLAN.md)
- [x] Demo video recorded (asciinema: https://asciinema.org/a/lMVdIaBr9G2KK9Ni)
- [ ] Submitted on DoraHacks

---

## Links

- **DoraHacks**: https://dorahacks.io/hackathon/bnbhack-twt-cmc/detail
- **GitHub**: https://github.com/thisyearnofear/earlynotwrong
- **Agent wallet**: `0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a` (BSC Testnet)
- **Mantle registry**: `0x81226e8894D334c790D9a972855592E6C4eeB15C`
- **Agent card (Mantle)**: `lens://3d290df5a33aefd485a09d6f5170b8169c198d6ac35a560335fab19e01ca5acf`
