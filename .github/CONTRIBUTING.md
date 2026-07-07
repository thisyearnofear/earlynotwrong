# Contributing to Early, Not Wrong

Thanks for taking the time to contribute. This project is a live trading agent + reputation marketplace, so we bias toward small, well-tested, reversible changes.

## Getting Started

1. Fork and clone the repository.
2. Install dependencies:
   ```bash
   npm install
   cd agent && npm install
   ```
3. Copy and fill environment variables:
   ```bash
   cp agent/.env.example agent/.env
   ```
4. Run the agent in simulator mode (no external credentials required):
   ```bash
   cd agent
   npm run build
   node dist/index.js
   ```

## Project Layout

- `agent/` — Autonomous trading agent (Node.js, TypeScript, Hono)
- `src/` — Next.js web app dashboard
- `casper/` — Odra smart contract for Casper Testnet
- `docs/` — Architecture and integration docs

See [`AGENTS.md`](../AGENTS.md) for the full module map and conventions.

## How to Contribute

1. Open an issue first for non-trivial changes so we can align on approach.
2. Keep PRs focused on one concern.
3. Add or update tests in `agent/__tests__/` for agent changes.
4. Run `npm run typecheck` and `npm run test` in the `agent/` directory before opening a PR.
5. For web app changes, run `npm run lint` and `npm run build` in the root.
6. Update relevant docs if behavior changes.

## Commit Style

We use conventional commits:

- `fix(agent): ...`
- `feat(web): ...`
- `docs: ...`

## Security

Never commit private keys, API secrets, or `.env` files. If you discover a security issue, please open a private issue or email the maintainers directly.

## Code Review

All PRs require review before merge. We look for:

- Correctness and test coverage
- Clear, minimal changes
- No new runtime dependencies without justification
- No leaked secrets or private data
