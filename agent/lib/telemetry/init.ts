import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ?? "early-not-wrong-agent";
const SERVICE_VERSION = "0.1.0";

let sdk: NodeSDK | null = null;
let enabled = false;

export function isTelemetryEnabled(): boolean {
  return enabled;
}

/**
 * Start the OpenTelemetry SDK when OTLP export is configured.
 * No-ops when neither OTEL_EXPORTER_OTLP_ENDPOINT nor OTEL_ENABLED=1 is set.
 */
export function initTelemetry(): boolean {
  if (sdk) return enabled;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const explicitlyEnabled = process.env.OTEL_ENABLED === "1";
  if (!endpoint && !explicitlyEnabled) {
    return false;
  }

  const baseUrl = (endpoint ?? "http://localhost:4318").replace(/\/$/, "");

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${baseUrl}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${baseUrl}/v1/metrics`,
      }),
      exportIntervalMillis: 60_000,
    }),
  });

  sdk.start();
  enabled = true;
  console.log(
    `[otel] Exporting traces + metrics to ${baseUrl} (service=${SERVICE_NAME})`,
  );
  return true;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
  enabled = false;
}
