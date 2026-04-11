# Early, Not Wrong: Privacy Model (Aleo x ZK)

## Problem: The Reputation Dilemma
In traditional Web3, building a reputation as a "skilled trader" or "high-conviction holder" requires exposing your entire wallet history. This creates a trade-off:
1. **Public Identity**: Build trust but expose your strategies, alpha, and net worth to front-running and surveillance.
2. **Anonymous Identity**: Preserve privacy but lack the credentials to prove your skill to investors or communities.

## Solution: Zero-Knowledge Selective Disclosure
"Early, Not Wrong" uses **Aleo** to decouple *behavioral verification* from *wallet identity*. 

### 1. Private Metric Commitment
When a user analyzes their Solana or Base wallet, we compute their **Conviction Index (CI)**. Instead of posting these metrics to a public ledger, the user "mints" a private **Aleo Record**.
- **Program**: `conviction_index.aleo`
- **Record**: `ConvictionRecord`
- **Fields (Encrypted)**: `score`, `patience_tax`, `archetype`, `timestamp`.

### 2. Selective Disclosure (ZK-Proofs)
Once the record is in the user's Shield Wallet, they can generate **Zero-Knowledge Proofs** for specific predicates without revealing the underlying data.

| Proof Type | Predicate | Use Case |
|------------|-----------|----------|
| **Archetype Verification** | `assert(record.archetype == required_archetype)` | Gating access to specific "Diamond Hand" or "Iron Pillar" social circles. |
| **Elite Score Proof** | `assert(record.score >= 80)` | Proving you are a top-tier trader without revealing your exact score. |
| **Efficiency Proof** | `assert(record.patience_tax <= 1000)` | Proving disciplined execution without revealing the total volume of trades. |

### 3. Architecture Overview
1. **Frontend**: Analyzes public chain history (Solana/Base).
2. **Shield Wallet**: Acts as the secure vault for private behavioral records.
3. **Leo Smart Contract**: Defines the rules for record issuance and verification.
4. **On-Chain Verification**: Third parties (or our own backend) can verify the `TX_ID` of a proof to confirm the user meets the criteria.

## Why Aleo?
- **Off-chain Execution**: Proofs are generated locally in the user's browser/wallet, ensuring the raw metrics never leave their device.
- **Privacy by Default**: Unlike EVM-based privacy solutions, data is hidden unless explicitly disclosed.
- **Composability**: Private reputation can be used as a "ZK-Credential" for other Aleo-based DeFi protocols (e.g., undercollateralized lending based on conviction).

---
*Built for the Aleo Privacy Buildathon 2026*
