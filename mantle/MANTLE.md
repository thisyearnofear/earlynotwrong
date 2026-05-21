# Mantle Phase II Deployment Guide

This directory contains the smart contracts and deployment scripts for the **Mantle Turing Test Hackathon 2026**.

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
    cp .env.example .env
    ```
    *Open `.env` and add your private key (with some Mantle Sepolia $MNT).*

## Deployment

To deploy the **MantleConvictionRegistry** to Mantle Sepolia:

```bash
npx hardhat run scripts/deploy.ts --network mantle-sepolia
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

## ERC-8004 Registration

Once the contract is deployed, use the `agent-card.json` file in this directory to register your agent on the Mantle Identity Registry.

1.  Upload `agent-card.json` to IPFS.
2.  Update the `agentURI` in your registration script or call the `registerAgent` function on the Mantle Registry (`0x8004A...`).

## Contracts

- `contracts/MantleConvictionRegistry.sol`: Anchors conviction scores and behavioral insights on-chain.
