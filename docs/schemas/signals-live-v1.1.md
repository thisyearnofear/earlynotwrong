# signals-live/v1.1 — Response Schema

> Store-ready contract: **signals + provenance + buyer guidance** in one paid payload.

| Rail | Tool / serviceId | Price |
|------|------------------|-------|
| MCP + x402 (Casper) | `get_live_signals` | 0.5 CSPR |
| CROO CAP (Base) | `signals-live` | $0.05 USDC |

- JSON Schema: [`signals-live-v1.1.schema.json`](./signals-live-v1.1.schema.json)
- Example: [`../samples/signals-live-v1.1.example.json`](../samples/signals-live-v1.1.example.json)
- Store listing copy: [`../croo-store-listing.md`](../croo-store-listing.md)
- Reference requester: [`../../examples/croo-requester/`](../../examples/croo-requester/) · buyer guide: [`../../docs/MCP_INTEGRATION.md`](../../docs/MCP_INTEGRATION.md)

---

## What's new in v1.1

| Addition | Purpose |
|----------|---------|
| `provenance` | Trust bundle — thesis hash, behavioral score, anchor stats, explorer URLs |
| `guidance` | Action contract for cold Store buyers (`skip_entries` / `evaluate` / `wait`) |
| `meta.schemaUrl` | Machine-readable schema pointer for CAP Schema deliverables |

v1.0 (`signals-live/v1`) remains documented in [`signals-live-v1.md`](./signals-live-v1.md) for reference.

---

## Buyer guidance (normative)

| `recommendedAction` | When | Buyer behavior |
|---------------------|------|----------------|
| `wait` | `freshness.stale` or no signals | Do not act; poll next cycle |
| `skip_entries` | `macroPause.skipEntries` | Block new entries regardless of scores |
| `evaluate` | Fresh data + candidates present | Inspect `signals[]`, size with `sizeMultiplier` |

Always read `guidance.reason` for the human-readable rationale.

---

## Validation

```bash
npx ajv validate \
  -s docs/schemas/signals-live-v1.1.schema.json \
  -d docs/samples/signals-live-v1.1.example.json
```

---

## Implementation

- Assembly: `agent/src/mcp/tools.ts` → `getLiveSignalsV1()`, `buildBuyerGuidance()`, `buildProvenance()`
- CAP delivery: `DeliverableType.Text` with full `signals-live/v1.1` JSON in `agent/src/cap/handler.ts` (Store Deliverable Schema must stay empty — see `docs/croo-store-listing.md`)
