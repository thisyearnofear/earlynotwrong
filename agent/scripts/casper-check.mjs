/**
 * casper-check.mjs — operator balance + contract package diagnostics.
 *
 * Uses the same RPC fallback chain as the anchoring adapter (public node
 * first, cspr.cloud fallback). Run from agent/:
 *
 *   set -a && . ./.env && set +a && node scripts/casper-check.mjs
 */

import casperSdk from "casper-js-sdk";
const { PrivateKey, KeyAlgorithm, HttpHandler, RpcClient } = casperSdk;
import { readFileSync } from "node:fs";

const PEM_PATH = process.env.CASPER_OPERATOR_PEM;
const ALGO = process.env.CASPER_OPERATOR_ALGORITHM === "secp256k1" ? KeyAlgorithm.SECP256K1 : KeyAlgorithm.ED25519;
const TOKEN = process.env.CSPR_CLOUD_TOKEN || "";
const PKG_HASH = process.env.CASPER_REGISTRY_HASH;

// Same fallback chain as AGENT_CONFIG.casper.testnet.rpcUrls.
const RPC_URLS = [
  "https://node.testnet.casper.network/rpc",
  "https://node.testnet.cspr.cloud/rpc",
];

function buildClient() {
  for (const url of RPC_URLS) {
    try {
      const handler = new HttpHandler(url);
      if (url.includes("cspr.cloud") && TOKEN) {
        handler.setCustomHeaders({ Authorization: TOKEN });
      }
      return new RpcClient(handler);
    } catch { continue; }
  }
  throw new Error("No reachable Casper RPC endpoint");
}

if (!PEM_PATH) {
  console.error("Missing env: CASPER_OPERATOR_PEM");
  process.exit(1);
}

const key = PrivateKey.fromPem(readFileSync(PEM_PATH, "utf-8"), ALGO);
const pubKey = key.publicKey;
const accountHash = pubKey.toAccountHash();
const accountHex = Buffer.from(accountHash).toString("hex");

console.log("Operator public key:", pubKey.toHex());
console.log("Operator account hash:", accountHex);

const rpc = buildClient();

try {
  const stateRoot = await rpc.getStateRootHash();
  console.log("State root:", stateRoot);

  const balance = await rpc.queryBalance({ purseIdentifier: { mainPurse: accountHash } });
  console.log("Balance (motes):", balance?.toString?.() ?? balance);
  const balanceCSPR = Number(balance) / 1e9;
  console.log("Balance (CSPR):", balanceCSPR.toFixed(4));

  const accountInfo = await rpc.getEntity({ entity: pubKey });
  console.log("Account nonce:", accountInfo?.entity?.Account?.nonce);

  if (PKG_HASH) {
    const pkgKey = "package-" + PKG_HASH.replace(/^0x/, "");
    const pkg = await rpc.getEntity({ entity: { Package: pkgKey } });
    console.log("Package versions:", JSON.stringify(pkg?.entity?.Package?.versions?.map(v => ({ hash: v.contract_hash, status: v.contract_status }))));
  }
} catch (err) {
  console.error("RPC error:", err.message || err);
}
