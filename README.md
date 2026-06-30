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

- **Agent dashboard** — https://earlynotwrong.vercel.app/agent
- **Agent API** — `GET /status`, `/conviction`, `/trades` on port 31777
- **MCP reputation API** — `POST /mcp` (5 tools, free + x402-paid). See
  [`docs/CASPER_INTEGRATION.md`](./docs/CASPER_INTEGRATION.md#reproduce-the-live-402-challenge)
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

## Key Documents

| Document | What it covers |
|----------|----------------|
| [`SOUL.md`](./SOUL.md) | Design philosophy and architectural soul |
| [`AGENTS.md`](./AGENTS.md) | Agent orchestration guide |
| [`docs/CORE_PRINCIPLES.md`](./docs/CORE_PRINCIPLES.md) | Enhancement First, DRY, Consolidation — governs every change |
| [`docs/AGENT_DESIGN.md`](./docs/AGENT_DESIGN.md) | BSC trading agent: 6-factor signal, bankroll discipline, 6-layer scam-token defense |
| [`docs/MANTLE_INTEGRATION.md`](./docs/MANTLE_INTEGRATION.md) | ERC-8004 ConvictionRegistry on Mantle Sepolia |
| [`docs/CASPER_INTEGRATION.md`](./docs/CASPER_INTEGRATION.md) | Casper Odra registry + MCP server + x402 reputation paywall |
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
- **MCP Server** — `agent/src/mcp/{server,tools,x402,pricing}.ts` (5 tools, x402 paywall, mounted on the existing Hono process)
- **Dashboard** — `src/app/agent/page.tsx` (Next.js, proxies the live agent, surfaces MCP + x402 stats)

### SoSoValue + SoDEX Pipeline

- **Composite Data Provider** — `agent/lib/data-providers.ts` (`SosovalueClient` + `CmcClient` in one module — 30s-refresh token snapshots, SSI indices, news feeds, macro events; SoSoValue token prices preferred, CMC fills regime gaps)
- **SoDEX Client + EIP-712 Signing** — `agent/lib/dex-trading.ts` (`SodexClient`, nonce manager, signed market orders, balances) — ValueChain testnet, TWAK fallback on miss
- **SoSoValue Trading Signals** — `agent/lib/sosovalue-signals.ts` (SSI index regime confirmation → `scoreMarketRegime`; high-impact macro event pause → trade sizing; per-symbol news sentiment → `scoreTokenConviction`)
- **Market Narrative Generator** — `agent/lib/market-narrative.ts` (template-based + optional LLM-enhanced market commentary from SoSoValue feeds)

## Origins

This project was built across several hackathons during 2026, each contributing
a specific layer of the architecture:

- **BNB Hack: AI Trading Agent Edition** (Jun 2026) — the live BSC trading
  agent, 6-factor conviction signal, and bankroll discipline.
  See [`AGENT_DESIGN.md`](./docs/AGENT_DESIGN.md).
- **Mantle Turing Test 2026** — ERC-8004 ConvictionRegistry anchoring.
  See [`MANTLE_INTEGRATION.md`](./docs/MANTLE_INTEGRATION.md).
- **Casper Agentic Buildathon 2026** (Jun 2026) — Odra-based reputation
  registry, the MCP server, and the x402 paywall for paid reputation queries.
  See [`CASPER_INTEGRATION.md`](./docs/CASPER_INTEGRATION.md).
- **Aleo Privacy Buildathon 2026** — `early_not_wrong_v3.aleo` for ZK
  selective disclosure + signed-voucher patience rebates.
  See [`PRIVACY_MODEL.md`](./docs/PRIVACY_MODEL.md).
- **SoSoValue Buildathon 2026** (Wave 3, deadline Jul 8 2026) — SoSoValue
  market data, SoDEX execution, AI narrative generator.
  See [`SOSOVALUE_INTEGRATION.md`](./docs/SOSOVALUE_INTEGRATION.md).
- **Superteam Brasil Solana AI Kit bounty** (Jun 2026) — the four-gate
  pre-trade safety pattern, extracted to a standalone skill:
  [solana-safe-trade-skill](https://github.com/thisyearnofear/solana-safe-trade-skill).
  Vendored back into the agent at `agent/lib/solana-safety.ts`.

## What This Is NOT

A trading bot. A signals platform. A leaderboard for speculation. Financial
advice. This is **self-knowledge for asymmetric markets** — backed by a
portable, cross-chain reputation layer.

## License

MIT
