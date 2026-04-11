### Security Model & Production Hardening

"Early, Not Wrong" takes privacy and security seriously. This document outlines our current security implementation and the recommended steps for transitioning to a production-grade environment.

---

### 🛡️ Current Security Measures (Buildathon Mode)

1.  **Selective Disclosure:** All on-chain behavioral metrics are verified using Zero-Knowledge proofs. We never store raw transaction history or balances on Aleo; only the resulting "Proof of Character" (Archetypes/Conviction Index).
2.  **Server-Side Secret Management:** Sensitive operations (like stablecoin rebates) are performed on the server-side (`/api/aleo/rebate`). Private keys are **never** exposed to the client-side browser environment.
3.  **Local Environment Protection:** All sensitive credentials (mnemonic, private keys) are stored in `.env.local`, which is strictly ignored by Git to prevent accidental exposure in the repository history.
4.  **Treasury Encapsulation:** The `AleoTreasury` service (`src/lib/aleo/treasury.ts`) centralizes all treasury logic, implementing safety limits (max rebate per request) and format validation.

---

### 🚀 Production Hardening Recommendations

For a production deployment with a high-value treasury, we recommend the following enhancements:

#### 1. Hardware Security Modules (HSM) & KMS
Instead of loading the `ALEO_PRIVATE_KEY` into the application memory, use a Key Management Service (AWS KMS, GCP KMS, or HashiCorp Vault):
- **Signer Pattern:** Use the Aleo SDK's ability to use a custom `Signer` that delegates the signing operation to an HSM. The private key remains inside the secure hardware and is never accessible to the application code.

#### 2. Multi-Signature Treasury
Transition the treasury from a single-key account to a multi-signature program on Aleo:
- Require multiple authorized signers to approve high-value transactions or rebate pool replenishments.

#### 3. Secret Injection via Vault
Use a dedicated secret manager like **HashiCorp Vault** or **Vercel Secrets** for dynamic secret injection:
- This provides audit logs for every time a secret is accessed and allows for easy rotation without redeploying code.

#### 4. Rate Limiting & Fraud Detection
Implement aggressive rate limiting on the `/api/aleo/rebate` endpoint to prevent "drainage" attacks:
- Use Redis-based rate limiting.
- Add behavioral checks (e.g., verifying the user's Ethos score has not dropped significantly before sending a rebate).

#### 5. Trusted Execution Environments (TEE)
Run the Treasury Service inside a TEE (like Intel SGX or AWS Nitro Enclaves) to ensure that the execution logic and the keys are protected from even the host operating system.

---

### ⚠️ A Note on Environment Variables
Storing secrets in `process.env` is standard for development but carries risks in production (e.g., exposure via logs or process dumps). Always use a dedicated Secret Management solution for live deployments.
