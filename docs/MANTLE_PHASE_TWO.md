# Mantle Phase Two Submission Plan

## Positioning

Early, Not Wrong is an AI conviction agent that analyzes trader behavior across Solana and Base, then anchors the agent's analysis on Mantle as a verifiable reputation record.

## Chain Roles

- Solana: Source chain for high-velocity wallet behavior and token exits.
- Base: Source chain for EVM wallet behavior, Ethos identity, and trading history.
- Mantle: Agent identity, proof-of-analysis anchoring, and reputation settlement.

## Primary Track

AI Alpha & Data.

Secondary fit: AI Trading & Strategy and Agentic Wallets & Economy.

## Demo Flow

1. Analyze a Solana or Base wallet.
2. Generate a deterministic thesis hash from the report.
3. Hash the analyzed subject as `<chain>:<wallet>`.
4. Anchor subject hash, thesis hash, score, and archetype to Mantle Sepolia.
5. Open the Mantle explorer transaction as proof.

## Before Submission

- Deploy `MantleConvictionRegistry` to Mantle Sepolia.
- Set `NEXT_PUBLIC_MANTLE_CONVICTION_REGISTRY`.
- Replace placeholders in `mantle/agent-card.json`.
- Publish the agent card to a stable URI.
- Record a demo with a real Mantle transaction hash.
