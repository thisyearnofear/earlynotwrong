/**
 * casper-smoke.mjs — one-shot end-to-end test of the Casper adapter.
 *
 * Calls anchor_conviction on the deployed registry with a fixed test record
 * to verify: PEM load + ContractCallBuilder + cspr.cloud RPC + entry-point
 * execution all wired correctly. Use after deploy + before pushing to the VPS.
 *
 * Run from agent/: set -a && . ./.env && set +a && node scripts/casper-smoke.mjs
 */

import casperSdk from "casper-js-sdk";
const {
  Args,
  CLTypeUInt8,
  CLValue,
  ContractCallBuilder,
  HttpHandler,
  KeyAlgorithm,
  PrivateKey,
  RpcClient,
} = casperSdk;

/** Build a CLList<U8> from a 32-byte hex string — matches Odra's
 *  `casper_types::bytesrepr::Bytes` parameter type (CLType::List(U8)).
 *  CLByteArray(N) has a different CLType (ByteArray(N)) and won't deserialize. */
function bytesArg(hex) {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length !== 64) throw new Error(`expected 64 hex chars, got ${s.length}`);
  const u8s = [];
  for (let i = 0; i < 32; i++) u8s.push(CLValue.newCLUint8(parseInt(s.slice(i * 2, i * 2 + 2), 16)));
  return CLValue.newCLList(CLTypeUInt8, u8s);
}
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const RPC_URL = "https://node.testnet.cspr.cloud/rpc";
const CHAIN_NAME = "casper-test";
const PAYMENT_MOTES = 50_000_000_000; // 50 CSPR — generous for one entry-point call

function hexToBytes32(hex) {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length !== 64) throw new Error(`expected 64 hex chars, got ${s.length}`);
  return Uint8Array.from(Buffer.from(s, "hex"));
}

function keccakLike(input) {
  // Casper-side we accept any 32-byte digest; SHA-256 is fine for the smoke test.
  return createHash("sha256").update(input).digest("hex");
}

async function main() {
  const token = process.env.CSPR_CLOUD_TOKEN;
  const pem = process.env.CASPER_OPERATOR_PEM;
  const contractHash = process.env.CASPER_REGISTRY_HASH;
  if (!token || !pem || !contractHash) {
    console.error("Missing env: CSPR_CLOUD_TOKEN, CASPER_OPERATOR_PEM, CASPER_REGISTRY_HASH");
    process.exit(1);
  }

  const algo = process.env.CASPER_OPERATOR_ALGORITHM === "secp256k1" ? KeyAlgorithm.SECP256K1 : KeyAlgorithm.ED25519;
  const key = PrivateKey.fromPem(readFileSync(pem, "utf-8"), algo);
  console.log("Operator:", key.publicKey.toHex());
  console.log("Registry:", contractHash);

  const subjectHash = keccakLike("smoke:bsc:0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a");
  const thesisHash = keccakLike(JSON.stringify({ smoke: true, ts: Date.now() }));

  const args = Args.fromMap({
    subject_hash: bytesArg(subjectHash),
    thesis_hash: bytesArg(thesisHash),
    conviction_score: CLValue.newCLUint8(85),
    archetype: CLValue.newCLString("SMOKE TEST"),
    timestamp: CLValue.newCLUint64(BigInt(Date.now())),
  });

  // Odra installs under a package; use byPackageHash so the runtime resolves
  // to the latest installed version. byHash expects the entity hash, which
  // changes on every upgrade.
  const transaction = new ContractCallBuilder()
    .from(key.publicKey)
    .byPackageHash(contractHash)
    .entryPoint("anchor_conviction")
    .runtimeArgs(args)
    .chainName(CHAIN_NAME)
    .payment(PAYMENT_MOTES)
    .build();

  transaction.sign(key);

  const handler = new HttpHandler(RPC_URL);
  handler.setCustomHeaders({ Authorization: token });
  const rpc = new RpcClient(handler);

  const result = await rpc.putTransaction(transaction);
  const txHash = result.transactionHash?.transactionV1?.toHex?.()
    ?? result.transactionHash?.deploy?.toHex?.()
    ?? "<unknown>";

  console.log("\n✓ Submitted");
  console.log("  Tx:", txHash);
  console.log("  Explorer:", `https://testnet.cspr.live/deploy/${txHash}`);
  console.log("\nWait ~30s, then query info_get_transaction to confirm execution.");
}

main().catch((err) => {
  console.error("✗", err.message || err);
  process.exit(1);
});
