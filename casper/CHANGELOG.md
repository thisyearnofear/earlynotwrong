# Changelog

Changelog for `casper`.

## [0.1.0] - 2026-06-25
### Added
- `conviction_registry` module — Odra smart contract for anchoring conviction records on Casper Testnet.
- Entry points: `anchor_conviction`, `get_subject_history`, `get_latest_conviction`, `get_by_thesis`, `set_operator_authorization`, `is_operator`.
- CES event emission on every anchor for free read-path queries.
- CLI tool (`bin/cli.rs`) for contract deployment and conviction record queries.
