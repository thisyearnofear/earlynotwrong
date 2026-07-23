import {
  trace,
  SpanStatusCode,
  type Span,
  type SpanAttributes,
} from "@opentelemetry/api";
import { isTelemetryEnabled } from "./init.js";

const TRACER_NAME = process.env.OTEL_SERVICE_NAME ?? "early-not-wrong-agent";

export function getTracer() {
  return trace.getTracer(TRACER_NAME, "0.1.0");
}

/** Run `fn` inside an active span. Passes through when telemetry is disabled. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span | undefined) => Promise<T>,
  attributes?: SpanAttributes,
): Promise<T> {
  if (!isTelemetryEnabled()) {
    return fn(undefined);
  }

  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      span.setAttributes(attributes);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
