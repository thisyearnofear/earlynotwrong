# signals-live/v1 — Response Schema

> Stable JSON contract for the premium live-signal product on **both** settlement rails.

| Rail | Discovery | Tool / serviceId | Price |
|------|-----------|------------------|-------|
| MCP + x402 (Casper) | `POST /mcp` → `get_live_signals` | `get_live_signals` | 0.5 CSPR |
| CROO CAP (Base) | [CROO Agent Store](https://agent.croo.network) | `signals-live` | $0.05 USDC |

Machine-readable schema: [`signals-live-v1.schema.json`](./signals-live-v1.schema.json)

---

## Purpose

Paid callers receive the agent's **current-cycle** contrarian conviction state:

- Market regime (fear/greed, funding, SSI confirmation)
- Top **5** token signals with factor breakdown and rationale
- Macro pause gate (entry skip / size multiplier)

This is the **tradeable data** — not anchored history (use free/paid history tools for that).

---

## Version detection

| Payload | Meaning |
|---------|---------|
| `"schema": "signals-live/v1"` | Versioned envelope (target contract) |
| No `schema` field | **Legacy v0** — bare object from `getLiveSignals()` today (see [Migration](#migration-from-v0)) |

Integrators should:

1. Parse JSON from MCP tool result or CAP `deliverableText`
2. If `schema === "signals-live/v1"`, validate against the JSON Schema
3. If `freshness.stale === true`, downgrade automation or wait for next cycle

---

## Example (v1)

```json
{
  "schema": "signals-live/v1",
  "generatedAt": "2026-07-17T11:42:00.000Z",
  "agent": {
    "name": "Early, Not Wrong",
    "subjectHash": "0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a",
    "mode": "live"
  },
  "freshness": {
    "cycle": 127,
    "lastRunAt": 1721210520000,
    "nextRunAt": 1721224920000,
    "cycleIntervalMs": 14400000,
    "stale": false,
    "staleReason": null
  },
  "regime": {
    "score": 85,
    "label": "DEEP FEAR — PRIME CONTRARIAN",
    "fearGreedIndex": 20,
    "fearLevel": "extreme-fear",
    "ssiConfirmation": 0.35
  },
  "signals": [
    {
      "symbol": "FET",
      "score": 76,
      "breakdown": {
        "contrarian": 22,
        "rsi": 8,
        "quality": 14,
        "regime": 18,
        "holders": 7,
        "volatilityPenalty": 3,
        "news": 2
      },
      "weights": {
        "contrarian": 30,
        "rsi": 10,
        "quality": 20,
        "regime": 20,
        "holders": 10,
        "volatilityPenaltyMax": 15,
        "newsMax": 10
      },
      "holderCount": 584021,
      "holderGrowthPercent": 0.042,
      "newsSentiment": 0.12,
      "rationale": "down 18% 7d · extreme fear · holder base expanding · deep liquidity"
    }
  ],
  "macroPause": {
    "clear": true,
    "skipEntries": false,
    "sizeMultiplier": 1,
    "hoursUntilNext": null,
    "reason": "No high-impact macro events within 12h"
  },
  "meta": {
    "topN": 5,
    "settlementRail": "croo-cap",
    "tool": "signals-live"
  }
}
```

---

## Field reference

### Envelope

| Field | Type | Description |
|-------|------|-------------|
| `schema` | `"signals-live/v1"` | Version identifier |
| `generatedAt` | ISO-8601 string | Server assembly time (UTC) |
| `agent` | object | Producer identity |
| `agent.subjectHash` | `0x` + 64 hex | Cross-chain reputation key; use with free `get_agent_reputation` |
| `agent.mode` | `live` \| `simulator` | Execution mode |
| `freshness` | object | Cycle timing + staleness |
| `meta.settlementRail` | `mcp-x402` \| `croo-cap` | Which payment rail unlocked the response |
| `meta.tool` | `get_live_signals` \| `signals-live` | MCP tool name or CAP serviceId |

### Freshness & staleness

Default cycle interval: **4 hours** (`cycleIntervalMs: 14_400_000`). The agent may double the interval when BNB is low — callers should read `freshness.cycleIntervalMs` from the payload, not hard-code 4h.

**Stale rule (normative for v1):**

```
stale = lastRunAt != null
     && (now - lastRunAt) > cycleIntervalMs * 1.5
```

When `stale: true`, `staleReason` should explain (e.g. `"Last cycle completed 6.2h ago; agent may be degraded or between adaptive intervals"`).

Before the first cycle completes: `lastRunAt: null`, `regime: null`, `signals: []`, `stale: false`.

### `regime`

Contrarian opportunity score (0–100). Higher = more fear = better entry backdrop for this agent's thesis.

### `signals[]`

- Sorted by `score` descending
- At most **5** entries (`meta.topN`)
- `score` is conviction to **open** a position, not a price target
- `breakdown` factors sum (minus penalty) to the displayed score per engine rules

### `macroPause`

When `skipEntries: true`, the agent will not open new positions this cycle regardless of signal scores. When `sizeMultiplier < 1`, entries are sized down.

---

## Migration from v0

**v1.2 is current** — MCP `get_live_signals` and CAP `signals-live` return the execution + provenance + guidance envelope via `getLiveSignalsV1()` in `agent/src/mcp/tools.ts`. See [`signals-live-v1.2.md`](./signals-live-v1.2.md). Prior: [`signals-live-v1.1.md`](./signals-live-v1.1.md).

**Legacy v0** — bare object (no `schema` field) from the internal `getLiveSignals()` core builder:

```json
{
  "cycle": 127,
  "lastRunAt": 1721210520000,
  "regime": { "...": "..." },
  "signals": [ "..." ],
  "macroPause": null
}
```

No `schema`, `generatedAt`, `agent`, `freshness`, or `meta`.

**v1 implementation:**

1. `wrapLiveSignalsV1(core, rail)` in `agent/src/mcp/tools.ts`
2. MCP tool handler and `fulfillCapOrder` call `getLiveSignalsV1()` for `get_live_signals` / `signals-live`
3. `stale` computed from `lastRunAt` and adaptive `cycleIntervalMs`
4. Optional `weights` / holder fields included on signals when present in agent state

---

## Validation

```bash
# After v1 is deployed — validate a saved response
npx ajv validate -s docs/schemas/signals-live-v1.schema.json -d sample.json
```

---

## Related

- MCP tool: `agent/src/mcp/tools.ts` → `getLiveSignalsV1()`
- CAP fulfillment: `agent/src/cap/handler.ts` → `signals-live`
- Pricing: `agent/src/mcp/pricing.ts`, `agent/src/cap/pricing.ts`
- CROO integration: [`../CROO_INTEGRATION.md`](../CROO_INTEGRATION.md)
