import { context, trace } from "@opentelemetry/api";

type LogLevel = "debug" | "info" | "warn" | "error";

const SERVICE = process.env.OTEL_SERVICE_NAME ?? "early-not-wrong-agent";

function traceFields(): Record<string, string> {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const spanContext = span.spanContext();
  if (!spanContext.traceId) return {};
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

function emit(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: SERVICE,
    ...traceFields(),
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Structured JSON logger — includes trace context when a span is active. */
export const cycleLog = {
  debug: (message: string, fields?: Record<string, unknown>) =>
    emit("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) =>
    emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) =>
    emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) =>
    emit("error", message, fields),
};
