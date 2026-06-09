/**
 * @file initialization.ts
 * @description OpenTelemetry instrumentation initialization for publish workers.
 *              Must be imported before other modules so spans wrap subsequent
 *              work. Provides publishing, database, and business KPI
 *              instrumentation, falling back to no-op implementations when
 *              tracing is disabled or the OTel package fails to start.
 * @layer infrastructure
 */

import { createLogger } from "@observability/logger";
import type {
  PublishInstrumentation,
  DatabaseInstrumentation,
  BusinessKPITracker,
  ContentMetrics,
} from "./instrumentationTypes.js";

const telemetryLogger = createLogger("worker-telemetry");

// ---- Mock implementations (used when OTel fails to initialize) ----

const noopSpan = { setAttributes: (_attrs: Record<string, string>) => {} };

const mockPublishingInstrumentation: PublishInstrumentation = {
  instrumentPublishing: async (
    _name: string,
    _provider: string,
    _channelId: string,
    _type: string,
    fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>,
    _metadata?: Record<string, string>
  ) => {
    return await fn(noopSpan);
  },
  instrumentProviderAPI: async (
    _provider: string,
    _operation: string,
    _method: string,
    fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>
  ) => {
    return await fn(noopSpan);
  },
};

const mockDatabaseInstrumentation: DatabaseInstrumentation = {
  instrumentQuery: async (_operation: string, _table: string, fn: () => Promise<unknown>) => {
    return await fn();
  },
};

const mockBusinessKPITracker: BusinessKPITracker = {
  trackContentPublication: (_metrics: ContentMetrics) => {
    /* no-op */
  },
};

// ---- Placeholder metric aliases ----

export type UserMetrics = any;
export type ProviderMetrics = any;
export type BusinessMetrics = any;

// ---- Real OTel initialization with graceful fallback ----

let publishingInstrumentation: PublishInstrumentation = mockPublishingInstrumentation;
let databaseInstrumentation: DatabaseInstrumentation = mockDatabaseInstrumentation;
let businessKPITracker: BusinessKPITracker = mockBusinessKPITracker;

// Route through the workers typed env module — no raw process.env reads.
const { env } = await import("../config/env.js");
const tracingEnabled = env.TRACING_ENABLED;

if (tracingEnabled) {
  try {
    const otel = await import("@observability/opentelemetry");
    const environment = env.NODE_ENV;
    const telemetry = otel.createWorkerTelemetry(environment);

    await telemetry.start();
    telemetryLogger.info("OpenTelemetry initialized for workers");

    // Wire real instrumentation instances from the OTel package.
    // The OTel package uses stricter types (e.g. "single" | "thread" | "story")
    // but the handler interfaces accept plain string, so we cast through the
    // handler-defined interfaces which are the contract both sides agree on.
    publishingInstrumentation = otel.publishingInstrumentation as unknown as PublishInstrumentation;
    databaseInstrumentation = otel.databaseInstrumentation as unknown as DatabaseInstrumentation;
    businessKPITracker = otel.businessKPITracker as unknown as BusinessKPITracker;
  } catch (error) {
    telemetryLogger.warn(
      { err: error },
      "Failed to initialize OpenTelemetry -- falling back to no-op instrumentation. " +
        "This is expected if Jaeger is not running."
    );
    // Keep mock implementations (already assigned as defaults)
  }
} else {
  telemetryLogger.info("Tracing disabled (TRACING_ENABLED != true) -- using no-op instrumentation");
}

// Export instrumentation components for use in the application
export { publishingInstrumentation, databaseInstrumentation, businessKPITracker };
