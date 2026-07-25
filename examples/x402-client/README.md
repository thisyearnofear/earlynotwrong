# x402 MCP Client — Reference Implementation

> Complete the full x402 payment round-trip on Casper testnet.

This script demonstrates the x402 payment flow for MCP tool calls:

1. **Get the 402 challenge** — call a paid MCP tool without payment, receive `PaymentRequirements`
2. **Call a free tool** — verify the MCP server works with no payment
3. **Full paid round-trip** — construct payment, settle via facilitator, get data back

## Quick Start

```bash
# No dependencies needed — pure Node.js
node index.mjs --challenge    # Get the 402 PaymentRequirements (no wallet)
node index.mjs --free         # Call a free MCP tool
node index.mjs                # Full paid round-trip (needs wallet config)
node index.mjs --help         # Show help
```

## What Each Mode Does

### `--challenge` (no wallet needed)

Calls `get_live_signals` without an `X-PAYMENT` header. The agent returns:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "casper:casper-test",
    "payTo": "23058a42...",
    "amount": "50",
    "asset": "9824d60d...",
    "extra": { "name": "Cep18x402", "symbol": "CSPR", "decimals": "2" }
  }]
}
```

This proves the MCP server is live and returns Casper-native payment requirements.

### `--free` (no wallet needed)

Calls `get_agent_reputation` (a free tool) and prints the agent's live reputation
report — anchor count, mean conviction score, dual-chain presence.

### Full round-trip (needs wallet)

Requires `CASPER_PRIVATE_KEY_HEX` env var (Ed25519 private key, hex). The script:

1. Gets the 402 challenge
2. Constructs a Cep18x402 payment payload (signed CEP-18 transfer authorization)
3. Re-POSTs with `X-PAYMENT` header
4. The agent forwards to `cspr.cloud/settle` (facilitator verifies + submits on-chain)
5. On success, returns the live conviction signals data

**To get Cep18x402 tokens on testnet:**
1. Get testnet CSPR from the [faucet](https://testnet.cspr.live/faucet)
2. Swap CSPR → Cep18x402 on the cspr.cloud testnet DEX

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AGENT_URL` | `http://144.202.117.160:31777` | Agent endpoint URL |
| `CASPER_PRIVATE_KEY_HEX` | — | Ed25519 private key (hex, 128 chars) for signing CEP-18 transfers |

## How x402 Works on Casper

```
Client → POST /mcp (paid tool, no payment header)
       ← HTTP 402 + PaymentRequirements {scheme, network, payTo, asset, amount}

Client constructs PaymentPayload (signed CEP-18 transfer authorization)
Client → POST /mcp + X-PAYMENT: <base64 PaymentPayload>
       agent → POST cspr.cloud/settle (verify + submit in one round trip)
               ← {success: true, transaction, payer}
       ← HTTP 200 + tool result + X-PAYMENT-RESPONSE
```

The cspr.cloud facilitator pays the on-chain CSPR gas. Clients only sign a
CEP-18 transfer authorization. This is a payment pattern EVM cannot replicate
without bolting on multiple separate services.
