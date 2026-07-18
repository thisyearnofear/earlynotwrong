# signals-live/v1.2 — Response Schema

| Rail | Service | Price |
|------|---------|-------|
| MCP x402 (Casper) | `get_live_signals` | 0.5 CSPR |
| CROO CAP (Base) | `signals-live` | $0.05 USDC |

- JSON Schema: [`signals-live-v1.2.schema.json`](./signals-live-v1.2.schema.json)
- Example: [`../samples/signals-live-v1.2.example.json`](../samples/signals-live-v1.2.example.json)

v1.0 (`signals-live/v1`) remains in [`signals-live-v1.md`](./signals-live-v1.md).  
v1.1 remains in [`signals-live-v1.1.md`](./signals-live-v1.1.md) for reference.

---

## What's new in v1.2

1. **`execution`** — per-cycle ledger of ranked candidates, entries, exits, skips, and **alignment** (`topRankedEntered`) so buyers can compare `guidance` to what the agent actually did.
2. **`provenance.behavioral.status`** — explicit `ready` | `insufficient_history` | `no_ledger` instead of silent `null` when behavioral metrics are unavailable.
3. **`provenance.behavioral.minClosedPositions`** — documents the threshold before metrics appear.

---

## Validate locally

```bash
cd agent && npm test -- signals-live-schema
```

Or with `ajv-cli`:

```bash
npx ajv validate \
  -s public/schemas/signals-live-v1.2.schema.json \
  -d public/samples/signals-live-v1.2.example.json
```

---

## Implementation

- Assembly: `agent/src/mcp/tools.ts` → `getLiveSignalsV1()`, `buildBuyerGuidance()`, `buildProvenance()`
- Execution ledger: `agent/lib/cycle-execution.ts` (wired in `cycle-runner.ts` + `index.ts`)
- CAP delivery: `DeliverableType.Text` in `agent/src/cap/handler.ts` (Store Deliverable Schema must stay empty)
