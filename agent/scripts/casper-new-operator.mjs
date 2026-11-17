/**
 * casper-new-operator.mjs — Generate a fresh Casper operator keypair.
 *
 * Why this exists: the Casper testnet faucet is ONE-SHOT (5,000 CSPR once
 * per account, ever — repeat requests revert with `User error: 1`). When an
 * operator key is drained, the sanctioned path is a new account + new faucet
 * claim. This script creates the keypair and prints exactly what to update.
 *
 * Usage:
 *   node scripts/casper-new-operator.mjs [path-to-write-pem] [--force]
 *
 * Default PEM path: agent/data/casper-operator-<pubkey-prefix>.pem
 * (agent/data/ is gitignored — the key never leaves the disk).
 *
 * After running:
 *   1. Fund the printed public key at https://testnet.cspr.live/tools/faucet
 *   2. Update CASPER_OPERATOR_PEM=<path> in agent/.env
 *   3. Restart the agent — anchoring resumes next cycle.
 *
 * NOTE: a new operator means a new `anchored_by` on future records. On-chain
 * history stays attributed to the old account — the subject_hash (reputation
 * identity) is unchanged, so reads are unaffected.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// casper-js-sdk ships CJS — default import + destructure works under ESM.
import casperSdk from "casper-js-sdk";
const { KeyAlgorithm, PrivateKey } = casperSdk;

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--force");
  const force = process.argv.includes("--force");
  const algo =
    process.env.CASPER_OPERATOR_ALGORITHM === "secp256k1"
      ? KeyAlgorithm.SECP256K1
      : KeyAlgorithm.ED25519;

  const key = PrivateKey.generate(algo);
  const publicKeyHex = key.publicKey.toHex();
  const accountHash = key.publicKey.accountHash().toHex();

  const pemPath = args[0]
    ? resolve(args[0])
    : resolve(__dirname, "..", "data", `casper-operator-${publicKeyHex.slice(0, 10)}.pem`);

  if (existsSync(pemPath) && !force) {
    console.error(`Refusing to overwrite existing key: ${pemPath}`);
    console.error("Pass --force if you really want to replace it.");
    process.exit(1);
  }

  mkdirSync(dirname(pemPath), { recursive: true });
  writeFileSync(pemPath, key.toPem(), { mode: 0o600 });

  console.log("✓ New operator keypair generated\n");
  console.log(`  Algorithm:     ${algo === KeyAlgorithm.SECP256K1 ? "secp256k1" : "ed25519"}`);
  console.log(`  Public key:    ${publicKeyHex}`);
  console.log(`  Account hash:  ${accountHash}`);
  console.log(`  PEM written:   ${pemPath} (mode 600)\n`);
  console.log("Next steps:");
  console.log(`  1. Fund it:    https://testnet.cspr.live/tools/faucet (paste the public key; one-shot, 5,000 CSPR)`);
  console.log(`  2. Update env: CASPER_OPERATOR_PEM=${pemPath}`);
  console.log(`  3. Restart:    pm2 restart earlynotwrong\n`);
}

main();
