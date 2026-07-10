/**
 * Tests for the CROO CAP integration surface.
 *
 * These tests verify the service/pricing mapping and helper logic without
 * needing a live CROO connection. End-to-end order flow is covered by manual
 * Store listing verification.
 */

import { describe, expect, it } from "vitest";
import {
  CAP_PRICING,
  CAP_SERVICE_IDS,
  pricingForToolName,
  toolNameForService,
  type CapServiceName,
} from "../src/cap/pricing.js";

const SERVICE_NAMES: CapServiceName[] = [
  "reputation-latest",
  "reputation-history",
  "reputation-cross-chain",
  "reputation-agent",
  "signals-live",
];

describe("CAP pricing config", () => {
  it("advertises the four reputation services plus live signals", () => {
    expect(Object.keys(CAP_PRICING).sort()).toEqual(SERVICE_NAMES.sort());
    expect([...CAP_SERVICE_IDS].sort()).toEqual(SERVICE_NAMES.sort());
  });

  it("keeps the pre-registered CROO Store serviceIds unrenamed", () => {
    for (const preRegistered of [
      "reputation-latest",
      "reputation-history",
      "reputation-cross-chain",
      "reputation-agent",
    ]) {
      expect(CAP_SERVICE_IDS).toContain(preRegistered);
    }
  });

  it("makes reputation-agent the free-equivalent trust-decision query", () => {
    expect(CAP_PRICING["reputation-agent"].amountUsdcBaseUnits).toBe("0");
    expect(CAP_PRICING["reputation-agent"].toolName).toBe("get_agent_reputation");
  });

  it("prices signals-live at $0.05 USDC and maps it to get_live_signals", () => {
    expect(CAP_PRICING["signals-live"].amountUsdcBaseUnits).toBe("50000");
    expect(CAP_PRICING["signals-live"].toolName).toBe("get_live_signals");
  });

  it("maps every serviceId to a unique reputation tool", () => {
    const toolNames = new Set<string>();
    for (const serviceId of CAP_SERVICE_IDS) {
      const toolName = toolNameForService(serviceId);
      expect(toolName).toBeTruthy();
      toolNames.add(toolName!);
    }
    expect(toolNames.size).toBe(CAP_SERVICE_IDS.length);
  });

  it("round-trips service → tool → service", () => {
    for (const serviceId of CAP_SERVICE_IDS) {
      const toolName = toolNameForService(serviceId);
      const pricing = pricingForToolName(toolName!);
      expect(pricing?.serviceId).toBe(serviceId);
    }
  });

  it("uses USDC base units (6 decimals) and non-negative prices", () => {
    for (const entry of Object.values(CAP_PRICING)) {
      expect(entry.amountUsdcBaseUnits).toMatch(/^\d+$/);
      expect(BigInt(entry.amountUsdcBaseUnits)).toBeGreaterThanOrEqual(0n);
    }
  });
});
