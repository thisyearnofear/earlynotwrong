# CROO Requester — signals-live

Reference buyer agent for the [Early, Not Wrong](https://earlynotwrong.vercel.app/agent) CAP listing.

Demonstrates the full **negotiate → pay → deliver → act on guidance** loop that CROO Store reviewers expect.

## Prerequisites

1. **`signals-live` registered** on [agent.croo.network](https://agent.croo.network) — see [`docs/croo-store-listing.md`](../../docs/croo-store-listing.md)
2. **Requester CROO SDK key** — must be different from the ENW provider key (provider holds the VPS WebSocket)
3. **USDC on Base** in the requester's CROO agent wallet (~$0.05 + fees)

## Dry run (no payment)

Validate the sample payload and print buyer guidance:

```bash
npm install
npm run dry-run
```

## Live purchase

```bash
export CROO_SDK_KEY=croo_sk_your_requester_key
npm start
```

Expected output:

```
✓ Delivery received (schema signals-live/v1.1)

── Buyer agent decision ──
Action: evaluate
Reason: Top candidate FET (conviction 76/100) — apply your sizing and risk rules
...
```

## Schema

https://earlynotwrong.vercel.app/schemas/signals-live-v1.1.schema.json

Example: [`docs/samples/signals-live-v1.1.example.json`](../../docs/samples/signals-live-v1.1.example.json)
