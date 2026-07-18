# CROO Integration — Agent Protocol (CAP) + USDC Settlement

**What this is**: The same reputation marketplace that powers the MCP + x402 surface, now exposed through the CROO Agent Protocol. Other AI agents can discover, hire, and pay the Early, Not Wrong agent on-chain in USDC on Base.

> **Buyer integrators:** start with [`docs/MCP_INTEGRATION.md`](./MCP_INTEGRATION.md) — covers both MCP (CSPR) and CROO (USDC) rails plus the reference requester.

**Agent Store**: https://agent.croo.network
**Status endpoint**: `GET http://144.202.117.160:31777/cap/status`

**Deployment status** (last verified 2026-07-17):

- CAP client live in `agent/src/cap/` — WebSocket connected on VPS (`GET /cap/status` → `"connected": true`).
- **CROO Agent Store:** [Early, Not Wrong](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205) — `signals-live` at $0.05 USDC, SLA &lt; 5 min.
- **First verified Store purchase:** order `d3e51b1f-df3d-4ccb-8441-21c1117a569c` (2026-07-17) — pay tx `0xae73bab6…`, delivery `signals-live/v1.1` with `guidance: evaluate`.
- **Current delivery schema:** **signals-live/v1.2** (signals + execution alignment + provenance + buyer guidance). Reference requester: [`examples/croo-requester/`](../examples/croo-requester/).
- Paste-ready listing copy: [`docs/croo-store-listing.md`](croo-store-listing.md).

---

## What CAP Does Here

```
CROO Agent Store
       │
       ▼
OTHER AGENTS ──negotiate/order/pay──► CROO coordination layer ──WebSocket──► ENW agent
(yield bots,                            (USDC settlement on Base)              (fulfills with
wallets, oracles)                                                              reputation JSON)
```

CROO CAP handles the parts of A2A commerce that are orthogonal to the agent's core logic:

| Concern | Who handles it |
|---|---|
| Discovery + identity | CROO Agent Store |
| Order negotiation + terms | CROO Agent Protocol (`@croo-network/sdk`) |
| Payment settlement | USDC on Base (on-chain) |
| Reputation data | Early, Not Wrong (same tools as MCP) |
| Delivery proof | CROO (`client.deliverOrder`) |

The agent's job is reduced to: **accept known services, run the matching reputation tool, deliver JSON**. No pricing, invoicing, or escrow logic lives in our code — that's the CAP layer.

---

## CAP Services

The agent's CAP client recognizes five serviceIds (`agent/src/cap/pricing.ts`), but only one is registered on the CROO Agent Store — the other four are reachable via MCP only. See the rationale below.

| Service ID | Reputation Tool | USDC Price | Store-listed? |
|---|---:|---|---|
| `signals-live` | `get_live_signals` | $0.05 | Yes — the tradeable live-signal product |
| `reputation-agent` | `get_agent_reputation` | $0 (free) | No — CROO requires a positive price; a free query would contradict its own value prop. Free via MCP instead. |
| `reputation-latest` | `get_latest_conviction` | $0.005 | No — MCP only |
| `reputation-history` | `get_subject_history` | $0.01 | No — MCP only |
| `reputation-cross-chain` | `cross_chain_lookup` | $0.01 | No — MCP only |

### Why only one service is Store-listed

CROO Store buyers are cold — they discover a service with no prior context on ENW. `signals-live` is self-contained: a standalone live trading-signal feed, no prior knowledge required. Everything else is either undiscoverable or mispriced for a cold buyer:

- The three subject-lookup services (`reputation-latest`, `reputation-history`, `reputation-cross-chain`) require the caller to already know a specific `subjectHash` — and only return data for tokens ENW has itself traded (~20 trades total, no search-by-symbol). A Store buyer has no way to discover what to query.
- `reputation-agent` is designed to be the *free* trust-decision query — but CROO's Store requires a positive price ("price must be positive"), so listing it there would mean charging for what's supposed to be a free trust check, undermining the reason it exists. It stays free via MCP instead.

Prices are configured in `agent/src/cap/pricing.ts`. `CAP_SERVICE_IDS` includes all five so the client still accepts/fulfills orders for the MCP-only ones if a requester negotiates them directly — only Store *discoverability* is scoped down, not functionality.

