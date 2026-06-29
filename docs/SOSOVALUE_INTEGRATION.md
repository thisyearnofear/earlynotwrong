# SoSoValue Buildathon — Integration Architecture

> **Project**: Early, Not Wrong — Conviction-Native Trading Agent
> **Wave**: 3 (Build Phase II, Jun 29 – Jul 8, 2026)
> **Deadline**: Jul 8, 2026

## Overview

The **Early, Not Wrong** trading agent was enhanced across three phases for the
SoSoValue Buildathon. All additions are **additive by design** — existing CMC
data and TWAK execution continue working independently when the new components
are not configured.

### What Was Built

| Phase | Component | What It Does | Required | Lines |
|-------|-----------|-------------|----------|-------|
| 1 | SoSoValue API Client | Token market snapshots (30s refresh), SSI indices, klines, news feeds, macro events | ✅ Required | ~420 |
| 2 | SoDEX Execution Adapter | EIP-712 signed market orders on ValueChain testnet; nonce management | ⭐ Bonus | ~550 |
| 3 | AI Market Narrative | Template + optional LLM market commentary from SoSoValue feeds + conviction data | ⭐ Bonus | ~290 |

### Architecture Diagram

```
                     ┌──────────────────────────────────────┐
                     │           TRADING CYCLE              │
                     │  (1) Portfolio → (2) Data → (3→8)    │
                     │  Score → Manage → Propose → Guardrail │
                     │  → Execute → Anchor → Narrative       │
                     └──────┬───────────┬───────────┬───────┘
                            │           │           │
               ┌────────────▼───┐  ┌────▼────┐  ┌───▼────────────┐
               │  Data Sources  │  │ Venues  │  │ Outputs        │
               │                │  │         │  │                │
               │ SoSoValue API  │  │ SoDEX   │  │ Mantle anchor  │
               │  (preferred)   │  │ testnet │  │ Casper anchor  │
               │                │  │ (order  │  │ Market         │
               │ CMC MCP        │  │  book)  │  │ narrative      │
               │  (fallback +   │  │         │  │ Telegram       │
               │   regime data) │  │ TWAK    │  │ HTTP server    │
               │                │  │ (AMM    │  │  (/conviction) │
               │ SoSoValue      │  │  swap)  │  │                │
               │  Feeds + Macro │  │         │  │ Dashboard      │
               └────────────────┘  └─────────┘  └────────────────┘
```

---

## Phase 1 — SoSoValue API Client (`agent/lib/sosovalue-client.ts`)

### Data Sources

| SoSoValue Endpoint | Purpose | Used For |
|--------------------|---------|----------|
| `GET /currencies` | All listed currency IDs | Token resolution cache |
| `GET /currencies/{id}/market-snapshot` | Price, 24h/7d change, volume, mcap | Token pricing (30s refresh) |
| `GET /currencies/{id}/klines` | OHLCV history | Real RSI(14) calculation |
| `GET /currencies/{id}/pairs` | Trading pairs | Liquidity / quality signal |
| `GET /indices` | SSI index list | Index availability |
| `GET /indices/{ticker}/market-snapshot` | Index level + change | Regime proxy |
| `GET /indices/{ticker}/constituents` | Constituent tokens + weights | Quality signal |
| `GET /news/hot` | Trending news | Market narrative |
| `GET /news/featured` | Curated news | Market narrative |
| `GET /macro/events` | Macroeconomic events | Regime context |

### How Conviction Factors Are Enhanced

