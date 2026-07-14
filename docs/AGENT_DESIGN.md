# Agent Design — Conviction-Native BSC Trading

> *Being early feels like being wrong. Until it doesn't.*

This document covers the autonomous BSC trading agent at the core of Early, Not Wrong — its architecture, the 6-factor conviction signal, bankroll discipline, scam-token defenses, and how each piece maps to source files. For the Solana / Casper / Aleo / Mantle layers built on top, see the per-integration docs.

## Architecture

```
CMC Agent Hub ──► Conviction Engine ──► Bankroll-Aware Sizer ──► TWAK Execution ──► Mantle + Casper Anchoring
     (data)           (scoring)              (filters)           (swaps)            (proof)
                                          │
                              DexScreener │ Honeypot/illiquid pair screen
                              SoSoValue   │ News + macro + SSI regime overlay
                              NodeReal    │ On-chain holder counts
```

The agent is implemented as a standalone Node.js process running autonomously on a VPS (self-hosted, not Pinata). Each 4-hour cycle:

1. **Portfolio State** — Fetches real BNB balance via TWAK (`bsc (BNB) Total: 0.0156 BNB ≈ $9.03`, plus 0.65 USDC and held tokens)
2. **Market Data** — Pulls Fear & Greed Index, funding rates, and token prices from the CMC Pro REST API
3. **Conviction Scoring** — Scores ~147 eligible BEP-20 tokens using a 6-factor signal (contrarian + RSI timing + quality + regime + holder growth − volatility penalty). SoSoValue overlays SSI indices, news sentiment, and macro events.
4. **Liquidity & Honeypot Screening** — DexScreener pool depth + 24h volume gate; TWAK quote-only sell check; for thin-liquidity tokens (< $20k pool) a real buy/sell execution probe verifies the route is swappable before committing capital.
5. **Bankroll-Aware Sizing** — Per-trade cap = `min(portfolio × 15%, (BNB − $2.5 reserve) × 50%)`. Entries skipped entirely when BNB < $4.5. Loop interval doubles to 8h when BNB is low to preserve gas.
6. **Risk Guardrails** — 8 checks: trading window, portfolio minimum, drawdown (25% hard stop), token allowlist, per-trade limit ($1K), daily limit (6), concentration (20%), conviction floor (58)
7. **TWAK Execution** — Live swaps via Agent Wallet Mode (self-custody, autonomous signing). Pre-flight rechecks live BNB and refuses if the trade would breach the reserve. Exit/harvest fallback ladder: default → 10% → 20% → 49% slippage → USDC pair → size probe.
8. **Dual-Chain Anchoring** — Analysis hash, conviction score, and archetype written to Mantle ERC-8004 registry and Casper ConvictionRegistry. Casper anchors are gated by operator balance and skip unchanged theses.

## Position Management ("The Soul")

