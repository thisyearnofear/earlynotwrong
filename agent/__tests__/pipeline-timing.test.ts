import { describe, it, expect } from "vitest";
import { createPipelineRecorder } from "../lib/telemetry/pipeline-timing.js";

describe("createPipelineRecorder", () => {
  it("records step duration and ok status", async () => {
    const { record, steps } = createPipelineRecorder();
    await record("portfolio", "Portfolio", async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.id).toBe("portfolio");
    expect(steps[0]!.status).toBe("ok");
    expect(steps[0]!.durationMs).toBeGreaterThanOrEqual(5);
  });

  it("records error status on throw", async () => {
    const { record, steps } = createPipelineRecorder();
    await expect(
      record("trade", "Trade", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(steps[0]!.status).toBe("error");
  });
});
