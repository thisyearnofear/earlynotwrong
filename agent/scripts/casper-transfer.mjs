/**
 * casper-transfer.mjs — one-shot native CSPR transfer on Casper Testnet.
 *
 * Usage:
 *   set -a && . ./.env && set +a
 *   CASPER_RECIPIENT=<public-key-hex> CASPER_AMOUNT_MOTES=<motes> \
 *     node scripts/casper-transfer.mjs
 *
 * The amount is in motes (1 CSPR = 1e9 motes). Includes a 100 CSPR payment
 * buffer for the transfer's own gas cost.
 *
 * No --apply / --confirm flag — the operator was explicit at invocation.
 * For destructive scripts in interactive contexts add one.
 */

import casperSdk from "casper-js-sdk";
const {
  HttpHandler,
  KeyAlgorithm,
  NativeTransferBuilder,
  PrivateKey,
  PublicKey,
  RpcClient,
} = casperSdk;
import { readFileSync } from "node:fs";

const RPC_URL = "https://node.testnet.cspr.cloud/rpc";
const CHAIN_NAME = "casper-test";
// Native transfers are cheap; 100 CSPR is generous headroom.
const PAYMENT_MOTES = 100_000_000_000;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const token = process.env.CSPR_CLOUD_TOKEN;
  const pemPath = process.env.CASPER_OPERATOR_PEM;
  const recipientHex = process.env.CASPER_RECIPIENT;
  const amountMotes = process.env.CASPER_AMOUNT_MOTES;

  if (!token) fail("CSPR_CLOUD_TOKEN not set");
  if (!pemPath) fail("CASPER_OPERATOR_PEM not set");
  if (!recipientHex) fail("CASPER_RECIPIENT not set (target public key hex)");
  if (!amountMotes) fail("CASPER_AMOUNT_MOTES not set");

  const algo =
    process.env.CASPER_OPERATOR_ALGORITHM === "secp256k1"
      ? KeyAlgorithm.SECP256K1
      : KeyAlgorithm.ED25519;
  const senderKey = PrivateKey.fromPem(readFileSync(pemPath, "utf-8"), algo);
  const recipientPub = PublicKey.fromHex(recipientHex);

  console.log(`From:     ${senderKey.publicKey.toHex()}`);
  console.log(`To:       ${recipientPub.toHex()}`);
  console.log(`Amount:   ${BigInt(amountMotes).toLocaleString()} motes (${(Number(amountMotes) / 1e9).toFixed(2)} CSPR)`);
  console.log(`Payment:  ${PAYMENT_MOTES.toLocaleString()} motes (${(PAYMENT_MOTES / 1e9).toFixed(0)} CSPR) gas`);

  const transaction = new NativeTransferBuilder()
    .from(senderKey.publicKey)
    .target(recipientPub)
    .amount(amountMotes)
    .chainName(CHAIN_NAME)
    .payment(PAYMENT_MOTES)
    .build();

  transaction.sign(senderKey);

  const handler = new HttpHandler(RPC_URL);
  handler.setCustomHeaders({ Authorization: token });
  const rpc = new RpcClient(handler);

  console.log("\nSubmitting...");
  const result = await rpc.putTransaction(transaction);
  const txHash =
    result.transactionHash?.transactionV1?.toHex?.() ??
    result.transactionHash?.deploy?.toHex?.() ??
    "<unknown>";

  console.log("");
  console.log("✓ Submitted");
  console.log(`  Tx:       ${txHash}`);
  console.log(`  Explorer: https://testnet.cspr.live/deploy/${txHash}`);
  console.log("\nWait ~30s for inclusion, then check the explorer link.");
}

main().catch((err) => {
  console.error("✗", err.message || err);
  process.exit(1);
});
