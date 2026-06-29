# EARLY, NOT WRONG

> Being early feels like being wrong. Until it doesn't.

An autonomous on-chain trading agent that scores **behavioral conviction**
(not price predictions), executes self-custody trades on BNB Smart Chain,
and anchors a verifiable record of every decision to **two settlement
chains** — then exposes that record as a **reputation marketplace** so any
other AI agent can query it via Model Context Protocol, paying per call
via x402 micropayments on Casper.

```
CMC Agent Hub ─► Conviction Engine ─► Risk Guardrails ─► TWAK Execution ─► Anchor Layer
   (data)         (6-factor contrarian)    (filters)       (BSC swaps)       ├─► Mantle (ERC-8004)
                                                                             └─► Casper (Odra)
                                                                                    │
                                                                          ┌─────────┴─────────┐
                                                                          │  MCP server       │
OTHER AGENTS ──────── MCP query ──────── x402 paid ─────────────────────► │  on the agent's   │
(yield bots,                                                              │  Hono process     │
 wallets, oracles)                                                        └───────────────────┘
```

The companion Next.js dashboard surfaces the live agent's state, conviction
signals, dual-chain anchors, and (separately) lets users analyze their own
Solana / Base wallet history through the same conviction lens with optional
ZK-private reputation.

In the **SoSoValue Buildathon** (Wave 3, Jun 29–Jul 8 2026), we enhanced the
agent with three new capabilities: **SoSoValue API** as an additional market
data source (token snapshots, SSI indices, news feeds, macro events),
**SoDEX testnet execution** as an orderbook venue alongside TWAK, and an
**AI market narrative generator** that produces natural-language market
commentary from SoSoValue's feeds and conviction data.

```
SoSoValue API ──┬── Token snapshots ──► Price / RSI / Quality (30s refresh)
                ├── SSI Indices ──────► Regime signal (index decline = fear)
                ├── News feeds ───────► Market narrative generation
                └── Macro events ────► Regime context (CPI, FOMC)
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

- **Agent dashboard** — https://earlynotwrong.vercel.app/agent
- **Agent API** — `GET /status`, `/conviction`, `/trades` on port 31777
- **MCP reputation API** — `POST /mcp` (5 tools, free + x402-paid). See
  [`docs/CASPER_BUILDATHON.md`](./docs/CASPER_BUILDATHON.md#reproduce-the-live-402-challenge)
  for the one-curl reproduction.
- **Demo** — [asciinema replay](https://asciinema.org/a/ox0AlPA1AN7uwfWJ) (~30s — MCP + x402 walk-through)
- **Latest dual-chain anchor** — verifiable on
  [Mantle Sepolia](https://explorer.sepolia.mantle.xyz/address/0x81226e8894D334c790D9a972855592E6C4eeB15C)
  and [Casper Testnet](https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa)

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

### Quick Start — SoSoValue Buildathon Components

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

## Key Documents

| Document | What it covers |
|----------|----------------|
| [`SOUL.md`](./SOUL.md) | Design philosophy and architectural soul |
| [`AGENTS.md`](./AGENTS.md) | Agent orchestration guide |
| [`docs/CORE_PRINCIPLES.md`](./docs/CORE_PRINCIPLES.md) | Enhancement First, DRY, Consolidation — governs every change |
| [`docs/MANTLE_INTEGRATION.md`](./docs/MANTLE_INTEGRATION.md) | ERC-8004 ConvictionRegistry on Mantle Sepolia |
| [`docs/CASPER_BUILDATHON.md`](./docs/CASPER_BUILDATHON.md) | Casper Odra ConvictionRegistry + dual-anchor adapter |
| [`docs/BNB_HACK_SUBMISSION.md`](./docs/BNB_HACK_SUBMISSION.md) | BNB Hack: AI Trading Agent Edition submission (Jun 2026) |
| [`docs/SOSOVALUE_INTEGRATION.md`](./docs/SOSOVALUE_INTEGRATION.md) | **NEW** — SoSoValue API + SoDEX + AI narrative integration (Buildathon Wave 3) |
| [`docs/PRIVACY_MODEL.md`](./docs/PRIVACY_MODEL.md) | Aleo ZK-proof selective disclosure model |
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
- **MCP Server** — `agent/src/mcp/{server,tools,x402,pricing}.ts` (5 tools, x402 paywall, mounted on the existing Hono process)
- **Dashboard** — `src/app/agent/page.tsx` (Next.js, proxies the live agent, surfaces MCP + x402 stats)

### SoSoValue Buildathon Additions

- **SoSoValue API Client** — `agent/lib/sosovalue-client.ts` (MarketDataProvider impl, 30s-refresh token snapshots, SSI index data, news feeds, macro events)
- **SoDEX Signer + Client** — `agent/lib/sodex-signer.ts` (EIP-712 signing, nonce management) + `agent/lib/sodex-client.ts` (REST client, market order placement, balance queries)
- **Market Narrative Generator** — `agent/lib/market-narrative.ts` (template-based + optional LLM-enhanced market commentary from SoSoValue feeds)
- **Composite Data Provider** — `agent/index.ts` (SoSoValue token prices preferred, CMC fills gaps; SoDEX execution preferred, TWAK fallback)

## Hackathons

| Event | Status | Doc |
|-------|--------|-----|
| BNB Hack: AI Trading Agent Edition | Submitted Jun 21 2026 | [`BNB_HACK_SUBMISSION.md`](./docs/BNB_HACK_SUBMISSION.md) |
| Casper Agentic Buildathon 2026 | Submitted Jun 30 2026 | [`CASPER_BUILDATHON.md`](./docs/CASPER_BUILDATHON.md) |
| Mantle Turing Test 2026 | Window missed; anchoring shipped anyway | [`MANTLE_INTEGRATION.md`](./docs/MANTLE_INTEGRATION.md) |
| **SoSoValue Buildathon** | **Wave 3 in progress (deadline Jul 8 2026)** | [`SOSOVALUE_INTEGRATION.md`](./docs/SOSOVALUE_INTEGRATION.md) |

## What This Is NOT

A trading bot. A signals platform. A leaderboard for speculation. Financial
advice. This is **self-knowledge for asymmetric markets** — backed by a
portable, cross-chain reputation layer.

## License

MIT
