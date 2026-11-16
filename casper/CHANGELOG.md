# Changelog

Changelog for `casper`.

## [0.2.0] - 2026-11-14
### Added
- ConvictionRegistry v2 — outcome-verified claim lifecycle on top of the v1
  surface (full plan: `docs/CASPER_FORWARD.md`):
  - `register_agent` — agent identity/discovery registry.
  - `anchor_claim` (payable) — claims with type, domain, confidence, expiry,
    evidence hash; attached value splits into claim fee + bond.
  - `resolve_claim` / `dispute_claim` (payable) / `rule_dispute` /
    `finalize_resolution` — optimistic resolution with counter-bonded
    disputes and arbiter adjudication; bond settlement rules.
  - `anchor_epoch_root` — Merkle roots over epochs of off-chain records.
  - New events: `AgentRegistered`, `ClaimAnchored`, `ClaimResolved`,
    `ClaimDisputed`, `DisputeRuled`, `ResolutionFinalized`, `EpochAnchored`.
  - Admin: `set_arbiter`, `set_config` (claim fee, dispute window),
    `withdraw_fees`.
  - Reads: `get_agent`, `get_claim`, `get_subject_claims`, `get_epoch_root`,
    `get_counts`, `get_claim_fee`, `get_dispute_window`, `get_arbiter`,
    `get_fee_pool`.
- `resources/proxy_caller_with_return.wasm` — vendored Odra session proxy
  for payable calls (cargo-purse attached-value pattern).

### Notes
- v1 entry points (`anchor_conviction`, `get_subject_history`,
  `get_latest_conviction`, `get_by_thesis`) and the `ConvictionAnchored`
  event are unchanged — v1 anchors and reads keep working on a v2 package.
- 24 OdraVM tests via `cargo test`; not yet deployed (v1 package hash still
  live on testnet).

## [0.1.0] - 2026-06-25
### Added
- `conviction_registry` module — Odra smart contract for anchoring conviction records on Casper Testnet.
- Entry points: `anchor_conviction`, `get_subject_history`, `get_latest_conviction`, `get_by_thesis`, `set_operator_authorization`, `is_operator`.
- CES event emission on every anchor for free read-path queries.
- CLI tool (`bin/cli.rs`) for contract deployment and conviction record queries.
