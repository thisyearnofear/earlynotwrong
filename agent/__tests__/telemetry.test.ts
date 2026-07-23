/**
 * Tests for agent/lib/telemetry — no-op when OTLP is not configured.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initTelemetry,
  shutdownTelemetry,
  isTelemetryEnabled,
  withSpan,
  cycleLog,
} from "../lib/telemetry/index.js";

describe("telemetry", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  afterEach(async () => {
    await shutdownTelemetry();
    process.env = { ...originalEnv };
  });

  it("is disabled without OTEL env vars", () => {
    expect(initTelemetry()).toBe(false);
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("withSpan runs fn when telemetry is disabled", async () => {
    initTelemetry();
    const result = await withSpan("test.noop", async () => 42);
    expect(result).toBe(42);
  });

  it("cycleLog emits JSON without throwing", () => {
    const logs: string[] = [];
    const spy = (line: string) => logs.push(line);
    const orig = console.log;
    console.log = spy;
    try {
      cycleLog.info("test.message", { cycle: 1 });
      expect(logs.length).toBe(1);
      const parsed = JSON.parse(logs[0]!);
      expect(parsed.msg).toBe("test.message");
      expect(parsed.level).toBe("info");
      expect(parsed.cycle).toBe(1);
    } finally {
      console.log = orig;
    }
  });
});
