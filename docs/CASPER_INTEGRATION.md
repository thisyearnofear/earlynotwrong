# Casper Integration — Reputation Marketplace + MCP / x402 Paywall

**What this is**: Casper-hosted agent reputation registry, queryable by other AI agents via Model Context Protocol, paid per call via x402 CEP-18 micropayments.

**Live dashboard**: https://earlynotwrong.vercel.app/agent (the "Agent Reputation API" panel)

> **Buyer integrators:** [`docs/MCP_INTEGRATION.md`](./MCP_INTEGRATION.md) covers MCP + CROO hire paths, curl examples, and the reference requester.

**Demo**: [asciinema replay](https://asciinema.org/a/ox0AlPA1AN7uwfWJ) (~30s — MCP + x402 live; recorded before the current pricing — it shows `get_agent_reputation` as paid, which is now free)

---

## What Casper Does Here

```
OTHER AGENTS  ──MCP query──►  Casper-hosted reputation registry  ──reads──►  ConvictionRegistry
(yield bots,                    + paid via x402 micropayments                  (Odra contract,
 wallets, RWA                   ↑                                               deployed Testnet)
 oracles, etc.)                 ↓
                  Casper-native payment rail. Other chains can't do this.
```

Casper isn't a notarization mirror — it's the marketplace for agent reputation. Other AI agents query the registry via Model Context Protocol, pay per call via x402 CEP-18 micropayments, and get back verifiable reputation data the on-chain contract is the source of truth for.

This is a use of Casper that EVM **cannot replicate** without bolting on multiple separate services — Casper has it natively:

```
Capability                    EVM (Mantle)        Casper
─────────────────────────────────────────────────────────────────
Smart contract registry       ✓ (ERC-8004)        ✓ (Odra)
HTTP-native paywall           ✗  needs separate    ✓  x402 facilitator
                                 service              + CSPR.cloud (live)
Free event-log reads          ✓  via getLogs      ✓  via state queries
Agent-discoverable surface    via custom API      ✓  via MCP (standard)
Facilitator pays the gas      ✗                   ✓
```

## What the MCP Server Exposes

Six tools registered via `@modelcontextprotocol/sdk@^1.29.0`, served at `POST /mcp` on the same Hono process that runs the trading agent — one HTTP boot, shared state.

```
Tool                       Paid?      Description
──────────────────────────────────────────────────────────────────────
get_latest_conviction      FREE       Most recent record across both chains
get_by_thesis              FREE       Point lookup by 32-byte thesis hash
get_agent_reputation       FREE       Aggregate report (counts, mean, dual-chain)
get_subject_history        0.1 CSPR   Full chronological history cross-chain
cross_chain_lookup         0.1 CSPR   Mantle + Casper side-by-side + sync flag
get_live_signals           0.5 CSPR   Live conviction signals for the current cycle
```

The trust-decision queries are free — including the aggregate reputation report a first-time evaluator needs to decide whether to trust the agent at all. The paid tier is the recurring-value data: history walks, cross-chain reconciliation, and the agent's live current-cycle conviction signals (the tradeable data).

## The x402 Paywall Flow

```
Client → POST /mcp (paid tool, no payment)
         ← HTTP 402 + PaymentRequirements {scheme, network, payTo, asset, amount}

Client constructs PaymentPayload (signed CEP-18 transfer authorization)
Client → POST /mcp + X-PAYMENT: <base64 PaymentPayload>
         agent → POST cspr.cloud /settle (verify + submit in one)
                 ← {success: true, transaction, payer}
         ← HTTP 200 + tool result + X-PAYMENT-RESPONSE
```

The cspr.cloud facilitator pays the on-chain CSPR gas — we don't fund swaps, the facilitator does. Clients pay via a signed CEP-18 transfer; we verify and submit through `/settle` in one round trip.

## How Casper Reads Stay Free

Odra contracts emit Casper Event Standard (CES) events. The CSPR.cloud RPC exposes these as a numbered dictionary under the contract's `__events` uref — each anchor is one event, readable via `state_get_dictionary_item` without gas. Our Casper adapter walks the log, decodes each event with a small bytesrepr-aware decoder, and caches the result for 30 seconds:

```typescript
// agent/lib/anchors/casper.ts:readAnchoredEvents
const lenItem = await rpc("state_get_item", { ..., key: refs.eventsLengthUref });
const totalEvents = readU32LE(hexToUint8(lenItem.stored_value.CLValue.bytes));

for (let i = 0; i < totalEvents; i++) {
  const item = await rpc("state_get_dictionary_item", {
    ..., dictionary_identifier: { URef: { seed_uref: refs.eventsUref, dictionary_item_key: String(i) } },
  });
  const decoded = decodeAnchoredEvent(Uint8Array.from(item.stored_value.CLValue.parsed));
  if (decoded) out.push(decoded);
}
```

MCP queries return live records in 200-300 ms (cold) / <10 ms (cached).

## Connecting a Casper Wallet (in-browser)

The dashboard exposes a **Connect Casper Wallet** panel (`src/components/casper-wallet-connect.tsx`)
so any visitor with the [Casper Wallet](https://www.casperwallet.io/) browser extension can connect
their account directly in the web app — no server-side key, no operator PEM.

```
Visitor (browser)
  └─ window.CasperWalletProvider  (injected async by the extension)
       ├─ requestConnection()      → wallet popup, user approves
       ├─ getActivePublicKey()     → Ed25519/Secp256k1 public key hex
       ├─ signMessage(msg, pubKey) → wallet signs, returns signature (proof)
       ├─ sign(txJson, pubKey)     → wallet signs transaction, returns signature
       └─ events: Connected / Disconnected / ActiveKeyChanged / Locked / Unlocked
```

The component polls for the injected provider (the extension's content script loads after the
page), syncs UI to all wallet lifecycle events, shows the active account's public key with a
link to its `testnet.cspr.live` explorer page, and provides three user-facing actions:

1. **Sign proof message** — proves the connection is live end-to-end (the wallet pops a signing
   prompt and returns a verifiable signature).
2. **CSPR balance** — queries the connected account's testnet balance via the agent server
   proxy. `CSPR_CLOUD_TOKEN` stays server-side; the browser never sees it.
3. **Anchor to Casper** — lets the user anchor their own conviction record to the live
   `ConvictionRegistry` contract. The flow is:

```
Browser                     Server (agent)                Casper Testnet
  │                            │                              │
  │  POST /casper/build-anchor │                              │
  │  { publicKey, record }     │                              │
  │───────────────────────────►│                              │
  │  { transaction (JSON) }    │                              │
  │◄───────────────────────────│                              │
  │                            │                              │
  │  provider.sign(tx, pubKey) │                              │
  │  → wallet popup → signature│                              │
  │                            │                              │
  │  POST /casper/submit-anchor│                              │
  │  { transaction, signature, │                              │
  │    publicKey }              │                              │
  │───────────────────────────►│  putTransaction              │
  │                            │─────────────────────────────►│
  │                            │  { txHash }                  │
  │  { txHash, explorerUrl }   │◄─────────────────────────────│
  │◄───────────────────────────│                              │
```

The server builds the transaction (it has the contract hash + chain config); the browser signs
it with the wallet; the server submits the signed transaction. The user pays gas from their own
account. The extension is the sole signer — no private keys ever leave the browser. This is the
user-facing Casper Wallet integration; the operator PEM anchoring is the server-side counterpart.

### Server endpoints for browser-wallet flows

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/casper/balance?publicKey=…` | GET | CSPR balance for any public key (motes + CSPR) |
| `/casper/build-anchor` | POST | Build unsigned `anchor_conviction` transaction JSON |
| `/casper/submit-anchor` | POST | Submit signed transaction to Casper Testnet RPC |

These are proxied through the Next.js API route `/api/agent/proxy?endpoint=…` so the browser
never contacts the VPS directly. The proxy forwards query params (for balance) and request
bodies (for build/submit) to the agent server.

## Casper Toolkit Components Used

```
✅ Odra Framework v2.8.1            Smart contract (Rust → WASM, deployed Testnet)
✅ CSPR.cloud RPC                    Node access (Authorization-header auth)
✅ CSPR.cloud x402 Facilitator       Paywall settle (CEP-18 transfers + gas)
✅ Model Context Protocol            @modelcontextprotocol/sdk v1.29 — tool surface
✅ casper-js-sdk v5.0.12             SessionBuilder + ContractCallBuilder + reads
✅ Casper Wallet (browser extension) In-browser connect + message signing (user-facing)
✅ CSPR.live explorer                Verification UI
```

## Source Files

| File | Purpose |
|------|---------|
| `casper/src/conviction_registry.rs` | Odra smart contract — anchor + read entry points |
| `agent/lib/anchors/casper.ts` | Casper adapter: anchor writes + CES event reads (no gas) |
| `agent/lib/anchors/mantle.ts` | EVM-side view functions + event log reads via viem |
| `agent/lib/anchors/index.ts` | `lookupSubjectCrossChain` orchestrator |
| `agent/src/mcp/server.ts` | MCP server with 6 tools, mounted on existing Hono |
| `agent/src/mcp/tools.ts` | Pure-function tool implementations over the adapter interface |
| `agent/src/mcp/x402.ts` | Paywall middleware — 402 challenge + facilitator settle |
| `agent/src/mcp/pricing.ts` | Per-tool pricing table |
| `agent/scripts/casper-deploy.mjs` | Odra contract install via SessionBuilder |
| `agent/scripts/casper-transfer.mjs` | Native CSPR transfer (operator → recipient) |
| `src/components/casper-wallet-connect.tsx` | Dashboard "Casper Wallet" panel — connect, sign proof, balance, anchor to Casper |
| `src/app/agent/page.tsx` | Dashboard — composes the extracted cards (see `src/components/agent/`) |
| `src/components/agent/reputation-api-card.tsx` | Dashboard "Reputation API" panel — live MCP + x402 stats + copy-paste curls |
| `src/components/agent/croo-cap-card.tsx` | Dashboard "CROO · CAP" panel — Store listing + USDC settlement stats |
| `src/components/agent/buyer-preview-card.tsx` | Dashboard "What buyers get" panel — public signals-live teaser |
| `src/app/api/agent/proxy/route.ts` | Next.js proxy — forwards GET + POST to agent server (balance, build-anchor, submit-anchor) |

## How Other Agents Use This

Any AI agent — a Claude Desktop client, a Cursor agent, a custom yield bot — adds our MCP server to their config:

```json
{
  "mcpServers": {
    "early-not-wrong": {
      "url": "https://earlynotwrong.vercel.app/api/agent/proxy?endpoint=mcp"
    }
  }
}
```

Then they can ask in natural language: *"What's the reputation of agent `0x4a93767…459a`?"* The client routes the request through MCP to our server, we read the contract, return the report — free, because the trust decision is the adoption gateway. Once trust is established, the recurring queries are paid: the client signs a CEP-18 payment (e.g. 0.5 CSPR for `get_live_signals`), and the facilitator settles it on Casper Testnet.

This is the missing piece of the agent economy: agents need to verify each other's track records without trusting self-reported claims. We host that verification surface, on Casper, with native payment rails.

## Architectural Reusability

The MCP + x402 architecture is reusable for any agent that wants to publish verifiable reputation on Casper:

- The `AnchorAdapter` interface (`agent/lib/anchors/types.ts`) is generic — any "subject → record" data fits it.
- The MCP tools (`agent/src/mcp/tools.ts`) are pure functions over the adapter interface — fork-and-replace to publish different data types.
- The x402 middleware (`agent/src/mcp/x402.ts`) is decoupled from MCP — works for any Hono route that needs paid gating.

Future directions:
- Open the `anchor_conviction` entry point to other agents (today it's permissionless on-chain, but our MCP only surfaces our own agent's records).
- Add a discovery directory so agents can browse published reputations.
- Implement CEP-18 token issuance for tier-based access (free read, paid search, premium feed).

## Live Evidence

| Component | Address / URL |
|-----------|---------------|
| Casper contract package | `hash-973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa` |
| Contract entity (v1) | `contract-8e116ff3021d82c6297d2a325b29e88be67a0c0816f5868ebf4e9e9eaafd517d` |
| Explorer | https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa |
| Live MCP endpoint | `POST http://144.202.117.160:31777/mcp` |
| Live x402 stats | `GET http://144.202.117.160:31777/reputation/stats` |
| Live dashboard | https://earlynotwrong.vercel.app/agent — "Agent Reputation API" panel |
| Operator account | `0202589fb59e1e2e9e67c22458be6cab3a78eb899901c0fc3e83368d791a4474e89a` |
| Latest live anchor | https://testnet.cspr.live/deploy/d843b61bfecd94178f23381cfa6ea89db5f8e2164470edc7d05f083d5024efb1 |

## Reproduce the Live 402 Challenge

One command, against the live VPS — no setup, no wallet, no auth:

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_live_signals",
      "arguments": {}
    }
  }'
