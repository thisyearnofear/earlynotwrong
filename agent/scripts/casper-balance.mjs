/**
 * casper-balance.mjs — one-shot operator balance + account info check.
 *
 * Uses the same RPC fallback chain as the anchoring adapter (public node
 * first, cspr.cloud fallback). Run from agent/:
 *
 *   set -a && . ./.env && set +a && node scripts/casper-balance.mjs
 */

import casperSdk from "casper-js-sdk";
const { PrivateKey, KeyAlgorithm, HttpHandler, RpcClient } = casperSdk;
import { readFileSync } from "node:fs";

const PEM_PATH = process.env.CASPER_OPERATOR_PEM;
const ALGO = process.env.CASPER_OPERATOR_ALGORITHM === "secp256k1" ? KeyAlgorithm.SECP256K1 : KeyAlgorithm.ED25519;
const TOKEN = process.env.CSPR_CLOUD_TOKEN || "";

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

console.log("Public key hex:", pubKey.toHex());

try {
  const ah = casperSdk.AccountHash.fromPublicKey(pubKey);
  console.log("Account hash hex:", ah.toHex());
} catch (e) {
  console.error("AccountHash error:", e.message || e);
}

const rpc = buildClient();

try {
  const balance = await rpc.queryBalance({ purseIdentifier: { mainPurse: casperSdk.AccountHash.fromPublicKey(pubKey) } });
  console.log("Balance (motes):", balance?.toString?.() ?? balance);
  console.log("Balance (CSPR):", (Number(balance) / 1e9).toFixed(4));
} catch (e) {
  console.error("Balance error:", e.message || e);
}

try {
  const info = await rpc.getEntity({ entity: pubKey });
  console.log("Account nonce:", info?.entity?.Account?.nonce);
} catch (e) {
  console.error("Entity error:", e.message || e);
}
