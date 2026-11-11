# Early, Not Wrong — RYO-CHAN Practice Agent

**RYO-CHAN Hackathon 2026 · Track 1 (Autonomous Agents)**

An autonomous trading agent built on the RYO-CHAN read-only research tools
(`market_overview`, `scan_market`, `analyze_token`, `deep_analysis`,
`compare_tokens`, `check_safety`). It interprets market evidence, takes
conviction-weighted positions, and records every decision — buys, holds,
exits, and *refusals to trade* — in a tamper-evident reasoning ledger.

This is a port of the production Early, Not Wrong agent (`agent/`): the same
"early, not wrong" philosophy — buy contrarian fear, hold through ordinary
drawdown, exit only when the thesis breaks — reimplemented against RYO-CHAN's
evidence surface with paper trades only. No real funds are touched.

## Architecture

```
agent/ryo/
├── client.ts   — RyoClient: REST-first transport over app-ryochan.com/api,
│                 with MCP (JSON-RPC tools/call) fallback per tool
├── agent.ts    — the cycle: scan → overview → analyze → safety gate →
│                 compare top-2 → score → decide → record
├── ledger.ts   — append-only JSONL reasoning trail, sha256 hash-chained
└── run.ts      — CLI runner (--cycles N, --interval S, --verify)
```

## The reasoning trail

Every decision appends one JSONL record to `agent/ryo/data/ryo-ledger.jsonl`:

```json
{"ts":"…","cycle":3,"symbol":"INJ","action":"BUY","conviction":74,
 "reason":"conviction 74 ≥ 55; down 12.3% over 7d — contrarian window; fear regime (28)",
 "evidence":{"scan":"scan_market:rest:ab12cd…","analyze":"analyze_token:mcp:ef34gh…",
             "safety":"check_safety:rest:ij56kl…","compare":"compare_tokens:mcp:mn78op…"},
 "prevHash":"8f4e…","hash":"c01a…"}
```

Each entry's `hash` links to the previous record, so a judge can recompute the
chain (`--verify`) and prove no decision was rewritten after the fact — the
same primitive this agent uses to anchor conviction theses on-chain in
production, made auditable offline. Evidence fields carry digests of the exact
tool responses that produced the decision: cause → effect, repeat-ably.

## Conviction scoring (0–100)

| Factor | Weight | Source |
|---|---|---|
| Contrarian | 30 | `analyze_token` 7d drawdown — rewards buying fear |
| Quality | 20 | market cap + liquidity floor |
| Timing | 10 | 24h stabilization; penalizes chasing pumps |
| Regime | 20 | `market_overview` fear/greed |
| Safety | 10 | `check_safety` — honeypot flag is a hard veto |

Entries require conviction ≥ 55 and pass `check_safety`; top-2 candidates are
compared via `compare_tokens` and the winner gets a `deep_analysis` before the
paper buy is recorded.

## Exits (practice positions)

- `EXIT` at −35% — thesis invalidated, cap the loss
- `EXIT` on +50% peak then −30% give-back — lock the asymmetry
- `HOLD` through ordinary drawdown — the project's namesake

## Run it

```bash
export RYO_MCP_KEY=ryo_mcp_...
node agent/ryo/run.ts                        # one cycle (Node ≥22.6, no build)
node agent/ryo/run.ts --cycles 12 --interval 300
node agent/ryo/run.ts --verify               # audit the hash chain
```

State (paper cash + positions) persists in `agent/ryo/data/ryo-state.json`.

## Failure honesty

When a tool call fails, the agent records a `SKIP` entry naming the failure
rather than silently skipping the cycle — the reasoning trail is complete even
when the market data isn't.

## Lineage

Production agent: `agent/` (BSC live trading, MCP + x402 revenue surface,
Casper/Mantle thesis anchoring). This entry keeps the conviction engine and
the verifiable-trail idea; the domain layer is swapped for RYO-CHAN's tools.
