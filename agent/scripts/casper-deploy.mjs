/**
 * casper-deploy.mjs — Install the ConvictionRegistry WASM on Casper Testnet.
 *
 * Lives in agent/scripts/ so it shares the agent's casper-js-sdk install.
 * The WASM artifact itself is produced by the Rust workspace at casper/wasm/.
 *
 * Prereqs:
 *   1. `cd ../casper && cargo odra build` produces casper/wasm/ConvictionRegistry.wasm
 *   2. CSPR_CLOUD_TOKEN      — cspr.cloud auth token (free tier sign-up)
 *   3. CASPER_OPERATOR_PEM   — path to operator Ed25519 .pem
 *   4. Operator account funded via https://testnet.cspr.live faucet
 *
 * Usage:
 *   set -a && . ./.env && set +a
 *   node scripts/casper-deploy.mjs
 *
 * Output: a deploy hash + the contract hash to add to AGENT_CONFIG /env.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// casper-js-sdk ships CJS — default import + destructure works under ESM.
import casperSdk from "casper-js-sdk";
const {
  Args,
  CLValue,
  HttpHandler,
  KeyAlgorithm,
  PrivateKey,
  RpcClient,
  SessionBuilder,
} = casperSdk;

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = "https://node.testnet.cspr.cloud/rpc";
const CHAIN_NAME = "casper-test";
// 1000 CSPR (motes = 1e-9 CSPR). 200 CSPR ran out of gas for our ~280KB
// install — Casper's WASM execution cost scales with bytecode size and
// our contract has more storage primitives than the flipper template.
// Testnet faucet gives 5000 CSPR so we have plenty of headroom here.
const DEPLOY_PAYMENT_MOTES = 500_000_000_000;
const WASM_PATH = resolve(__dirname, "..", "..", "casper", "wasm", "ConvictionRegistry.wasm");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const token = process.env.CSPR_CLOUD_TOKEN;
  const pemPath = process.env.CASPER_OPERATOR_PEM;
  if (!token) fail("CSPR_CLOUD_TOKEN not set");
  if (!pemPath) fail("CASPER_OPERATOR_PEM not set");

  console.log(`Loading WASM from ${WASM_PATH}`);
  let wasm;
  try {
    wasm = readFileSync(WASM_PATH);
  } catch {
    fail(`WASM not found — run \`cd casper && cargo odra build\` first`);
  }
  console.log(`  ${wasm.byteLength.toLocaleString()} bytes`);

  console.log(`Loading operator key from ${pemPath}`);
  const algo =
    process.env.CASPER_OPERATOR_ALGORITHM === "secp256k1"
      ? KeyAlgorithm.SECP256K1
      : KeyAlgorithm.ED25519;
  const key = PrivateKey.fromPem(readFileSync(pemPath, "utf-8"), algo);
  console.log(`  Operator: ${key.publicKey.toHex()}`);

  // Odra's contract installer reads four `odra_cfg_*` args during install.
  // `cargo odra` and the Livenet backend inject these automatically; we
  // submit via the SDK directly so we set them here. Documented at
  // https://odra.dev/docs/backends/casper#deploying-the-contract.
  //
  //  - package_hash_key_name: the named-key the package hash is stored under
  //    (also the prefix for the contract's named keys).
  //  - allow_key_override:    overwrite an existing named key with the same name.
  //  - is_upgradable:         keep upgrade authority for the deployer.
  //  - is_upgrade:            false = fresh install, true = re-deploy.
  const PACKAGE_HASH_NAME = process.env.CASPER_PACKAGE_NAME || "conviction_registry";
  const runtimeArgs = Args.fromMap({
    odra_cfg_package_hash_key_name: CLValue.newCLString(PACKAGE_HASH_NAME),
    odra_cfg_allow_key_override: CLValue.newCLValueBool(false),
    odra_cfg_is_upgradable: CLValue.newCLValueBool(true),
    odra_cfg_is_upgrade: CLValue.newCLValueBool(false),
  });

  console.log(
    `Building install transaction — payment ${DEPLOY_PAYMENT_MOTES.toLocaleString()} motes (≈ ${(DEPLOY_PAYMENT_MOTES / 1e9).toFixed(0)} CSPR)`,
  );
  const transaction = new SessionBuilder()
    .from(key.publicKey)
    .wasm(new Uint8Array(wasm))
    .installOrUpgrade()
    .runtimeArgs(runtimeArgs)
    .chainName(CHAIN_NAME)
    .payment(DEPLOY_PAYMENT_MOTES)
    .build();

  transaction.sign(key);

  console.log("Submitting to cspr.cloud...");
  const handler = new HttpHandler(RPC_URL);
  handler.setCustomHeaders({ Authorization: token });
  const rpc = new RpcClient(handler);

  const result = await rpc.putTransaction(transaction);
  const txHash =
    result.transactionHash?.transactionV1?.toHex?.() ??
    result.transactionHash?.deploy?.toHex?.() ??
    "<unknown>";

  console.log("");
  console.log("✓ Submitted!");
  console.log(`  Tx hash:  ${txHash}`);
  console.log(`  Explorer: https://testnet.cspr.live/deploy/${txHash}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Wait ~30s for inclusion at the explorer URL.");
  console.log("  2. From the explorer, copy the installed contract hash.");
  console.log("  3. Set CASPER_REGISTRY_HASH=<hash> in agent/.env on the VPS.");
  console.log("  4. Restart the agent — Casper anchoring fires next cycle.");
}

main().catch((err) => {
  console.error(`✗ Deploy failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
