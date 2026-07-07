/**
 * Generate a fresh EVM wallet for CROO whitelist / test access.
 *
 * Writes CROO_WALLET_KEY and CROO_WALLET_ADDRESS to agent/.env
 * and prints only the public address to stdout.
 *
 * Usage:
 *   node agent/scripts/generate-croo-wallet.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dirname, "../.env");

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

let env = "";
try {
  env = await readFile(envPath, "utf-8");
} catch {
  // .env does not exist yet
}

const lines = env.split("\n").filter((line) => {
  const key = line.split("=")[0];
  return key !== "CROO_WALLET_KEY" && key !== "CROO_WALLET_ADDRESS";
});

lines.push("");
lines.push("# ─── CROO test/whitelist wallet ───────────────────────────────────────────");
lines.push("# This wallet is used for CROO Agent Store whitelist access and USDC receipt.");
lines.push(`CROO_WALLET_ADDRESS=${account.address}`);
lines.push(`CROO_WALLET_KEY=${privateKey}`);
lines.push("");

await writeFile(envPath, lines.join("\n"), "utf-8");

// Print only the public address so it can be safely shared.
console.log(account.address);
