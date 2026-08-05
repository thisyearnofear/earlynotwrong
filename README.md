# EARLY, NOT WRONG

> Agent reputation marketplace, natively on Casper.
> Autonomous conviction, on-chain proof, MCP-queriable reputation, x402 micropayments.

AI agents are about to trade, lend, and govern on-chain. But **no agent can
trust another agent's self-reported track record**. Early, Not Wrong fixes
this: an autonomous DeFi agent that makes conviction-based trading decisions,
anchors every thesis to a **Casper Odra smart contract** as an immutable
on-chain record, and exposes that record to other agents via **Model Context
Protocol** with **x402 CEP-18 micropayments**. Trust queries are free; the
live tradeable data is paid per call.

**Casper is the trust layer for the agent economy.** This project uses the
full Casper AI Toolkit: Odra smart contracts, MCP server, x402 facilitator,
CSPR.cloud RPC, casper-js-sdk, and the Casper Wallet browser extension.

```
Autonomous BSC Trading Agent          Casper Reputation Marketplace
┌──────────────────────────┐          ┌───────────────────────────────────┐
│ 7-factor conviction      │          │  ConvictionRegistry (Odra/Rust)   │
│ 6 deterministic + LLM    │──anchor──►│  • subject_hash → history          │
│ jury (±15 adjustment)    │  thesis  │  • thesis_hash → point lookup       │
│                          │  + score │  • CES events (free reads)         │
│ Risk guardrails          │          │                                    │
│ TWAK / SoDEX execution   │          │  MCP Server (6 tools)              │
└──────────┬───────────────┘          │  • Free: reputation, latest, by    │
           │                          │    thesis, jury deliberation        │
           ▼                          │  • Paid: history, cross-chain,      │
┌──────────────────────────┐          │    live signals (x402)              │
│  Mantle ERC-8004 mirror   │          │                                    │
│  Aleo ZK privacy proof    │          │  x402 Paywall (CSPR.cloud)         │
└──────────────────────────┘          │  • CEP-18 per-request payment       │
                                      │  • Facilitator pays gas            │
OTHER AGENTS ──MCP query──► ─free──► │  • CROO CAP (USDC/Base) second rail │
(yield bots,              ──paid──►  └───────────────────────────────────┘
 wallets, oracles)
```

The agent is a **bidirectional MCP participant**: it exposes 6 tools for
other agents to query its reputation, and it consumes 2 Casper ecosystem
MCP servers (CSPR.trade DEX prices + Casper blockchain status) as
cross-chain context for its LLM conviction jury.

The companion Next.js dashboard surfaces the live agent's state, conviction
signals, dual-chain anchors, and (separately) lets users analyze their own
Solana / Base wallet history through the same conviction lens with optional
ZK-private reputation.

A second data pipeline runs alongside CMC: **SoSoValue API** for token
snapshots, SSI indices, news feeds, and macro events; **SoDEX** as a testnet
orderbook execution venue alongside TWAK; and an **AI market narrative
generator** that produces natural-language commentary from SoSoValue's feeds
and the conviction state.

```
SoSoValue API ──┬── Token snapshots ──► Price / RSI / Quality (30s refresh)
                ├── SSI Indices ──────► Regime confirmation (BTCSSI/ETHSSI 7d Δ
                │                       reweights FGI + funding)
                ├── News feeds ───────► (a) Market narrative + (b) per-symbol
                │                       sentiment → ±10pp conviction
                └── Macro events ────► Trade-size pause (high-impact <12h:
                                          halve size; <4h: skip entries)
                       │
                  ┌────▼────┐
                  │         │
CMC MCP ─────────►  Conviction Engine  ◄──── On-Chain Holder Growth
                  │         │
                  └────┬────┘
                       │
                  SoDEX (testnet) │ TWAK (BSC)
                  (orderbook,     │ (AMM swap,
                   ValueChain)    │  universal fallback)
                       │
                  ┌────▼────┐
                  │         │
                  │ Anchor  │──► Mantle (ERC-8004)
                  │ Layer   │──► Casper (Odra)
                  │         │
                  └─────────┘
```

## Live

> **Casper Agentic Buildathon 2026 — Final Round submission.**
> Agent reputation marketplace, natively on Casper: Odra contract, MCP server, x402 paywall. Full narrative in [`SUBMISSION.md`](./SUBMISSION.md).

### Casper AI Toolkit Usage

