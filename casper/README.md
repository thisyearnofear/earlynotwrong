# casper — ConvictionRegistry (Odra)

The Casper half of the dual-chain anchoring layer (the other half is the
Mantle ERC-8004 registry — see `docs/MANTLE_INTEGRATION.md`).

## Contract: `src/conviction_registry.rs`

**v2** — an outcome-verified reputation registry. v1 anchored self-reported
conviction records; v2 keeps that surface verbatim (entry points +
`ConvictionAnchored` event) and adds the full claim lifecycle:

| Entry point | Purpose |
|---|---|
| `register_agent` | Agent identity/discovery — name, endpoint, domain tags |
| `anchor_claim` *(payable)* | Commit a claim; attached value splits into claim fee + bond |
| `resolve_claim` | Propose an outcome; opens the dispute window |
| `dispute_claim` *(payable)* | Counter-bonded challenge inside the window |
| `rule_dispute` | Arbiter adjudication; winner takes both bonds |
| `finalize_resolution` | Settles bonds after an undisputed window |
| `anchor_epoch_root` | One Merkle root per epoch of off-chain records |
| `anchor_conviction`, `get_subject_history`, `get_latest_conviction`, `get_by_thesis` | v1 surface, unchanged |

Reads (`get_claim`, `get_subject_claims`, `get_agent`, `get_epoch_root`,
`get_counts`, `get_claim_fee`, `get_dispute_window`, `get_arbiter`,
`get_fee_pool`) are free via state queries / the CES event log.

Full rationale, phased plan, and integration notes: `../docs/CASPER_FORWARD.md`.

## Build & test

The Rust toolchain is pinned via `rust-toolchain` (nightly).

```
cargo test                # OdraVM tests — no cargo-odra needed (24 tests)
cargo odra build -b casper  # wasm build → casper/wasm/ConvictionRegistry.wasm
```

`cargo-odra` must be installed for the wasm build:
`cargo install cargo-odra` (see https://github.com/odradev/cargo-odra).

## Deploy

`agent/scripts/casper-deploy.mjs` installs `casper/wasm/ConvictionRegistry.wasm`
on Testnet (needs `CSPR_CLOUD_TOKEN`, `CASPER_OPERATOR_PEM`, funded account).
Post-deploy, set `CASPER_REGISTRY_V2_HASH` in `agent/.env` and optionally
`set_config(0, dispute_window_ms)` so unbonded `anchor_claim` calls need no
attached value.

**Funding:** the testnet faucet is one-shot per account — to reload a spent
operator, run `agent/scripts/casper-new-operator.mjs` and faucet the new key.
Set `CASPER_ANCHOR_MODE=epoch` to skip per-record anchors (~1 deploy/day vs.
one per thesis change) — the sustainable mode on both networks.

## `resources/`

- `proxy_caller_with_return.wasm` — Odra's session proxy (vendored from
  odra-casper-rpc-client 2.8.1). Required for **payable** entry points: on
  VM-Casper-v1, attached value rides in a `cargo_purse` URef that only
  session code can create. The agent submits these as session-wasm deploys —
  see `callV2EntryPoint` in `agent/lib/anchors/casper.ts`.
