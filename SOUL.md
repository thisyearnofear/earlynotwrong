# SOUL.md — Design Philosophy & Architectural Soul

> The conviction behind the code.

## Identity

Early, Not Wrong is an AI agent that measures **behavioral conviction** in asymmetric markets.

The name is the thesis: the most expensive mistake in crypto isn't being wrong — it's selling winners too early. Losses are capped at −1×. Wins are uncapped. Conviction is tested not when you're wrong, but when you're *early*.

## Core Beliefs

### 1. Conviction ≠ Performance
Conviction is behavior under uncertainty. A trader can have excellent conviction and negative P&L. They can have lucky performance and terrible conviction. The Conviction Index measures *how* you trade, not *what* you made.

### 2. Early Is Not Wrong
Systematic early-exit behavior is the single largest destroyer of asymmetric upside. The app is built to surface this — not as judgment, but as self-knowledge.

### 3. Signal Over Noise
Every feature earns its place. No speculation, no price predictions, no hype. The dashboard is clinical and calm. Information is hierarchically structured, not densely packed.

### 4. Portable Reputation
Your conviction quality should travel with you across protocols, not stay locked inside a single app. Mantle anchors, Aleo private credentials, and Ethos attestations are all means to this end.

## Design Principles

### Data-First, Not UI-First
The conviction score is the star. Everything else — archetype badges, position explorer, cohort comparison, reputation tier — orbits around it. UI elements that don't serve the core insight get cut or degraded.

### Progressive Disclosure
Scan phase → technical terminal (for power users). Results phase → score card → breakdown dialog → position explorer. Information layers, not information dump.

### Calm Clinical Aesthetic
- Dark void (`#050505`) as default
- Electric cyan (`--signal`) for active state
- Clinical green (`--patience`) for correct behavior
- Amber (`--impatience`) for behavioral cost
- Glass panels with backdrop blur for depth
- Slow transitions (0.5s theme switch, staggered children)

### Anti-Surprise
- Toast for confirmations
- Error panel with retry/cached-data paths instead of silent failure
- Guardrails prevent trades before they happen (not after)
- Drawdown stops at 25% (data-driven, before 30% disqualification)

## Architecture Soul

### The Agent Is the Product
The trading agent is not a side feature — it's the core of the BNB Hack entry. The web app is its monitoring dashboard. This inverts the typical pattern (web app with a background job).

### REST API-First Data
CMC Pro REST API is the primary data source. No scraping, no webhooks, no on-chain indexers for market data. An API key provides authenticated access to global metrics, Fear & Greed, token quotes, and derivatives data (funding rates, open interest).

### Self-Custody, Not Custody
TWAK's Agent Wallet Mode means the agent never holds a private key. It submits signed intents; TWAK handles the signing. The operator key for Mantle is the only key the agent config needs.

### Testability Via Architecture
- Pure functions for conviction scoring
- Injected dependencies (cmcClient, twakExecutor are interface-based)
- Simulator mode for every external integration
- Guardrails are pure state machines

## What We Don't Build

- ❌ No trading signals or price predictions
- ❌ No social sentiment analysis
- ❌ No copy-trading (wallet-level, not strategy-level)
- ❌ No financial advice
- ❌ No unnecessary complexity

## Tone

Calm, clinical, contrarian. Minimalist, data-forward. No hype.

> "In asymmetric markets, conviction itself is a signal — but only if it's earned."
> "With portable ZK-proven reputation, that conviction travels with the trader."