| Toolkit Component | Status | How We Use It |
|---|---|---|
| **Odra Framework** | Deployed | `ConvictionRegistry` smart contract in Rust, deployed on Casper Testnet |
| **MCP Servers** | Live | Agent exposes 6 tools at `POST /mcp` (Streamable HTTP) + consumes 2 Casper ecosystem MCP servers (CSPR.trade + blockchain) |
| **x402 Micropayments** | Live | HTTP-native paywall: paid tools return `PaymentRequirements`, clients pay via CEP-18 transfer, CSPR.cloud facilitator settles |
| **CSPR.cloud APIs** | Live | RPC for contract reads/writes, `state_get_dictionary_item` for free CES event reads |
| **casper-js-sdk** | Live | `ContractCallBuilder` for anchor writes, `SessionBuilder` for deploys |
| **Casper Wallet (browser ext.)** | Live | In-browser wallet connect + sign proof + user-initiated anchoring |

### Live Links

- **Landing page** — https://earlynotwrong.vercel.app/
- **Agent dashboard** — https://earlynotwrong.vercel.app/agent
- **Casper contract** — [testnet.cspr.live](https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa)
- **MCP endpoint** — `POST http://144.202.117.160:31777/mcp` (6 tools; trust-decision queries free, live signals x402-paid)
- **Agent API** — `GET http://144.202.117.160:31777/status`
- **CROO Agent Store** — [agent.croo.network](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205) (`signals-live`, $0.05 USDC)
- **GitHub** — https://github.com/thisyearnofear/earlynotwrong

### One-Curl x402 Challenge (live, no setup)

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_live_signals","arguments":{}}}'
```

Returns a live Casper `PaymentRequirements` object (0.5 CSPR via CEP-18). See [`docs/CASPER_INTEGRATION.md`](./docs/CASPER_INTEGRATION.md) for the full reproduction guide.

### One-curl edge report (does the signal have edge?)

```bash
curl -sS http://144.202.117.160:31777/edge-report | jq '.verdict, .hasEdge, .edge'
```

Returns the conviction strategy vs naive-baseline head-to-head: Sharpe/return/drawdown deltas and factor attribution of winning exits. Or run it locally with `npm run edge-report` (prints a formatted table).

### Dual-chain anchor verification

- **Casper Testnet** — [contract package](https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa)
- **Mantle Sepolia** — [ERC-8004 registry](https://explorer.sepolia.mantle.xyz/address/0x81226e8894D334c790D9a972855592E6C4eeB15C)

## Quick Start

```bash
# Install
npm install
cd agent && npm install && cd ..

# Web app (Next.js dashboard)
npm run dev

# Agent — simulator mode (no credentials needed)
AGENT_MODE=simulator npm run --prefix agent dev

# Agent — live mode (see agent/.env.example for the full env)
cp agent/.env.example agent/.env   # fill in values
npm run --prefix agent dev
```

### Quick Start — SoSoValue + SoDEX Pipeline

```bash
# 1. SoSoValue API access
# Register at https://openapi.sosovalue.com → get API key
# Then:
echo "SOSOVALUE_API_KEY=your_key_here" >> agent/.env

# 2. SoDEX testnet (no application needed — works directly)
# Generate an EIP-712 signing key pair, then:
echo "SODEX_API_KEY_PRIVATE=0x1234...5678" >> agent/.env
echo "SODEX_API_KEY_NAME=enw-agent" >> agent/.env

