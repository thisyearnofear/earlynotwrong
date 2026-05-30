#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_GROVE_API_URL = "https://api.grove.storage";
const DEFAULT_GROVE_CHAIN_ID = 8453;

async function main() {
  const agentCardPath = resolve("mantle/agent-card.json");
  const chainId = Number(process.env.GROVE_CHAIN_ID || DEFAULT_GROVE_CHAIN_ID);
  const apiUrl = process.env.GROVE_API_URL || DEFAULT_GROVE_API_URL;
  const raw = await readFile(agentCardPath, "utf8");
  const parsed = JSON.parse(raw);
  const body = JSON.stringify(parsed, null, 2);

  const response = await fetch(`${apiUrl}/?chain_id=${chainId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Grove upload failed (${response.status}): ${responseBody.slice(0, 500)}`,
    );
  }

  const parsedResponse = JSON.parse(responseBody);
  const upload = Array.isArray(parsedResponse) ? parsedResponse[0] : parsedResponse;
  console.log(JSON.stringify({
    chain_id: chainId,
    source: agentCardPath,
    ...upload,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
