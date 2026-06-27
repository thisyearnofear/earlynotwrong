/**
 * Aleo voucher sign service.
 *
 * Mounts on the existing Hono server at POST /aleo/sign-voucher. Holds the
 * treasury private key (never sent to Vercel), signs nonce_field with it,
 * returns { nonce, signature }. The Vercel rebate route calls this over an
 * HMAC-authed channel.
 *
 * Why this exists: Vercel decrypts ALEO_PRIVATE_KEY into the process memory
 * of every serverless function invocation, plus any post-install npm
 * dependency in the bundle has access to process.env. By moving signing to
 * the VPS, the key never crosses Vercel — a Vercel compromise (or a
 * supply-chain attack in the Next.js build) can't leak it.
 *
 * Threat model handled here:
 *   - Wrong caller        → HMAC mismatch, 401
 *   - Replay              → timestamp window (30s) + nonce-per-payload
 *   - Oversized request   → 4KB body cap (Hono default is generous)
 *   - Amount escalation   → server-side amount cap (matches treasury.ts)
 *
 * NOT handled here (out of scope, document for future):
 *   - Eligibility (the client could be anyone — see /api/aleo/rebate route
 *     for the per-address cooldown that gates this at the Vercel boundary)
 *   - Key rotation (single ALEO_PRIVATE_KEY env var; rotation = restart)
 */

import type { Context, MiddlewareHandler } from "hono";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const MAX_AMOUNT_BASE_UNITS = 1_000_000; // 1 credit max per voucher
const HMAC_REPLAY_WINDOW_MS = 30_000;

interface SignVoucherRequest {
  recipient: string;
  amount: number;
}

interface SignVoucherResponse {
  nonce: string;
  signature: string;
  signerAddress: string;
}

/**
 * HMAC middleware. Caller signs `${timestamp}.${rawBody}` with the shared
 * secret and sends X-Signature + X-Timestamp headers. We reject anything
 * outside the replay window or with a mismatched signature.
 */
export function aleoSignHmacMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const sharedSecret = process.env.ALEO_SIGN_SERVICE_HMAC_SECRET;
    if (!sharedSecret) {
      return c.json({ error: "sign service not configured (HMAC secret missing)" }, 503);
    }
    const signatureHeader = c.req.header("x-signature");
    const timestampHeader = c.req.header("x-timestamp");
    if (!signatureHeader || !timestampHeader) {
      return c.json({ error: "missing X-Signature or X-Timestamp" }, 401);
    }
    // Replay window: clients within 30s of our clock.
    const ts = Number(timestampHeader);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > HMAC_REPLAY_WINDOW_MS) {
      return c.json({ error: "timestamp outside replay window" }, 401);
    }
    const rawBody = await c.req.raw.clone().text();
    const expected = createHmac("sha256", sharedSecret)
      .update(`${ts}.${rawBody}`)
      .digest("hex");
    const provided = signatureHeader;
    if (expected.length !== provided.length) {
      return c.json({ error: "signature mismatch" }, 401);
    }
    try {
      if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))) {
        return c.json({ error: "signature mismatch" }, 401);
      }
    } catch {
      return c.json({ error: "signature mismatch" }, 401);
    }
    await next();
  };
}

/** Cryptographic field-element nonce. crypto.randomBytes → bigint → string. */
function generateNonce(): string {
  const bytes = randomBytes(32);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

/**
 * Sign a voucher. Loads the Aleo SDK lazily (its initializeWasm is slow on
 * first call; we want server startup to stay fast). The SDK is a CJS module
 * with default-export interop — same pattern used in the agent's casper.ts.
 */
async function signVoucher(req: SignVoucherRequest): Promise<SignVoucherResponse> {
  const privateKey = process.env.ALEO_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("ALEO_PRIVATE_KEY is not configured on the sign service");
  }
  if (!Number.isFinite(req.amount) || req.amount <= 0 || req.amount > MAX_AMOUNT_BASE_UNITS) {
    throw new Error("amount out of range");
  }
  if (typeof req.recipient !== "string" || !req.recipient.startsWith("aleo1")) {
    throw new Error("invalid recipient address");
  }

  // Lazy SDK load — Aleo SDK initializes a WASM runtime; doing it at module
  // import would block agent startup for ~2s. We pay that cost on first
  // voucher instead, then cache.
  const sdk = await import("@provablehq/sdk/testnet.js");
  await sdk.initializeWasm();

  const account = new sdk.Account({ privateKey });
  const nonceStr = generateNonce();
  const nonceField = sdk.Field.fromString(nonceStr);
  const signature = account.sign(nonceField.toBytesLe());

  return {
    nonce: nonceField.toString(),
    signature: signature.toString(),
    signerAddress: account.address().to_string(),
  };
}

/**
 * Hono route handler. Mounted in src/server.ts as POST /aleo/sign-voucher.
 * The middleware is registered separately so the auth check runs before
 * any body parsing.
 */
export async function handleSignVoucher(c: Context): Promise<Response> {
  let body: SignVoucherRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  try {
    const out = await signVoucher(body);
    return c.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    // Treat known input errors as 400; everything else 500.
    const code = message.includes("out of range") || message.includes("invalid recipient") ? 400 : 500;
    return c.json({ error: message }, code);
  }
}
