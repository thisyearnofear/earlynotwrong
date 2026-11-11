# EARLY, NOT WRONG

> Agent reputation marketplace, natively on Casper.
> Autonomous conviction, on-chain proof, MCP-queriable reputation, x402 micropayments.

An autonomous trading agent that makes conviction-based decisions, anchors
every thesis on-chain as an immutable record, and exposes that record to
other agents via MCP — trust queries free, live data paid per call via
x402 CEP-18 micropayments (plus CROO CAP / USDC on Base as a second rail).

The agent is a **domain-agnostic harness**: `HARNESS_DOMAIN` resolves a
`DataSource` / `ConvictionFactors` / `TradeExecutor` triple — `crypto` (BSC,
live), `options` (Alpaca paper, kept as the second-domain proof), `ryo`
(RYO-CHAN research tools — practice agent + public reasoning trail).

```
HARNESS_DOMAIN ─► DataSource ─► 7-factor conviction ─► Executor ─► ledger
   crypto        SoSoValue/CMC   6 deterministic          TWAK      anchored:
   options       Alpaca         + LLM jury (±15,          Alpaca    Casper Odra
   ryo           RYO tools      vetoes honored)           paper     + Mantle 8004
```

The Next.js app is its dashboard — live state, conviction signals, arena
cards per domain, a standalone `/ryo` reasoning surface, and (separately)
wallet conviction analysis for end users.

**Core thesis:** conviction is tested when you're early, not when you're
wrong. The agent buys quality assets that are *down* during fear, holds
through ordinary drawdown by design, and records refusals as first-class
decisions.

## Live

- **Landing** — https://earlynotwrong.vercel.app/ · **dashboard** — /agent · **ryo** — /ryo
- **Casper contract** — [testnet.cspr.live](https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa)
- **MCP endpoint** — `POST http://144.202.117.160:31777/mcp` (6 tools, x402 paywall)
- **Agent API** — `GET http://144.202.117.160:31777/status` · `/edge-report`
- **CROO Agent Store** — [agent.croo.network](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205)

```bash
# one-curl: does the conviction signal have edge?
curl -sS http://144.202.117.160:31777/edge-report | jq '.verdict, .hasEdge, .edge'
```

## Quick Start

```bash
npm install && npm run --prefix agent install

npm run dev                                    # web dashboard
AGENT_MODE=simulator npm run --prefix agent dev  # agent, no credentials needed

cp agent/.env.example agent/.env               # fill in keys for live mode
npm run --prefix agent dev
```

RYO practice agent (hackathon demo, paper-only):

```bash
RYO_MCP_KEY=… npx tsx agent/ryo/run.ts         # one conviction cycle
npx tsx agent/ryo/serve.ts                   # status + feed + receipts on :31800
```

## Documentation

Full docs live in [`docs/`](./docs/README.md) — the index is the source of truth.

| | |
|---|---|
| [AGENTS.md](./AGENTS.md) | Agent orchestration guide — architecture, module map, ops status |
| [docs/CORE_PRINCIPLES.md](./docs/CORE_PRINCIPLES.md) | Enhancement First, DRY, Consolidation — governs every change |
| [docs/AGENT_DESIGN.md](./docs/AGENT_DESIGN.md) | BSC agent: 6-factor signal, bankroll discipline, scam-token defense |
| [docs/HARNESS_ARCHITECTURE_PLAN.md](./docs/HARNESS_ARCHITECTURE_PLAN.md) | Domain-agnostic harness + adapter registry |
| [docs/CASPER_INTEGRATION.md](./docs/CASPER_INTEGRATION.md) | Odra registry, MCP server, x402 paywall |
| [docs/A2A_BUYER_GUIDE.md](./docs/A2A_BUYER_GUIDE.md) | **Buyers start here** — MCP + CROO rails, wallet-score audit |
| [agent/ryo/README.md](./agent/ryo/README.md) | RYO-CHAN domain — LLM jury, reasoning ledger, receipts, debate tools |
| [docs/LESSONS.md](./docs/LESSONS.md) | Post-mortems and the ops log · history in [docs/hackathons.md](./docs/hackathons.md) |

## What This Is NOT

A trading bot. A signals platform. A leaderboard for speculation. Financial
advice. This is **self-knowledge for asymmetric markets** — backed by a
portable, cross-chain reputation layer.

## License

MIT
