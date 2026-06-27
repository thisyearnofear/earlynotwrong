/**
 * Aleo sign-service tests.
 *
 * Covers the HMAC middleware — the auth boundary between Vercel and the VPS.
 * The actual SDK signing path is exercised by deploying + claiming on
 * testnet; it imports a WASM runtime which doesn't fit the vitest harness
 * cleanly. The middleware is the bit most likely to have logic bugs anyway.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { aleoSignHmacMiddleware } from "../src/aleo/sign-service.js";

const SECRET = "test-shared-secret-do-not-use-in-production";

function buildApp() {
  const app = new Hono();
  app.use("/aleo/sign-voucher", aleoSignHmacMiddleware());
  app.post("/aleo/sign-voucher", (c) => c.json({ ok: true }));
  return app;
}

function buildSigned(body: string, ts = Date.now(), secret = SECRET) {
  const signature = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return {
    headers: {
      "content-type": "application/json",
      "x-timestamp": String(ts),
      "x-signature": signature,
    },
    body,
  };
}

describe("aleoSignHmacMiddleware", () => {
  it("rejects requests with no signature header (401)", async () => {
    vi.stubEnv("ALEO_SIGN_SERVICE_HMAC_SECRET", SECRET);
    const app = buildApp();
    const res = await app.request("/aleo/sign-voucher", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: "aleo1abc", amount: 100 }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a mismatched signature (401)", async () => {
    vi.stubEnv("ALEO_SIGN_SERVICE_HMAC_SECRET", SECRET);
    const app = buildApp();
    const body = JSON.stringify({ recipient: "aleo1abc", amount: 100 });
    const res = await app.request("/aleo/sign-voucher", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-timestamp": String(Date.now()),
        "x-signature": "deadbeef".repeat(8),
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a stale timestamp (>30s old) (401)", async () => {
    vi.stubEnv("ALEO_SIGN_SERVICE_HMAC_SECRET", SECRET);
    const app = buildApp();
    const body = JSON.stringify({ recipient: "aleo1abc", amount: 100 });
    const staleTs = Date.now() - 31_000;
    const { headers } = buildSigned(body, staleTs);
    const res = await app.request("/aleo/sign-voucher", {
      method: "POST",
      headers,
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests when the wrong secret is used (401)", async () => {
    vi.stubEnv("ALEO_SIGN_SERVICE_HMAC_SECRET", SECRET);
    const app = buildApp();
    const body = JSON.stringify({ recipient: "aleo1abc", amount: 100 });
    const { headers } = buildSigned(body, Date.now(), "WRONG-SECRET");
    const res = await app.request("/aleo/sign-voucher", {
      method: "POST",
      headers,
      body,
    });
    expect(res.status).toBe(401);
  });

  it("returns 503 when the secret env var is not configured", async () => {
    vi.stubEnv("ALEO_SIGN_SERVICE_HMAC_SECRET", "");
    const app = buildApp();
    const body = JSON.stringify({ recipient: "aleo1abc", amount: 100 });
    const { headers } = buildSigned(body);
    const res = await app.request("/aleo/sign-voucher", {
      method: "POST",
      headers,
      body,
    });
    expect(res.status).toBe(503);
  });

  it("passes through a properly signed request (handler runs)", async () => {
    vi.stubEnv("ALEO_SIGN_SERVICE_HMAC_SECRET", SECRET);
    const app = buildApp();
    const body = JSON.stringify({ recipient: "aleo1abc", amount: 100 });
    const { headers } = buildSigned(body);
    const res = await app.request("/aleo/sign-voucher", {
      method: "POST",
      headers,
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok?: boolean };
    expect(json.ok).toBe(true);
  });

  it("body mutation invalidates the signature", async () => {
    // Caller signs body A, attacker swaps in body B with the same headers.
    vi.stubEnv("ALEO_SIGN_SERVICE_HMAC_SECRET", SECRET);
    const app = buildApp();
    const originalBody = JSON.stringify({ recipient: "aleo1abc", amount: 100 });
    const tamperedBody = JSON.stringify({ recipient: "aleo1evil", amount: 9999 });
    const { headers } = buildSigned(originalBody);
    const res = await app.request("/aleo/sign-voucher", {
      method: "POST",
      headers,
      body: tamperedBody, // signature is for originalBody
    });
    expect(res.status).toBe(401);
  });
});