---

## SDK Methods Used

We integrate the provider-side of [`@croo-network/sdk@0.2.1`](https://github.com/CROO-Network/node-sdk):

```typescript
import { AgentClient, Config, EventType, DeliverableType } from "@croo-network/sdk";

const client = new AgentClient(
  { baseURL: "https://api.croo.network", wsURL: "wss://api.croo.network/ws" },
  process.env.CROO_SDK_KEY!,
);

const stream = await client.connectWebSocket();

stream.on(EventType.NegotiationCreated, async (e) => {
  await client.acceptNegotiation(e.negotiation_id!);
});

stream.on(EventType.OrderPaid, async (e) => {
  await client.deliverOrder(e.order_id!, {
    deliverableType: DeliverableType.Text,
    deliverableText: JSON.stringify(reputationResult),
  });
});
```

Methods actually called by our adapter:

- `AgentClient.connectWebSocket()` — long-lived runtime connection.
- `client.acceptNegotiation(negotiationId)` — create the on-chain order.
- `client.rejectNegotiation(negotiationId, reason)` — decline unknown services.
- `client.getNegotiation(negotiationId)` — read request `requirements` before accepting.
- `client.getOrder(orderId)` — confirm paid order details.
- `client.deliverOrder(orderId, { deliverableType, deliverableText })` — submit the reputation JSON result.

---

## Setup

1. **Create the agent on the CROO Agent Store** at https://agent.croo.network.
2. **Create the one Store-listed service** (`signals-live` at $0.05). The human-readable slug must match the key in `agent/src/cap/pricing.ts`. CROO also assigns an **internal service UUID** — copy it from the Store service page and set on the VPS:

```bash
# Required for Store purchases — negotiations arrive with UUID, not the slug
echo "CROO_SIGNALS_LIVE_SERVICE_UUID=3da733af-bc0f-492e-9117-d47b055e4fe1" >> agent/.env
```

See `agent/.env.example` for `CROO_SERVICE_UUID_MAP` if you list multiple services later. The other four serviceIds stay MCP-only by design — don't register them on the Store.
3. **Copy the SDK key** into the agent environment:

```bash
echo "CROO_SDK_KEY=croo_sk_..." >> agent/.env
```

4. **Generate a CROO wallet** for whitelist access and USDC receipt (only needs to be done once):

```bash
node agent/scripts/generate-croo-wallet.mjs
# Prints the public address. The private key is written to agent/.env.
```

5. **(Optional)** Override default CROO endpoints:

```bash
echo "CROO_API_URL=https://api.croo.network" >> agent/.env
echo "CROO_WS_URL=wss://api.croo.network/ws" >> agent/.env
```

6. **Start the agent**:

```bash
npm run --prefix agent dev
```

If `CROO_SDK_KEY` is set, the agent logs:

```
[cap] Connected to CROO CAP
```

If the key is missing, CAP is disabled and the agent continues normally:

```
[cap] CROO_SDK_KEY not set — CAP client disabled
```

---

## Requester Example

Another agent can hire Early, Not Wrong through CAP:

```typescript
import { AgentClient, Config, EventType } from "@croo-network/sdk";

const client = new AgentClient(
  { baseURL: "https://api.croo.network", wsURL: "wss://api.croo.network/ws" },
  process.env.CROO_SDK_KEY!,
);

const stream = await client.connectWebSocket();

stream.on(EventType.OrderCreated, async (e) => {
  await client.payOrder(e.order_id!);
});

stream.on(EventType.OrderCompleted, async (e) => {
  const delivery = await client.getDelivery(e.order_id!);
  const reputation = JSON.parse(delivery.deliverableText);
  console.log("Reputation:", reputation);
  stream.close();
});

await client.negotiateOrder({
  serviceId: "signals-live",
  requirements: JSON.stringify({}),
});
```

`signals-live` needs no `subjectHash` — send `{}` as requirements (Store UI, SDK, or reference requester). The agent returns its own current-cycle data regardless of requirements content.

For MCP-only reputation services, requirements must include `subjectHash`:

```json
{ "subjectHash": "0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a" }
```

---

## Store UI vs deliverable (common confusion)

The CROO Store order form may show a **Requirements** placeholder describing the **output** shape (`cycle`, `signals`, `regime`, …). That is the deliverable schema, not buyer input.

| Field | Buyer sends | Agent returns |
|-------|-------------|---------------|
| **Requirements** | `{}` | — |
| **Deliverable** | — | Full `signals-live/v1.2` JSON (see [sample](https://earlynotwrong.vercel.app/samples/signals-live-v1.2.example.json)) |

**Store listing editor:** Leave **Deliverable → Schema** empty (no field rows). Use **Deliverable → Text** for a human-readable teaser only. Adding object/array rows in the Schema builder causes CROO to reject delivery with `INVALID_DELIVERABLE`.

If orders show *"Waiting for provider to accept"* then flip to rejected, check VPS logs for `[cap] Rejecting negotiation … unknown service` — you likely need `CROO_SIGNALS_LIVE_SERVICE_UUID` (see Setup step 2).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `unknown service` in VPS logs; UUID in log line | Store sends service UUID, not slug | Set `CROO_SIGNALS_LIVE_SERVICE_UUID` on VPS; redeploy (`535f60bf`+) |
| Store stuck on "Waiting to accept" | Same as above — auto-rejected in ~2s | Retry after UUID env + `pm2 reload --update-env` |
| `SERVICE_NOT_FOUND` from SDK | Service not registered or wrong slug | Register `signals-live` on Store; negotiate with slug `signals-live` |
| Duplicate WebSocket errors | Same SDK key as provider + requester | Use a separate **requester** key for `examples/croo-requester` |
| Requirements validation errors | Pasted deliverable JSON as input | Use `{}` only |
| `INVALID_DELIVERABLE` / order expires unpaid-out | Deliverable Schema field builder populated on Store | Clear all rows under **Deliverable → Schema**; keep Text teaser only |
| `invalid character 'h'` on deliver | `deliverableSchema` sent as URL string (legacy) | Agent now sends Text + full JSON only (`a6e922ca`+) |

**Monitor CAP on VPS:**

```bash
ssh nuncio-vultr "pm2 logs earlynotwrong --lines 50 --nostream | grep '\[cap\]'"
```

---

## Runtime Flow

```
Requester                          ENW Agent
    │                                  │
    ├─ negotiateOrder() ─────────────►│
    │   serviceId: "signals-live"      │
    │   requirements: "{}"             │
    │                                  │◄── EventType.NegotiationCreated
    │                                  │    getNegotiation() → resolve UUID → signals-live
    │                                  │    acceptNegotiation()
    │◄─ order created ─────────────────┤
    ├─ payOrder() (USDC on Base)       │
    │                                  │◄── EventType.OrderPaid
    │                                  │    getLiveSignalsV1() → signals-live/v1.2
    │                                  │    deliverOrder(Text + signals-live/v1.2 JSON)
    │◄─ EventType.OrderCompleted ──────┤
    ├─ getDelivery()                   │
    │◄─ JSON: signals + guidance +     │
    │         provenance               │
```

Payment stats are recorded in the shared `agent/src/payment-stats.ts` module and surfaced at `GET /reputation/stats` alongside x402 stats.

---

## Files

| File | Purpose |
|---|---|
| `agent/src/cap/pricing.ts` | Service catalog + UUID→slug resolution (`resolveCapServiceId`) |
| `agent/src/cap/handler.ts` | Fulfill one paid order by calling the matching reputation tool |
| `agent/src/cap/client.ts` | WebSocket client lifecycle, negotiation/order handlers |
| `agent/src/payment-stats.ts` | Shared payment counters for x402 and CAP |
| `agent/src/server.ts` | `/cap/status` + `/reputation/stats` endpoints |
| `agent/index.ts` | Starts the CAP client alongside the Hono server |

---

## Why This Fits CROO

- **Agentic**: the agent runs autonomously and fulfills reputation queries without human intervention.
- **Callable**: listed on the CROO Agent Store with a standard service surface.
- **USDC settlement**: accepts payment on Base through CAP's on-chain order lifecycle.
- **Composable**: other agents can hire ENW as a dependency for conviction/reputation data.
- **Additive**: CAP sits alongside the existing MCP + x402 (Casper) surface. Nothing was removed.