# 3. AI market narrative (optional — template mode works without these)
echo "OPENAI_API_KEY=sk-..." >> agent/.env   # GPT-4o-mini
echo "ANTHROPIC_API_KEY=sk-ant-..." >> agent/.env  # Claude 3 Haiku
```

### Quick Start — CROO Agent Protocol (CAP)

```bash
# 1. Create your agent on https://agent.croo.network, then register
#    only this one service — the only one defensible for a cold Store
#    buyer (see docs/CROO_INTEGRATION.md for why the other four
#    reputation tools, including the free reputation-agent trust check,
#    stay MCP-only instead of Store-listed):
#    • signals-live          ($0.05 — live conviction signals)
#
# 2. Copy the SDK key from the CROO dashboard
echo "CROO_SDK_KEY=croo_sk_..." >> agent/.env
#
# 3. (Optional) Override default CROO endpoints
echo "CROO_API_URL=https://api.croo.network" >> agent/.env
echo "CROO_WS_URL=wss://api.croo.network/ws" >> agent/.env
```

When the agent starts it will connect to CROO via WebSocket and accept
incoming reputation orders. Payment settles on-chain in USDC on Base.

> **Current status**: live. CROO wallet `0x5d3d23679DFb6b01107b50A840b3c2EbB45AeE2C`
> is whitelisted, `CROO_SDK_KEY` is set, and the agent is connected
> (`[cap] Connected to CROO CAP`) — confirmed at `GET /cap/status`.

## Key Documents

| Document | What it covers |
|----------|----------------|
| [`SOUL.md`](./SOUL.md) | Design philosophy and architectural soul |
| [`AGENTS.md`](./AGENTS.md) | Agent orchestration guide |
| [`docs/CORE_PRINCIPLES.md`](./docs/CORE_PRINCIPLES.md) | Enhancement First, DRY, Consolidation — governs every change |
| [`docs/AGENT_DESIGN.md`](./docs/AGENT_DESIGN.md) | BSC trading agent: 6-factor signal, bankroll discipline, 6-layer scam-token defense |
| [`docs/MANTLE_INTEGRATION.md`](./docs/MANTLE_INTEGRATION.md) | ERC-8004 ConvictionRegistry on Mantle Sepolia |
| [`POSITIONING.md`](./docs/POSITIONING.md) | ICP, differentiation, creative monopoly frame, messaging do/don't |
| [`OUTBOUND_INTEGRATORS.md`](./docs/OUTBOUND_INTEGRATORS.md) | Surgical outreach to 5 integrator personas — DMs, ask, success metrics |
| [`docs/MCP_INTEGRATION.md`](./docs/MCP_INTEGRATION.md) | **Start here for buyers** — MCP + CROO rails, signals-live/v1.2, curl + requester |
| [`examples/buyer-agent/`](./examples/buyer-agent/) | **End-to-end buyer integration** — allocator decision flow: trust gate → paid signals → act + audit. Copy-paste-able, zero deps. See [`DEPLOYMENT.md`](./examples/buyer-agent/DEPLOYMENT.md) for cron/Docker scheduling |
| [`docs/community-share.md`](./docs/community-share.md) | Paste-ready Telegram/Discord announcements for CROO + Casper channels |
| [`docs/CASPER_INTEGRATION.md`](./docs/CASPER_INTEGRATION.md) | Casper Odra registry + MCP server + x402 reputation paywall |
| [`docs/CROO_INTEGRATION.md`](./docs/CROO_INTEGRATION.md) | CROO Agent Protocol integration — CAP services, USDC settlement, SDK methods |
| [`docs/SOSOVALUE_INTEGRATION.md`](./docs/SOSOVALUE_INTEGRATION.md) | SoSoValue API + SoDEX + AI narrative pipeline |
| [`docs/PRIVACY_MODEL.md`](./docs/PRIVACY_MODEL.md) | Aleo ZK-proof selective disclosure + signed-voucher rebate flow |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | Signed-voucher treasury + replay protection |
| [`ROADMAP.md`](./ROADMAP.md) | Phase status — Aleo Testnet v3 live (rebate + selective disclosure), Mantle ERC-8004 shipped |

## Core Thesis

In asymmetric markets, conviction isn't tested when you're wrong — it's
tested when you're early. Losses are capped (−1x), but wins are uncapped.
The most expensive mistake isn't being wrong — it's selling winners too
early. The agent encodes this as a six-factor contrarian signal
(contrarian + RSI timing + quality + fear-regime + holder growth − volatility
penalty) and holds through ordinary drawdown by design.

## Architecture (One-Line Map)

### Core Agent

- **Conviction Engine** — `agent/lib/conviction-signal.ts` (pure functions)
- **Risk Guardrails** — `agent/lib/risk-guardrails.ts` (drawdown, concentration, conviction floor, allowlist)
- **TWAK Execution** — `agent/lib/twak-executor.ts` + scam-token defense (DexScreener pool depth + reference-price gate)
- **On-Chain Portfolio** — `agent/lib/onchain-portfolio.ts` (`balanceOf` truth, contract-priced)
- **Anchor Adapters** — `agent/lib/anchors/{mantle,casper,index}.ts` (one interface, N chains, read + write)
- **Casper Contract** — `casper/src/conviction_registry.rs` (Odra/Rust)
- **MCP Server** — `agent/src/mcp/{server,tools,x402,pricing}.ts` (6 tools, x402 paywall, mounted on the existing Hono process)
- **CAP Adapter** — `agent/src/cap/{client,handler,pricing}.ts` (CROO Agent Protocol WebSocket client, USDC settlement, reuses the same reputation tools)
- **Payment Stats** — `agent/src/payment-stats.ts` (shared counters for x402 and CAP)
- **Dashboard** — `src/app/agent/page.tsx` (Next.js, proxies the live agent, surfaces MCP + x402 + CAP stats)

### SoSoValue + SoDEX Pipeline

- **Composite Data Provider** — `agent/lib/data-providers.ts` (`SosovalueClient` + `CmcClient` in one module — 30s-refresh token snapshots, SSI indices, news feeds, macro events; SoSoValue token prices preferred, CMC fills regime gaps)
- **SoDEX Client + EIP-712 Signing** — `agent/lib/dex-trading.ts` (`SodexClient`, nonce manager, signed market orders, balances) — ValueChain testnet, TWAK fallback on miss
- **SoSoValue Trading Signals** — `agent/lib/sosovalue-signals.ts` (SSI index regime confirmation → `scoreMarketRegime`; high-impact macro event pause → trade sizing; per-symbol news sentiment → `scoreTokenConviction`)
- **Market Narrative Generator** — `agent/lib/market-narrative.ts` (template-based + optional LLM-enhanced market commentary from SoSoValue feeds)

## Origins & Casper Buildathon Submission

This codebase has been developed across several 2026 hackathons and bounties,
each contributing a specific layer of the architecture. See the documents below
for the full lineage and design history.

**The Casper Agentic Buildathon 2026 submission is the reputation marketplace
layer**: an Odra smart contract on Casper Testnet, a Casper adapter that reads
and writes that contract, an MCP server exposing the registry to other agents,
and an x402 paywall so agents pay per query with CEP-18 micropayments. The
autonomous BSC trading agent is the live reputation source that feeds this layer.

For the buildathon submission narrative, see [`SUBMISSION.md`](./SUBMISSION.md).

### Layer history

| Layer | Hackathon / Bounty | Document |
|-------|-------------------|----------|
| Autonomous BSC trading agent, 6-factor conviction signal, bankroll discipline | BNB Hack: AI Trading Agent Edition | [`docs/AGENT_DESIGN.md`](./docs/AGENT_DESIGN.md) |
| ERC-8004 ConvictionRegistry on Mantle | Mantle Turing Test 2026 | [`docs/MANTLE_INTEGRATION.md`](./docs/MANTLE_INTEGRATION.md) |
| **Odra registry + MCP server + x402 paywall on Casper** | **Casper Agentic Buildathon 2026** | [`docs/CASPER_INTEGRATION.md`](./docs/CASPER_INTEGRATION.md) |
| **CROO Agent Protocol adapter with USDC settlement on Base** | **CROO Hackathon** | [`docs/CROO_INTEGRATION.md`](./docs/CROO_INTEGRATION.md) |
| Aleo ZK selective disclosure + signed-voucher rebates | Aleo Privacy Buildathon 2026 | [`docs/PRIVACY_MODEL.md`](./docs/PRIVACY_MODEL.md) |
| SoSoValue market data + SoDEX execution + AI narrative | SoSoValue Buildathon 2026 (Wave 3) | [`docs/SOSOVALUE_INTEGRATION.md`](./docs/SOSOVALUE_INTEGRATION.md) |
| Solana four-gate pre-trade safety skill | Superteam Brasil Solana AI Kit | [`agent/lib/solana-safety.ts`](./agent/lib/solana-safety.ts) + [solana-safe-trade-skill](https://github.com/thisyearnofear/solana-safe-trade-skill) |

## What This Is NOT

A trading bot. A signals platform. A leaderboard for speculation. Financial
advice. This is **self-knowledge for asymmetric markets** — backed by a
portable, cross-chain reputation layer.

## AG Grid

[AG Grid](https://www.ag-grid.com/javascript-data-grid/getting-started/) (free Community edition) could make EarlyNotWrong's position explorer, trade history, and conviction score matrix sortable/filterable/groupable — letting users slice by token, conviction tier, or outcome without custom table code. The dashboard surfaces multiple tabular views (open positions, trade log, behavioral metrics) that benefit from inline grid interaction.

## License

MIT
