# Deploying to Aleo Testnet

This guide will help you deploy the `early_not_wrong_v1.aleo` contract to the Aleo Testnet.

## Current Deployment Info (Latest)

- **Program ID**: `early_not_wrong_v1.aleo`
- **Transaction ID**: `at1dp7ctsehz5rpfazvazegj7wzecw8u6f3zx2z7w8h067zr6wp5sqsvlwhk2`
- **Network**: Testnet (Provable)
- **Explorer**: [Verify on Provable Explorer](https://explorer.provable.com/transaction/at1dp7ctsehz5rpfazvazegj7wzecw8u6f3zx2z7w8h067zr6wp5sqsvlwhk2)

## Prerequisites

1.  **Leo CLI**: [Install the Leo CLI](https://developer.aleo.org/leo/installation) on your machine.
2.  **Aleo Wallet (Shield)**: Ensure you have an Aleo address with some testnet credits.
    -   You can get testnet credits from the Aleo Faucet or Discord.
3.  **Private Key**: You'll need your Aleo wallet's private key to sign the deployment transaction.

## 1. Configure Program

In `aleo/program.json`, ensure the following fields are correct:

```json
{
  "program": "conviction_index.aleo",
  "version": "0.1.0",
  "development": {
    "network": "testnet3",
    "private_key": "YOUR_PRIVATE_KEY",
    "address": "YOUR_ALEO_ADDRESS"
  }
}
```

*Note: Replace `YOUR_PRIVATE_KEY` and `YOUR_ALEO_ADDRESS` with your actual credentials. Be careful not to commit your private key to GitHub.*

## 2. Build and Test

Run these commands from the `aleo` directory:

```bash
# Compile the Leo contract
leo build

# Run built-in unit tests to verify logic
leo test
```

## 3. Deploy

Deploy the program to the Aleo Testnet:

```bash
leo deploy --network testnet3
```

Upon successful deployment, you will receive a Transaction ID. You can verify it on the [Aleo Explorer](https://explorer.aleo.org).

## 4. Update Frontend

The frontend uses the `CONVICTION_PROGRAM_ID` from `src/hooks/use-aleo-conviction.ts`.

```typescript
const CONVICTION_PROGRAM_ID = "early_not_wrong_v1.aleo";
```

## Leo v4 Notes (Current)

The Leo 4.0.0 migration requires:
-   **`fn` keyword**: All entry points must use `fn` instead of `transition`.
-   **`@noupgrade constructor()`**: Every program must have a constructor if deployed after Consensus Version 9.
-   **Tests**: Tests are now `@test fn` and should be in the `tests/` directory or a separate program block.
-   **Renamed Variables**: Keywords like `record` cannot be used as variable names.

## Troubleshooting

-   **Insufficient Credits**: Deployment requires fees. If you get a "not enough credits" error, visit the faucet.
-   **Program Name Taken**: If `conviction_index.aleo` is already taken, rename it in `program.json` and `main.leo` (e.g., `early_not_wrong_v1.aleo`).
