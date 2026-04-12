# Aleo ZK-Privacy Demo Script: Early, Not Wrong

## Overview
This document provides a step-by-step script for demonstrating the **Aleo-First Privacy Integration** of the Early, Not Wrong platform. The demo showcases how users can bridge their behavioral data from public chains (Solana/Base) to private, verifiable Zero-Knowledge (ZK) records on Aleo.

## Demo Objectives
- **Shield Wallet Integration**: Show seamless login via Aleo’s most advanced ZK-wallet.
- **ZK-Conviction Index (ZK-CI)**: Mint private behavioral metrics as on-chain Aleo records.
- **Selective Disclosure**: Generate ZK-proofs for specific traits without revealing full wallet data.
- **Private Strategist Mode**: Commit encrypted trade intents (theses) to the Aleo blockchain.
- **Hardened Rebate Model**: Demonstrate the "Pull" model (Signed Vouchers) for behavioral rebates.

## Demo Setup
1.  **Shield Wallet**: Ensure the extension is installed and funded with Aleo Testnet credits.
2.  **Treasury Account**: Ensure the platform's treasury has credits to cover signed voucher claims.
3.  **Target Wallet**: Have a Solana/Base wallet with trading history ready for initial analysis.

## Demo Flow

### 1. Introduction (30 seconds)
"Welcome to Early, Not Wrong—the reputation-native platform for the private internet. Today, we'll demonstrate how we use the Aleo blockchain to turn public behavioral data into private, verifiable ZK-reputation. We bridge the gap between transparency and privacy using Leo smart contracts."

### 2. ZK-Onboarding & Shield Wallet (1 minute)
- Click the **"Sign In"** button in the navbar.
- Select the **Shield Wallet** from the provider list.
- **Highlight**: "We prioritize the Shield Wallet to ensure our users benefit from the latest improvements in Aleo’s developer and user experience."
- Show the **"Shield Protected"** badge appearing in the UI once connected.
- Point out the **Aleo Network Status** (Testnet) indicator.

### 3. Minting Your ZK-CI (1 minute)
- Perform a wallet scan for a Solana/Base address in the **"Analyzer"** tab.
- Once results appear, scroll to the **Aleo Conviction Card**.
- Click **"Mint ZK-CI"**.
- **Explain**: "We are taking the calculated Conviction Index and committing it to the Aleo blockchain as a private record. This record belongs only to you and is hidden by default from everyone else."
- Confirm the transaction in the Shield Wallet.

### 4. Selective Disclosure & Proof Generation (1 minute)
- Click **"Generate Proof"** on the minted ZK-CI card.
- Select a specific attribute to disclose (e.g., **"Prove I am a 'Diamond Hand' archetype"**).
- **Explain**: "This is the 'Gold Standard' of ZK. I am proving I have this specific high-reputation trait without revealing my actual balance, my transaction volume, or even my wallet address."
- Generate the proof and show the **"Verify Proof Status"** link to the Provable Explorer.

### 5. Private Strategist Mode (1 minute)
- Switch to the **"Strategist"** tab.
- Enter a trade thesis (e.g., "Accumulating $SOL based on 4H support flip").
- Click **"Commit Private Thesis"**.
- **Explain**: "In the Strategist mode, traders can commit their intents to Aleo as encrypted records. This prevents front-running and copy-trading while creating a verifiable trail of their decision-making process."
- Show the transaction success message.

### 6. Hardened "Pull" Rebate Flow (1 minute)
- Scroll to the **"Premium Alpha"** section.
- Click **"Claim Patience Rebate"**.
- **First Step (Authorize)**: Show the API call to the backend. "The platform verifies your behavioral eligibility and issues a cryptographically signed voucher."
- **Second Step (Claim)**: Confirm the on-chain claim in the Shield Wallet.
- **Technical Highlight**: "We use a 'Pull' model. The platform never holds your private keys or executes on your behalf. You use the signed voucher to claim your rebate directly from the `early_not_wrong_v3.aleo` contract."

### 7. Technical Architecture for Judges (30 seconds)
- Point to the **Leo Smart Contract** structure in the docs.
- Mention the use of **`signature::verify`** for replay protection and security.
- Highlight the **Provable SDK** integration for server-side voucher signing.
- Mention the **USDCx** integration plan for private stablecoin payouts.

## Key Talking Points

### Why Aleo?
- **Offchain Execution**: Complex behavioral analysis is verified publicly but computed privately.
- **Encrypted State**: Reputation data is hidden by default.
- **Composability**: Our private contracts are ready to interact with DeFi protocols for undercollateralized lending.

### User Benefits
- **Reputation Without Exposure**: Build a high-value profile without being doxxed.
- **Anti-Frontrunning**: Protect your edge by encrypting your strategy.
- **Selective Disclosure**: Share only what is necessary for a specific opportunity.

### Real-World Use Cases
- **Private Alpha Groups**: Join based on verified skill, not just a high balance.
- **ZK-Undercollateralized Lending**: Prove creditworthiness via your Conviction Index.
- **Institutional Compliance**: Selective disclosure for auditors without leaking strategies.

## Technical Details (For Judges)
- **Program ID**: `early_not_wrong_v3.aleo`
- **Language**: Leo v4.0.0
- **Privacy Model**: Decoupled Data Layer (Public) and Reputation Layer (Aleo ZK).
- **Security**: Signed Voucher model eliminates platform spending-key risk.

## Conclusion
"Early, Not Wrong isn't just a demo; it's a production-ready infrastructure for the private internet. By leveraging Aleo, we ensure that in the era of mass data collection, your reputation belongs to you—and only you. Join us in making privacy the default."

## Demo Tips
- **Pre-Minted Record**: Have a wallet that already has a minted ZK-CI to save time during the 10-day build cycles.
- **Explorer Links**: Keep the Provable Explorer open to show the "Accepted" transaction status of the v3 contract.
- **Emphasize the 'Aha!' Moment**: When generating a proof, explicitly state: "My identity is hidden, my balance is hidden, but my skill is proven."