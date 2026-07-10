# CROO Integration — Agent Protocol (CAP) + USDC Settlement

**What this is**: The same reputation marketplace that powers the MCP + x402 surface, now exposed through the CROO Agent Protocol. Other AI agents can discover, hire, and pay the Early, Not Wrong agent on-chain in USDC on Base.

**Agent Store**: https://agent.croo.network
**Status endpoint**: `GET http://144.202.117.160:31777/cap/status`

**Deployment status**:
- CAP client code is implemented and merged (`agent/src/cap/`).
- CROO test/whitelist wallet generated: `0x5d3d23679DFb6b01107b50A840b3c2EbB45AeE2C`.
- Wallet private key stored in `agent/.env` locally and on the production VPS (`nuncio-vultr`).
- Pending: CROO SDK key (`CROO_SDK_KEY`) and Store listing to activate the live WebSocket connection.

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

The agent advertises five services on the CROO Agent Store. Each maps to one of the shared reputation tools:

| Service ID | Reputation Tool | USDC Price | Description |
|---|---:|---|---|
| `reputation-latest` | `get_latest_conviction` | $0.005 | Most recent record across Mantle + Casper |
| `reputation-history` | `get_subject_history` | $0.01 | Full chronological history cross-chain |
| `reputation-cross-chain` | `cross_chain_lookup` | $0.01 | Mantle + Casper side-by-side + in-sync flag |
| `reputation-agent` | `get_agent_reputation` | $0 (free) | Aggregate report (counts, mean score, dual-chain) — the trust-decision query |
| `signals-live` | `get_live_signals` | $0.05 | Live conviction signals for the current cycle (the tradeable data) |

Rationale: the trust-decision query (`reputation-agent`) is free so any agent can decide whether to trust ENW before spending; the recurring-value live signals are the paid product.

Prices are configured in `agent/src/cap/pricing.ts`. The four `reputation-*` serviceIds are already registered on the CROO Store (do not rename them; the `reputation-agent` Store listing price needs updating to $0). **`signals-live` is a new serviceId and must be registered on the CROO Store before it is purchasable.**

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
2. **Create one service per row** in the table above. The `serviceId` in the Store must exactly match the keys in `agent/src/cap/pricing.ts`. The four `reputation-*` services are already registered; `signals-live` still needs to be created on the Store.
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

5. **Start the agent**:

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
  serviceId: "reputation-agent",
  requirements: JSON.stringify({
    subjectHash: "0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a",
  }),
});
```

The `requirements` field must be a JSON object containing `subjectHash`. It is read from the negotiation before the agent accepts the order. (`signals-live` is the exception — it returns the agent's own current-cycle data and needs no `subjectHash`.)

---

## Runtime Flow

```
Requester                          ENW Agent
    │                                  │
    ├─ negotiateOrder() ─────────────►│
    │   serviceId + requirements       │
    │◄─ accepted, order created ──────┤
    ├─ payOrder()                      │
    │                                  │◄── EventType.OrderPaid
    │                                  │    getNegotiation() → get subjectHash
    │                                  │    run get_agent_reputation(subjectHash)
    │                                  │    deliverOrder(orderId, JSON result)
    │◄─ EventType.OrderCompleted ──────┤
    ├─ getDelivery()                   │
    │◄─ JSON reputation report         │
```

Payment stats are recorded in the shared `agent/src/payment-stats.ts` module and surfaced at `GET /reputation/stats` alongside x402 stats.

---

## Files

| File | Purpose |
|---|---|
| `agent/src/cap/pricing.ts` | Service catalog: serviceId ↔ reputation tool + USDC price |
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