The agent embodies "Early, Not Wrong" through four exit tiers:
- **HOLD** through ordinary drawdown (the default — patience is the strategy)
- **EXIT_PARTIAL** at +50% *current* gain (not peak — a spike that faded doesn't trigger a sale) — sell 33%, let the rest ride (capital recycling)
- **EXIT_STOP** at −35% — thesis invalidated, cap the loss
- **EXIT_TRAIL** at +100% peak → 30% give-back — lock the asymmetry

When an exit or harvest swap reverts on a thin pool, an **exit/harvest fallback ladder** runs: primary swap at default slippage → 10% → 20% → 49% slippage → USDC route → tiny size probe. If every path fails, the position is marked **stuck** and its symbol is added to a blocklist so the agent stops wasting gas and stops re-entering. Stuck positions are kept in the ledger for accounting but excluded from the active position cap.

For new entries, quote-only checks are followed by a real **buy/sell execution probe** on thin-liquidity tokens (< $20k DexScreener pool). The probe buys a small amount and immediately sells it back; if the sell leg reverts or the round-trip loss is too high, the token is rejected and blocklisted.

## Bankroll Discipline

BNB is both the gas asset and the trade-value asset. A single careless trade can drain the wallet and starve the agent. `AGENT_CONFIG.trading.bankroll` enforces:
- $2.5 non-spendable reserve (gas + emergency exit)
- 50% per-trade cap on tradeable BNB (one trade can never consume more than half)
- Entry-skip below $4.5 BNB (focus cycles on harvest)
- Harvest floor $6 — *above* the entry-skip so harvest fires whenever entries are blocked (no BNB dead zone)
- Position cap of 8 — proactive harvest when over cap, picking the smallest mature position so the strong ones survive
- Adaptive interval: 4h normally, slows when BNB target unmet

Combined with the harvest ladder + 95% sizing, the agent is **self-funding** — verified live with a clean MYX → BNB harvest after the resolver/sizing fixes.

## Startup Reconciliation

On every restart, `restoreSnapshot()` cross-checks `state.heldPositions` against the **live on-chain balances** (`balanceOf` via NodeReal RPC) and drops ghost positions only when the chain confirms zero. Earlier we relied on `twak wallet portfolio`, which only reports native + USDC and *not* BEP-20 holdings — so legitimate positions were being silently wiped as "ghosts" on every restart. The new reader (`agent/lib/onchain-portfolio.ts`) verifies real balances and prices each holding **by contract** (CoinGecko → DexScreener; never CMC-by-symbol, which once valued a fake "ETH" lookalike at real ETH's $1,567 and corrupted the drawdown peak).

## Defense-in-Depth Against Fake Tokens

A scam-lookalike resolution bug had been silently mis-routing entries (e.g. `twak search INJ` returning KaiChain because its CMC logo URL outranked the real Injective listing). A live wallet audit found four illiquid honeypot positions — KAI ($37.95 paper value, $951 DEX pool, $0 24h volume, swap reverts with `SafeMath: subtraction overflow`), plus NXPC, KITE, CYS. Defense now stacks six layers:

| Layer | Where | Catches |
|-------|-------|---------|
| **1. Exact symbol + reference-price gate** | `selectBestTokenMatch` in `lib/twak-executor.ts` | INJ → KaiChain, ETH → 0x000008D2… (fake at $0.00001 vs ref $1500) |
| **2. DexScreener pool depth** | `checkLiquidity` (new gate) | Pools < $5k, 24h volume < $100 |
| **3. TWAK quote-only check** | existing | Router can't route it at all |
| **4. 95% harvest sizing** | `harvestForBnb` in `index.ts` | `ExceedsBalance (0xf4059071)` reverts on 100%-of-balance swaps |
| **5. Position cap (8)** | `AGENT_CONFIG.trading.maxOpenPositions` | Sub-$5 dust accumulating beyond a manageable count |
| **6. Wallet audit + prune** | `agent/scripts/audit-holdings.mjs --prune` | Honeypots already in the wallet from pre-fix days |

The first three gates fire **before** any BNB is committed; the bottom three keep the existing portfolio clean. See [`agent/lib/solana-safety.ts`](../agent/lib/solana-safety.ts) for the Solana port of the same composition.

## On-Chain Evidence

| Component | Address / Evidence | Network |
|-----------|-------------------|---------|
| **Agent wallet** | `0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a` | BSC Mainnet |
| **TWAK swaps** | Live entries (INJ, FET, RAVE, AXS, BSB, …) + harvest trades (MYX → BNB) | BSC Mainnet |
| **Mantle registry** | `0x81226e8894D334c790D9a972855592E6C4eeB15C` (anchored every cycle, even when no trades execute) | Mantle Sepolia |
| **Agent card** | Published to Grove storage (`lens://3d290df5...`) | IPFS |

## Key Files

| File | Purpose |
|------|---------|
| `agent/index.ts` | Main loop orchestrator (all 8 steps + bankroll + reconciliation) |
| `agent/lib/config.ts` | `AGENT_CONFIG.trading.bankroll` block (reserve, entry-skip, max-trade-fraction, adaptive interval) |
| `agent/lib/data-providers.ts` | CMC + SoSoValue market data |
| `agent/lib/conviction-signal.ts` | 6-factor token conviction scoring engine (pure functions) |
| `agent/lib/twak-executor.ts` | TWAK CLI wrapper with DI for testing; `selectBestTokenMatch` (exact-symbol + reference-price gate) + DexScreener pool-depth gate; column-aware portfolio parser |
| `agent/lib/solana-safety.ts` | Same four-gate composition ported to Solana (Jupiter v2 search + Pyth/Birdeye + DexScreener + Jupiter swap v1) — vendored from [solana-safe-trade-skill](https://github.com/thisyearnofear/solana-safe-trade-skill) |
| `agent/lib/onchain-portfolio.ts` | `balanceOf`-based on-chain reader with layered pricing (CoinGecko → DexScreener, contract-only) — single source of truth for portfolio value across loop + API + guardrails |
| `agent/lib/risk-guardrails.ts` | 8 guardrail checks; peak seeded only at end of cycle (no phantom drawdowns) |
| `agent/src/server.ts` | Hono HTTP server exposing `/status`, `/trades`, `/conviction` on port 31777 — uses the same augmented portfolio as the cycle |
| `agent/scripts/scan-holdings.mjs` | Discovers every BEP-20 the wallet holds via ERC-20 Transfer log scan; classifies each as bought-by-agent vs airdrop spam by transfer initiator |
| `agent/scripts/recover-positions.mjs` | Re-adopts legit on-chain bought tokens into `state.json` (`--apply`); excludes airdrops and illiquid paper-pumps |
| `agent/scripts/audit-holdings.mjs` | DexScreener-backed liquidity/legitimacy audit of held positions; `--prune` mode removes illiquid + no-pair entries from the ledger |
| `agent/lib/self-analysis.ts` | Records every entry/exit in a canonical ledger and scores the agent's own behavior via `packages/conviction-core` |
| `packages/conviction-core` | Shared pure domain model used by both agent and web: ledger types, behavioral scoring, patience-tax math, and keccak256 hashing |

## Design Decisions

### Conviction-Weighted Direct Execution

Most trading agents fall into one of three categories: signal-based (RSI/MACD, prone to overfit), copy-trading (mirrors noise + wash trades as much as signal), or LLM-prompted (no structured risk framework). This agent does something different: it scores conviction as a behavioral metric, not a price prediction, and trades directly into tokens exhibiting strong behavioral signals — not into whatever top wallets happen to be moving.

### The 6-Factor Conviction Signal

The question is "which tokens have the strongest behavioral conviction right now?", not "which will go up?":

- **Contrarian (30)** — Rewards assets down 7d during fear (the "early, not wrong" thesis literalized)
- **RSI timing (10)** — Real RSI(14) from SoSoValue daily klines for top candidates; when klines are unavailable it falls back to a synthesis from the 7d return at **half weight**, since that fallback is not independent of the contrarian factor
- **Quality (15)** — Market cap × liquidity filter (capped downside, room to run)
- **Regime (20)** — Fear & Greed + funding rate composite (entering when market is fearful)
- **Holder growth (10)** — On-chain holder base expansion via NodeReal JSON-RPC + CoinGecko fallback ("smart money accumulating")
- **Volatility penalty** — Subtracted for *erratic* paths: measures how far the 24h move deviates from the smooth 7d trend (`|24h − 7d/7|`), so a clean decline is not penalized but a falling knife that's bouncing is

### Self-Funding Harvest Ladder

When BNB drops, the agent sells its weakest held position (≥8 cycles old) back into BNB. If the direct swap reverts (thin pool, tax token, or `execution reverted: 0xf4059071`), it falls back to a USDC intermediate, then to a size probe to diagnose tax tokens, and finally to a Telegram alert + 5-cycle cooldown. Same fallback shape on the exit ladder.

## Links

- **GitHub**: https://github.com/thisyearnofear/earlynotwrong
- **Agent wallet** (BSC Mainnet): `0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a`
- **Mantle registry** (Sepolia): `0x81226e8894D334c790D9a972855592E6C4eeB15C`
- **Agent card** (Grove storage): `lens://3d290df5a33aefd485a09d6f5170b8169c198d6ac35a560335fab19e01ca5acf`
