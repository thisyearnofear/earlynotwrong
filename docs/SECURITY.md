# Early, Not Wrong: Security Model

To protect user privacy and platform integrity, "Early, Not Wrong" implements a multi-layered security model centered on Aleo's zero-knowledge capabilities and a hardened treasury architecture.

## 1. Zero-Knowledge Private Records
User behavioral metrics (Conviction Index, Score, Archetype) are never stored on a centralized server.
- **Local Analysis**: Raw transaction data from Solana or Base is processed in the browser.
- **Shielded Issuance**: Final metrics are "minted" as private Aleo records (`ConvictionRecord`). Once minted, the data only exists in the user's **Shield Wallet**.
- **No Platform Custody**: The platform has no "admin key" to decrypt or view a user's metrics once they are on-chain.

## 2. Hardened Treasury: The 'Pull' (Signed Voucher) Model
Traditional platforms often use a "Push" model where the server holds a private key to send rewards. This is a high-risk centralization point. "Early, Not Wrong" uses a **'Pull' model** to eliminate this risk.

### How it Works:
1. **Request**: A user requests a behavioral rebate after proving their efficiency.
2. **Authorize (Off-Chain)**: Our backend verifies the proof and eligibility. It then generates a **Signed Voucher**—a message containing the `recipient`, `amount`, and a unique `nonce`, signed by the treasury's private key.
3. **Claim (On-Chain)**: The user receives the voucher and submits it to the `early_not_wrong_v3.aleo` smart contract's `claim_rebate` function.
4. **Verify & Release**: The smart contract verifies the treasury's signature using `signature::verify`. If valid, it releases the funds from the program's balance to the user.

### Replay Protection:
The smart contract maintains a public `used_vouchers` mapping. Each voucher's unique hash (based on the nonce) is stored upon redemption. Any attempt to "double-claim" a voucher will be rejected by the contract.

## 3. Deployment & Infrastructure
- **Server-Side Safety**: The treasury private key is stored in a secure environment variable (`ALEO_PRIVATE_KEY`) and is only used for signing vouchers, never for direct on-chain execution.
- **Network Resilience**: We use the **Provable Network (Aleo Testnet)** with multiple API endpoints for high availability.
- **Future Hardening**:
    - **Cloud KMS**: Transitioning to AWS/GCP KMS to sign vouchers without exposing the private key to the application memory.
    - **Multi-Sig**: Implementing a 2-of-3 multi-signature governance for large treasury reloads.

## 4. Privacy-Preserving Strategy
By hashing trade intents before they are committed to the `PrivateThesis` record, we ensure that:
- Users have a timestamped proof of their alpha.
- No third party (including the platform) can see the strategy until the user chooses to reveal it.
- Competitive advantage is preserved from MEV and copy-trading bots.

---
*Built for the Aleo Privacy Buildathon 2026*
