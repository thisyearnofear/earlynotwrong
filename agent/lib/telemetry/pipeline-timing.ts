/** One step in the 8-step runCycle pipeline — surfaced on /status for the web UI. */
export type PipelineStepStatus = "ok" | "warn" | "error" | "skipped";

export interface PipelineStepSnapshot {
  id: string;
  label: string;
  durationMs: number;
  status: PipelineStepStatus;
}

const WARN_STEP_MS = 120_000;

export function createPipelineRecorder() {
  const steps: PipelineStepSnapshot[] = [];

  async function record<T>(id: string, label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - t0;
      steps.push({
        id,
        label,
        durationMs,
        status: durationMs > WARN_STEP_MS ? "warn" : "ok",
      });
      return result;
    } catch (error) {
      steps.push({
        id,
        label,
        durationMs: Date.now() - t0,
        status: "error",
      });
      throw error;
    }
  }

  return { steps, record };
}
