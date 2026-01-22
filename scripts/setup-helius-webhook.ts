/**
 * Helius Webhook Setup Script
 *
 * Run with: npx tsx scripts/setup-helius-webhook.ts
 *
 * Prerequisites:
 * - HELIUS_API_KEY in .env.local
 * - App deployed to Vercel (need the production URL)
 */

// @ts-nocheck
// Run with: npx tsx scripts/setup-helius-webhook.ts

// Load environment variables
const fs = await import("fs");
const envContent = fs.readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const [key, ...valueParts] = line.split("=");
  if (key && !key.startsWith("#")) {
    process.env[key.trim()] = valueParts.join("=").trim();
  }
}

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// Your Solana watchlist addresses
const SOLANA_ADDRESSES = [
  "HAmd4Fbyk9mkx2LpJuAnswvch2U4bS1kMUPHsphawLUc", // Vickybro
  "7aMgK5L4qEQ8Nyv6ZzhZi2B82NSSRnwb2NGJnNagA46D",
  "suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK",
  "Szrt7xTyU4XXQB3YUYawUHDoeBsmNzeqGtEzUT3SwTP",
  "CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o",
];

async function listWebhooks() {
  const response = await fetch(
    `https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`
  );
  const data = await response.json();
  console.log("Existing webhooks:", JSON.stringify(data, null, 2));
  return data;
}

async function createWebhook(webhookUrl: string, authHeader?: string) {
  const body = {
    webhookURL: webhookUrl,
    transactionTypes: ["SWAP", "TRANSFER", "ANY"], // Monitor swaps and transfers
    accountAddresses: SOLANA_ADDRESSES,
    webhookType: "enhanced", // Get parsed transaction data
    ...(authHeader && { authHeader }),
  };

  console.log("Creating webhook with config:", JSON.stringify(body, null, 2));

  const response = await fetch(
    `https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Failed to create webhook:", data);
    return null;
  }

  console.log("Webhook created:", JSON.stringify(data, null, 2));
  return data;
}

async function deleteWebhook(webhookId: string) {
  const response = await fetch(
    `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${HELIUS_API_KEY}`,
    { method: "DELETE" }
  );

  if (response.ok) {
    console.log(`Webhook ${webhookId} deleted`);
  } else {
    console.error("Failed to delete webhook:", await response.json());
  }
}

async function main() {
  if (!HELIUS_API_KEY) {
    console.error("HELIUS_API_KEY not found in environment");
    process.exit(1);
  }

  const command = process.argv[2];
  const arg = process.argv[3];

  switch (command) {
    case "list":
      await listWebhooks();
      break;

    case "create":
      if (!arg) {
        console.error("Usage: npx tsx scripts/setup-helius-webhook.ts create <webhook-url>");
        console.error("Example: npx tsx scripts/setup-helius-webhook.ts create https://yourapp.vercel.app/api/webhooks/helius");
        process.exit(1);
      }
      await createWebhook(arg, process.argv[4]);
      break;

    case "delete":
      if (!arg) {
        console.error("Usage: npx tsx scripts/setup-helius-webhook.ts delete <webhook-id>");
        process.exit(1);
      }
      await deleteWebhook(arg);
      break;

    default:
      console.log(`
Helius Webhook Setup

Commands:
  list                          List all existing webhooks
  create <url> [auth-header]    Create a new webhook
  delete <webhook-id>           Delete a webhook

Examples:
  npx tsx scripts/setup-helius-webhook.ts list
  npx tsx scripts/setup-helius-webhook.ts create https://earlynotwrong.vercel.app/api/webhooks/helius
  npx tsx scripts/setup-helius-webhook.ts create https://earlynotwrong.vercel.app/api/webhooks/helius "Bearer secret123"
      `);
  }
}

main().catch(console.error);
