# Early, Not Wrong — RYO-CHAN Practice Agent

**RYO-CHAN Hackathon 2026 · Tracks 1 (Autonomous Agents), 2 (Dashboards & Interfaces), 3 (New Skills)**

An autonomous trading agent built on the RYO-CHAN read-only research layer.
It interprets market evidence, takes conviction-weighted positions, and records
every decision — buys, holds, exits, and *refusals to trade* — in a
tamper-evident, hash-chained reasoning ledger that judges can recompute.

This is a port of the production Early, Not Wrong agent (`agent/`): the same
"early, not wrong" philosophy — buy contrarian fear, hold through ordinary
drawdown, exit only when the thesis breaks — reimplemented as a first-class
domain in the project's harness adapter layer. **Paper trades only. No real
funds are touched.**

## Architecture — RYO as a harness domain

The repo's harness (`agent/lib/adapters/`) maps `HARNESS_DOMAIN` to a
`DataSource`/`ConvictionFactors`/`TradeExecutor` triple. `crypto` and `options`
were the existing domains; this submission adds `ryo` as the third:

```
HARNESS_DOMAIN=ryo
  ├─ ryo-data.ts        DataSource        → /api/market/intelligence (universe),
  │                                       scan_market, analyze_token, ohlcv klines
  ├─ ryo-conviction.ts  ConvictionFactors → deterministic 0–100 scoring + safety veto
  ├─ ryo-executor.ts    TradeExecutor     → paper fills into the reasoning ledger
  ├─ ryo-client.ts      transport         → REST-first, MCP (JSON-RPC) fallback
  ├─ ryo-ledger.ts      audit trail       → append-only JSONL, sha256 hash-chained
  └─ ryo-status.ts      Track 2 surface   → file-backed status: verdict feed + chain integrity
```

Surfaces built on the same files:

```
agent/ryo/serve.ts                zero-dep status server (node:http)
  GET  /ryo/status                arena-card payload (same as production /ryo/status)
  GET  /ryo/ledger?n=50           raw reasoning trail
  GET  /ryo/verify                chain audit over HTTP
  POST /ryo/thesis-commit         Track 3 tool

agent/src/server.ts               production agent also serves GET /ryo/status
src/components/agent/ryo-arena-card.tsx
                                  dashboard card — verdict feed IS the reasoning
                                  trail: factor rationale, veto badges, visual
                                  hash chain, integrity recomputed per fetch
```

The loop, risk checks, and scoring framework are unchanged — the same code
shape the production agent runs against BSC and Alpaca. `DOMAIN_PROFILES.ryo`
registers the triple in `agent/lib/harness-config.ts` and `registry.ts`.

## The reasoning trail

Every decision appends one JSONL record to `agent/data/ryo-ledger.jsonl`:

```json
{"ts":"2026-11-11T14:33:58Z","cycle":1,"symbol":"HYPE","action":"BUY",
 "conviction":76,"sizeUsd":1500,"priceUsd":37.9,
 "reason":"RSI 34 — oversold timing; down -14.1% over 7d — contrarian window; fear regime (26)",
 "evidence":{"scan":"scan_market:rest:a1b2…","intelligence":"market_intelligence:rest:c3d4…",
             "analyze":"analyze_token:rest:e5f6…"},
 "prevHash":"GENESIS","hash":"8f4e…"}
```

Each entry's `hash` links to the previous record — recompute with `--verify`
and any rewritten decision breaks every hash after it. The `evidence` block
carries digests of the exact tool responses that produced the decision:
cause → effect, repeatably. Failed tool calls are recorded as `SKIP` entries
with the failure named — the trail stays honest even when the data isn't.

## Conviction scoring (0–100)

| Factor | Weight | Evidence |
|---|---|---|
| Contrarian | 30 | 7d drawdown from `analyze_token` — rewards buying fear |
| Quality | 20 | market cap + 24h volume (log-scaled); kline vol haircut |
| Timing | 10 | 24h stabilization; penalizes chasing pumps |
| Regime | 20 | `market_intelligence` fear/greed (fear = asymmetry) |
| Safety | 10 | embedded `check_safety` block |

**Hard vetoes:** `safe: false`, positive `honeypot`, or flag failures (e.g.
`top10_concentration` — observed vetoing XRP/ZEC/DOGE in live runs) zero the
score entirely. An `unavailable` safety source is neutral (5 pts), and the
absence is disclosed in the rationale rather than hidden.

## Exits (practice positions)

- `EXIT` at −35% — thesis invalidated, cap the loss
- `EXIT` on +50% peak then −30% give-back — lock the asymmetry
- `HOLD` through ordinary drawdown — the project's namesake

## Track 3 — `thesis_commit` (new platform tool)

A research primitive RYO doesn't have: **prove your reasoning existed before
the move**. Any agent commits `symbol + thesis + conviction + evidence_refs`
and gets back a sha256 commitment plus a hash-chained receipt — "early, not
wrong" as a platform primitive. Theses chain into the same ledger as the
practice agent's decisions, so one `--verify` audit covers both.

Spec-shaped to mount on RYO's MCP surface as-is (`agent/ryo/tool-spec.json`):

```bash
npx tsx agent/ryo/thesis-commit.ts --symbol HYPE \
  --thesis "RSI 34 + 14% 7d drawdown — oversold mean-reversion" \
  --conviction 76 --horizon 72
curl -X POST localhost:31800/ryo/thesis-commit -d '{"symbol":"HYPE","thesis":"…"}'
```

## On-chain anchoring (judges' pick)

Each cycle's ledger **head-hash** is committed through the repo's existing
anchor stack (`agent/lib/anchors/` — the same `anchorAll` the production
agent uses for Casper/Mantle thesis anchoring). The local chain proves
integrity; the anchor proves the trail existed at that time. Best-effort and
honest: adapters report `skipped` when operator env isn't configured, and
skip results are themselves recorded in the ledger. `RYO_ANCHOR=0` disables.

## Run it

```bash
export RYO_MCP_KEY=ryo_mcp_...     # issued in the app (Bearer credential)
npx tsx agent/ryo/run.ts                     # one cycle (tsx, no build step)
npx tsx agent/ryo/run.ts --cycles 12 --interval 300
npx tsx agent/ryo/run.ts --verify            # audit the hash chain
npx tsx agent/ryo/serve.ts                   # status server → :31800/ryo/status
```

State (paper cash $10,000 + positions) persists in `agent/data/ryo-state.json`.
A user's app session JWT also works as the Bearer for the REST tools; the MCP
transport requires a `ryo_mcp_...` key.

## Disclosures (per Official Rules)

- **Pre-existing materials:** the harness adapter interfaces (`agent/lib/adapters/`),
  the conviction-scoring philosophy, and the hash-chained-ledger pattern are
  ported from the pre-existing Early, Not Wrong codebase (public repo,
  `thisyearnofear/earlynotwrong`, in development since June 2026 — well before
  this submission). The RYO-specific adapters in this entry were written for
  the hackathon.
- **AI tools:** this entry was pair-built with an AI coding agent (Devin);
  the agent designed the adapter mapping, extraction heuristics, and ledger.
- **Simulated activity:** all trades are paper fills in a local ledger. Nothing
  presented as real trading; the executor's health check reports `mode: "paper"`.

## Lineage

Production agent: `agent/` (BSC live trading, MCP + x402 revenue surface,
Casper/Mantle thesis anchoring). This entry keeps the conviction engine and
the verifiable-trail idea; the domain layer is swapped for RYO-CHAN's tools.