| Factor | Before (CMC only) | After (SoSoValue + CMC composite) |
|--------|-------------------|-----------------------------------|
| **Contrarian** (30 pts) | CMC 7d return | `/market-snapshot` 7d change — same signal, fresher data |
| **RSI timing** (10 pts) | Synthesized from 7d return | `/klines` → real RSI(14) calculation |
| **Quality** (20 pts) | CMC market cap + volume | `/market-snapshot` mcap/volume + **SSI index membership** as quality signal |
| **Regime** (20 pts) | CMC Fear & Greed + funding | `/indices` market snapshot as regime proxy + macro events |
| **Holders** (10 pts) | NodeReal + CoinGecko | Unchanged (SoSoValue doesn't offer holder data) |
| **Volatility penalty** | CMC 7d vs 24h divergence | Same — from klines data |
| **NEW: Narrative** | None | `/news/hot` + `/news/featured` + `/macro/events` → market commentary |

### Composite Data Provider Pattern

In `agent/index.ts`, the `fetchMarketData()` function runs SoSoValue and CMC
in parallel and merges results:

```typescript
const [ssvData, cmcData] = await Promise.all([
  sosovalueClient.fetchMarketData(),  // Token prices (preferred)
  cmcClient.fetchMarketData(),        // Fills gaps + regime data
]);
```

- **SoSoValue token prices** are preferred (30s refresh vs CMC's minutes-old data)
- **CMC fills missing tokens** — any token not in SoSoValue's universe still gets priced
- **CMC provides regime data** (Fear & Greed, funding rates) — SoSoValue doesn't offer these
- **Graceful degradation** — when SoSoValue is offline, the agent runs on CMC only

### Startup Health Check

The startup banner now checks all three services:

```
  TWAK:        ✓ (live)
  CMC REST:    ✓ (connected)
  SoSoValue:   ✓ (connected)  or  ○ (offline — CMC fallback only)
```

### Env Vars

| Variable | Required | Description |
|----------|----------|-------------|
| `SOSOVALUE_API_KEY` | Yes | SoSoValue OpenAPI key (register at https://openapi.sosovalue.com) |

---

## Phase 2 — SoDEX Testnet Execution Adapter

### Architecture

```
Agent decides to enter a position
  │
  ├── 1. Try SoDEX testnet (if SODEX_API_KEY_PRIVATE set)
  │     └── placeMarketBuy(TOKENUSDC, amount)
  │           ├── Generate clOrdID (enw-{side}-{ts}-{rand})
  │           ├── Build EIP-712 payload (Go struct field order)
  │           ├── Compute payloadHash = keccak256(JSON.stringify(payload))
  │           ├── Sign ExchangeAction{payloadHash, nonce} with API key
  │           ├── Prepend 0x01 to signature → typed signature
  │           └── POST /order with X-API-Key + X-API-Sign headers
  │
  └── 2. Fall back to TWAK (BSC AMM swap)
        └── executeSwap(BNB → TOKEN) — same as before
```

### EIP-712 Signing (`agent/lib/sodex-signer.ts`)

#### Domain

```typescript
const SODEX_SPOT_DOMAIN = {
  name: "spot",
  chainId: 138565,                          // ValueChain testnet
  verifyingContract: "0x0000...0000",        // Zero address (per SoDEX spec)
};
```

#### Types

```typescript
const EXCHANGE_ACTION_TYPE = [
  { name: "payloadHash", type: "bytes32" },
  { name: "nonce",       type: "uint64" },
];
```

#### Signing Flow

1. **Build payload** — market buy/sell order with fields in Go struct order
   (critical: mismatched field order = signature verification failure)
2. **Compute hash** — `keccak256(JSON.stringify(payload))` (compact JSON)
3. **Sign** — EIP-712 `signTypedData` with the API key's private key
4. **Prefix** — prepend `0x01` byte to the 65-byte signature
5. **Submit** — POST to `{baseUrl}/order` with `X-API-Key: {name}`,
   `X-API-Sign: {typedSignature}`, body: `JSON.stringify(payload)`

#### Payload Field Order (Go struct critical)

```typescript
// Market BUY — Must match Go struct ordering exactly
{
  type: "newOrder",
  clOrdID: "enw-buy-abc123-def",               // Unique client order ID
  symbol: "TOKENUSDC",                          // Trading pair
  side: "BUY",
  orderType: "MARKET",
  timeInForce: "IMMEDIATE_OR_CANCEL",
  price: "0",                                   // Market order → zero
  quantity: "0",                                // Market buy → determined by funds
  funds: "10.00",                               // Quote currency to spend
}
```

#### Nonce Management (`agent/lib/sodex-signer.ts` — `SodexNonceManager`)

- SoDEX tracks the 100 highest nonces per signing address
- Every new transaction must use a larger nonce than the smallest in this set
- Must be within (T - 2 days, T + 1 day) of block timestamp
- **Strategy**: Unix timestamp in ms (monotonic) → collision-safe within same ms

### REST Client (`agent/lib/sodex-client.ts`)

| Method | Endpoint | Returns |
|--------|----------|---------|
| `placeMarketBuy(symbol, quoteQty)` | `POST /order` | `OrderResult` |
| `placeMarketSell(symbol, baseQty)` | `POST /order` | `OrderResult` |
| `cancelOrder(clOrdID, symbol)` | `DELETE /order/cancel` | `boolean` |
| `getAccountId()` | `GET /user/{address}` | `string \| null` |
| `getBalances()` | `GET /account/{id}/balance` | `BalanceEntry[]` |
| `getUsdcBalance()` | → `getBalances()` → filter USDC | `number` |
| `healthCheck()` | `GET /exchange/symbols` | `boolean` |

#### Testnet Endpoints

| Resource | URL |
|----------|-----|
| REST base | `https://testnet-gw.sodex.dev/api/v1/spot` |
| Order placement | `POST /order` |
| Account info | `GET /user/{address}` |
| Balances | `GET /account/{id}/balance` |
| Exchange symbols | `GET /exchange/symbols` |

### Env Vars

| Variable | Required | Description |
|----------|----------|-------------|
| `SODEX_API_KEY_PRIVATE` | For SoDEX | EIP-712 private key (0x-prefixed hex, 32 bytes) |
| `SODEX_API_KEY_NAME` | Optional | API key name sent in X-API-Key header (default: "enw-agent") |
| `SODEX_BASE_URL` | Optional | Override testnet base URL (default: testnet-gw) |

### Fallback Behavior

When SoDEX is not configured or returns an error for any reason:

1. Log: `○ [SoDEX] Failed: {reason} — falling back to TWAK`
2. Execute via TWAK: `executeSwap(BNB → TOKEN)` as before
3. Continue with the rest of the cycle — no interruption

This means the agent can be deployed with or without SoDEX credentials
and still function identically from the user's perspective.

---

## Phase 3 — AI Market Narrative Generator (`agent/lib/market-narrative.ts`)

### Two Modes

#### Template Mode (Default — No API Key Required)

Produces structured 2-4 sentence market commentary from:

| Input | Source | Example Output |
|-------|--------|----------------|
| Market regime | Conviction engine | "Market regime: deep fear (FGI 32/100). Contrarian opportunity scores 85/100 — favorable entry conditions." |
| Top signals | Conviction engine | "Top conviction: INJ scores 76/100 (down 18%, strong contrarian opportunity). Also watching: FET (62/100)." |
| Hot news | SoSoValue `/news/hot` | "Headline: 'Bitcoin drops below $60k' [CoinDesk]" |
| Macro events | SoSoValue `/macro/events` | "Upcoming: 🔴 FOMC Minutes (forecast: 5.25%) · 🟡 CPI Data." |
| Portfolio | Agent state | "Portfolio: $245.12 across 3 held position(s)." |

#### LLM-Enhanced Mode (Optional — Needs API Key)

When `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set:

- **OpenAI**: GPT-4o-mini, 300 tokens, 0.7 temperature
- **Anthropic**: Claude 3 Haiku, 300 tokens
- Both: 15s timeout, graceful fallback to template mode on error

The prompt feeds regime, conviction signals, news items, and macro events
as structured context and asks the LLM to write a natural, insight-driven
narrative.

### Data Flow

```
After anchoring (step 8/8):
  generateAndStoreNarrative()
    → fetchNewsHeadlines()      # /news/hot + /news/featured, dedup'd
    → fetchMacroEvents()        # today + tomorrow, high/medium impact
    → composeSummary()          # 2-4 sentence template narrative
    → state.narrative = { summary, headline, newsCount, macroEventCount }
    → surfaces in /conviction HTTP endpoint
```

### Narrative Surface Points

| Surface | Format | When |
|---------|--------|------|
| Console | `[8b/8] Summary: ...` | Every cycle |
| `/conviction` endpoint | `{ narrative: { summary, headline, ... } }` | HTTP GET |
| Dashboard | Narrative card with headline + summary + source attribution | Every cycle (live) |
| Telegram | Headline + news/macro counts in cycle summary | Every cycle (live) |

---

## Integration Points

### Data Flow Through the Trading Cycle

```
Cycle Step                          SoSoValue Contribution
──────────────────────────────────────────────────────────────────
[1/8]  Portfolio                    —
[2/8]  Market data                  Token snapshots (30s refresh)
                                     SSI index levels (regime proxy)
[3/8]  Conviction scoring           RSI(14) from klines
                                     Index membership (quality boost)
[4/8]  Position management          —
[4b/8] Harvest                      —
[5/8]  Entry proposals              —
[6/8]  Guardrails                   —
[7/8]  Execution via SoDEX/TWAK     SoDEX market orders on ValueChain
[8/8]  Anchoring                    —
[8b/8] Market narrative             News feeds + macro events
```

### Execution Routing

```
For each trade proposal:
  if SODEX_API_KEY_PRIVATE is set:
    try SoDEX testnet market order (TOKENUSDC pair)
      success → record as SoDEX trade, skip TWAK
      failure → log + fall through to TWAK
  execute via TWAK AMM swap (BNB → TOKEN, same as before)
```

### Graceful Degradation Matrix

| Component Unavailable | Impact | Recovery |
|-----------------------|--------|----------|
| SoSoValue API | CMC fills all token prices | CMC-only mode |
| CMC API | SoSoValue fills token prices, regime data neutral | SoSoValue-only mode |
| Both APIs | Neutral scores, no entries | Degraded operation |
| SoDEX | TWAK execution only | TWAK-only mode |
| Both venues | No entries, anchoring only | Observation mode |
| LLM API | Template mode narrative | No user-visible degradation |

---

## Key Files

| File | Purpose |
|------|---------|
| `agent/lib/sosovalue-client.ts` | SoSoValue REST API client (MarketDataProvider impl) |
| `agent/lib/sodex-signer.ts` | EIP-712 signing + nonce management for SoDEX |
| `agent/lib/sodex-client.ts` | SoDEX testnet REST client (order placement, balance) |
| `agent/lib/market-narrative.ts` | Template + LLM market narrative generator |
| `agent/lib/config.ts` | SoSoValue/SoDEX config blocks |
| `agent/lib/types.ts` | MarketDataProvider.name union updated |
| `agent/index.ts` | Composite data provider, SoDEX-first execution, narrative integration |
| `agent/src/server.ts` | /conviction endpoint surfaces narrative |
| `agent/.env.example` | All new env vars documented |

---

## Submission Notes

### What the Judges Will See

1. **SoSoValue API integration** (Required, 15%) — `/currencies` snapshots for
   token pricing, `/indices` for SSI regime signals, `/news` + `/macro` for
   narrative. Composite provider blends SoSoValue and CMC data seamlessly.

2. **SoDEX API integration** (Bonus) — EIP-712 signed market orders on
   ValueChain testnet. Full nonce management, typed signatures, fallback ladder.

3. **AI-enhanced functionality** (Bonus) — Market narrative generator produces
   natural-language commentary from SoSoValue feeds. Template mode works with
   zero API keys; LLM mode activates when available.

4. **Signal-to-execution flow** (Bonus) — Complete end-to-end: SoSoValue data
   → conviction scoring → guardrails → SoDEX execution → anchoring → narrative.

5. **Risk control** (Bonus) — Bankroll management, drawdown limits, position
   concentration, entry guardrails — all enforced before any venue is called.

6. **Product experience** (Bonus) — Dashboard, Telegram, HTTP endpoints,
   terminal logging with source indicators.

### Reproducibility

```bash
# Clone & install
git clone https://github.com/thisyearnofear/earlynotwrong
cd earlynotwrong && npm install && cd agent && npm install && cd ..

# Run with SoSoValue integration (simulator mode)
SOSOVALUE_API_KEY=your_key AGENT_MODE=simulator npm run --prefix agent dev

# Run with SoDEX too
SOSOVALUE_API_KEY=your_key SODEX_API_KEY_PRIVATE=0x... AGENT_MODE=simulator npm run --prefix agent dev
```
