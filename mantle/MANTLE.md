# Mantle Phase II Deployment Guide

This directory contains the smart contracts and deployment scripts for the **Mantle Turing Test Hackathon 2026** Phase II workstream.

## Architecture Role

Early, Not Wrong uses Solana and Base as behavioral data source chains. Mantle is the settlement layer for AI-agent reputation: the ENW agent anchors a cross-chain subject hash, thesis hash, conviction score, and archetype to the Mantle registry.

## Prerequisites

1.  Navigate to this directory:
    ```bash
    cd mantle
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Set up your environment variables:
    ```bash
    cp env.example .env
    ```
    *Open `.env` and add your private key (with some Mantle Sepolia $MNT).*

## Deployment

To deploy the **MantleConvictionRegistry** to Mantle Sepolia:

```bash
npx hardhat run scripts/deploy.cjs --network mantle-sepolia
```

Alternatively, from the project root:

```bash
npm run mantle:deploy
```

## Verification

After deployment, verify the contract on the Mantle Explorer:

```bash
npx hardhat verify --network mantle-sepolia <DEPLOYED_CONTRACT_ADDRESS>
```

Add the deployed address to the app environment:

```bash
NEXT_PUBLIC_MANTLE_CONVICTION_REGISTRY=<DEPLOYED_CONTRACT_ADDRESS>
```

Current Mantle Sepolia deployment:

```text
0xBd93c9fd88d7D3D5a7b64b24C137f3666E287121
```

This version uses an owner-managed operator allowlist. The deployer is authorized in the constructor, and the owner can authorize additional ENW agent/operator wallets with `setOperatorAuthorization`.

Automated Hardhat verification currently receives an HTML response from the Mantle Explorer API. The manual explorer UI was also blocked by Cloudflare in the agent environment. If that persists, verify manually in a normal browser session using the Solidity source in `contracts/MantleConvictionRegistry.sol`.

## ERC-8004 Registration

Once the contract is deployed, use the `agent-card.json` file in this directory to register your agent on the Mantle Identity Registry.

1.  Upload `agent-card.json` to IPFS.
2.  Update the `agentURI` in your registration script or call the `registerAgent` function on the Mantle Registry (`0x8004A...`).

## Contracts

- `contracts/MantleConvictionRegistry.sol`: Anchors conviction scores and behavioral insights on-chain.
