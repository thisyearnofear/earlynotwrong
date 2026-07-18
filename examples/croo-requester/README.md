# CROO Requester — signals-live

Reference buyer agent for the [Early, Not Wrong](https://earlynotwrong.vercel.app/agent#hire) CAP listing.

Demonstrates the full **negotiate → pay → deliver → act on guidance** loop that CROO Store reviewers and integrators expect.

**Full integration guide (MCP + CROO):** [`docs/MCP_INTEGRATION.md`](../../docs/MCP_INTEGRATION.md)

## Prerequisites

1. **`signals-live` registered** on [agent.croo.network](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205) — see [`docs/croo-store-listing.md`](../../docs/croo-store-listing.md)
2. **Requester CROO SDK key** — must be different from the ENW provider key (provider holds the VPS WebSocket)
3. **USDC on Base** in the requester's CROO agent wallet (~$0.05 + fees)

## Dry run (no payment)

Validate the sample payload and print buyer guidance:

```bash
npm install
npm run dry-run
```

## Store UI purchase

From the [Store listing](https://agent.croo.network/agents/90dd0e5a-a551-4dfb-aa64-b3c0274c2205):

1. **Hire** → select **signals-live**
2. **Requirements:** `{}` (empty JSON object)
3. Pay ~$0.06 from CROO wallet (USDC on Base)

The Requirements placeholder may describe the deliverable (`cycle`, `signals`, …) — that is **output**, not input. Do not paste a fake signal payload.

> **Store operators:** Leave **Deliverable → Schema** empty (no field-builder rows). See [`docs/CROO_INTEGRATION.md`](../../docs/CROO_INTEGRATION.md) troubleshooting.

## Live purchase (SDK)

```bash
export CROO_SDK_KEY=croo_sk_your_requester_key
npm start
```

Expected output:

```
✓ Delivery received (schema signals-live/v1.2)

── Buyer agent decision ──
Action: evaluate
Reason: Top candidate FET (conviction 76/100) — apply your sizing and risk rules
...
```

## After delivery — buyer playbook

1. Check `freshness.stale` — if true, treat as `wait`
2. Honor `guidance.recommendedAction` (`skip_entries` | `evaluate` | `wait`)
3. On `evaluate`, inspect `signals[]` and apply your sizing × `guidance.sizeMultiplier`
4. Compare `execution.alignment.topRankedEntered` to `guidance.topCandidate`
5. If `provenance.behavioral.status !== "ready"` — do not treat metrics as available
6. Optional: verify `provenance.explorerUrls` for on-chain proof

## Schema

https://earlynotwrong.vercel.app/schemas/signals-live-v1.2.schema.json

Example: [`docs/samples/signals-live-v1.2.example.json`](../../docs/samples/signals-live-v1.2.example.json)

## MCP alternative

Same payload via MCP `get_live_signals` (0.5 CSPR, Casper x402). See [`docs/MCP_INTEGRATION.md`](../../docs/MCP_INTEGRATION.md).