```

Returns a fully-populated `casper:casper-test` `PaymentRequirements`:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme":  "exact",
    "network": "casper:casper-test",
    "asset":   "9824d60dc3a5c44a20b9fd260a412437933835b52fc683d8ae36e4ec2114843e",
    "payTo":   "23058a429ae31f0de556b5747546cc6d7817a559afe2657f297186dc509cd30a",
    "amount":  "50",
    "extra":   { "name": "Cep18x402", "symbol": "CSPR", "decimals": "2", "version": "1" }
  }]
}
```

To complete the round trip, a client constructs + signs a `Cep18x402` transfer authorization for 50 base units (0.5 CSPR) to that account hash, re-POSTs with `X-PAYMENT: <base64>`, and our middleware forwards to `cspr.cloud/settle` — which verifies and submits the on-chain CEP-18 transfer in one round trip. The `Cep18x402` token on testnet is the cspr.cloud-hosted canonical wrapper; no token deploy needed on our side.

The free tier works without any of this — `get_latest_conviction`, `get_by_thesis`, and `get_agent_reputation` return real data from the live Casper contract immediately:

```bash
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_latest_conviction","arguments":{"subjectHash":"0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"}}}'
```

Returns the live anchored record (decoded from the Casper contract's CES event log, no gas).

## Caveats

For a client to settle a paid call end-to-end (not just receive the 402 challenge), the client needs a wallet holding the testnet `Cep18x402` token to sign the transfer authorization. The server-side flow is fully live — the curl above demonstrates the 402 challenge; the `X-PAYMENT-RESPONSE` round trip requires a client holding `Cep18x402`.

## Links

- **GitHub**: https://github.com/thisyearnofear/earlynotwrong
- **Live dashboard**: https://earlynotwrong.vercel.app/agent
- **Casper contract**: https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa
- **Demo recording**: https://asciinema.org/a/ox0AlPA1AN7uwfWJ (predates the current pricing — `get_agent_reputation` shown as paid is now free)
- **Mantle integration (parallel chain)**: [`MANTLE_INTEGRATION.md`](./MANTLE_INTEGRATION.md)
- **Trading agent (the source of records)**: [`AGENT_DESIGN.md`](./AGENT_DESIGN.md)
