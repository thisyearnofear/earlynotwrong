# Mantle Integration — ConvictionRegistry (ERC-8004)

Mantle Sepolia is one of two settlement chains that the agent anchors its
conviction analyses to every cycle. The other is Casper Testnet
(see [`CASPER_BUILDATHON.md`](./CASPER_BUILDATHON.md)). Same record, same
hash, two chains — adding a third is one new file under `agent/lib/anchors/`.

## What gets anchored

Each 4-hour cycle the agent computes:

- `subjectHash` — `keccak256("bsc:<agent-wallet>")`
- `thesisHash` — `keccak256(canonical-JSON of cycle metrics)`
- `convictionScore` — 0–100 regime score (Fear & Greed composite)
- `archetype` — human-readable label (e.g. `"DEEP FEAR — PRIME CONTRARIAN"`)
- `timestamp` — ms since epoch

…then calls `anchorConviction(subjectHash, thesisHash, convictionScore,
archetype)` on the on-chain registry. The contract appends the record to a
per-subject history and emits a `ConvictionAnchored` event.

## Deployed contracts

| Component | Address | Network |
|-----------|---------|---------|
| `MantleConvictionRegistry` (BNB Hack agent) | `0x81226e8894D334c790D9a972855592E6C4eeB15C` | Mantle Sepolia |
| `MantleConvictionRegistry` (historical) | `0xBd93c9fd88d7D3D5a7b64b24C137f3666E287121` | Mantle Sepolia |
| Operator wallet | `0x145e91520c3128828C8031339a7b7CC49f1BDEF6` | Mantle Sepolia |

Verify any anchor at
`https://explorer.sepolia.mantle.xyz/address/0x81226e8894D334c790D9a972855592E6C4eeB15C`
or look up a specific tx hash via the agent's `/conviction` endpoint
(`anchorResults[].explorerUrl`).

## Schema

The contract is owner-managed: the deployer is authorized in the
constructor, and the owner can add ENW operator wallets via
`setOperatorAuthorization(address, bool)`. Every anchor carries the calling
operator's address, so submissions are on-chain-attributed via signature.

```solidity
struct ConvictionRecord {
    bytes32 subjectHash;
    address anchoredBy;
    bytes32 thesisHash;
    uint256 convictionScore;
    string  archetype;
    uint256 timestamp;
    bool    verified;
}

mapping(bytes32 => ConvictionRecord[]) subjectConvictionHistory;
mapping(bytes32 => ConvictionRecord)   convictionByThesis;
```

Full source: [`mantle/contracts/MantleConvictionRegistry.sol`](../mantle/contracts/MantleConvictionRegistry.sol).

## Adapter

The agent calls the registry through the shared `AnchorAdapter` interface:

- `agent/lib/anchors/types.ts` — interface + `ConvictionRecord` shape
- `agent/lib/anchors/mantle.ts` — viem-based Mantle adapter
- `agent/lib/anchors/index.ts` — `anchorAll()` orchestrator (Mantle + Casper)

The orchestrator never throws; each adapter returns an `AnchorResult` so
failures on one chain don't block the other.

## Required env

```bash
MANTLE_OPERATOR_KEY=<0x… authorized operator private key>
```

Without it, `MantleAnchorAdapter.isAvailable()` returns false and the
orchestrator skips the chain. See [`agent/.env.example`](../agent/.env.example).

## Verifying a thesis hash on-chain

```bash
# Read the latest conviction for a subject
cast call 0x81226e8894D334c790D9a972855592E6C4eeB15C \
  "getLatestConviction(bytes32)(tuple)" \
  <subjectHash> \
  --rpc-url https://rpc.sepolia.mantle.xyz
```

The returned tuple matches the `ConvictionRecord` struct above.

## Status

- ✅ Registry deployed, anchoring live every cycle
- ✅ Dual-chain adapter pattern shipped (Mantle + Casper)
- 🔜 Mantle-native strategy ingestion (MNT, mETH, USDY) — deferred until
  the agent's BSC trading window closes
- 🔜 User-submitted EIP-712 report anchoring (let users sign their own
  conviction reports without the operator wallet)

## Related

- [`CASPER_BUILDATHON.md`](./CASPER_BUILDATHON.md) — the parallel Casper adapter
- [`BNB_HACK_SUBMISSION.md`](./BNB_HACK_SUBMISSION.md) — the trading agent that produces these records
- [`PRIVACY_MODEL.md`](./PRIVACY_MODEL.md) — Aleo ZK layer for private conviction credentials
