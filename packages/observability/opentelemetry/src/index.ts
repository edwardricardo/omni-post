/**
 * @file index.ts
 * @description OpenTelemetry NodeSDK bootstrap for the platform — configures trace and metric
 *              exporters, resource attributes, and the instrumentations for HTTP, Fastify, Redis
 *              and the file system.
 * @layer infrastructure
 */
import { NodeSDK, type NodeSDKConfiguration } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import pino from "pino";
import { tagProviderSpan } from "./providerSpanAttributes.js";

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint?: string;
  enableConsoleExporter?: boolean;
  enableFileExporter?: boolean;
  enablePrometheusExporter?: boolean;
  enableDetailedLogging?: boolean;
  samplingRatio?: number;
  customAttributes?: Record<string, string>;
}

export class SocialMediaTelemetry {
  private sdk!: NodeSDK;
  private logger: pino.Logger;
  private config: TelemetryConfig;

  constructor(config: TelemetryConfig) {
    this.config = config;
    this.logger = pino({
      name: `telemetry-${config.serviceName}`,
      level: config.enableDetailedLogging ? "debug" : "info",
    });

    // Enable OpenTelemetry diagnostic logging if needed
    if (config.enableDetailedLogging) {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    }

    this.initializeSDK();
  }

  private initializeSDK() {
    // Prevent NodeSDK auto-configuration from creating OTLP exporters for
    // metrics and logs. We use Prometheus for metrics and Pino for structured
    // logging — only traces go to OTLP (Jaeger).
    process.env.OTEL_METRICS_EXPORTER ??= "none";
    process.env.OTEL_LOGS_EXPORTER ??= "none";

    // `service.name` and `service.version` are the semantic-convention service attributes.
    const resource = resourceFromAttributes({
      "service.name": this.config.serviceName,
      "service.version": this.config.serviceVersion,
      environment: this.config.environment,
      tenant: "multi-tenant",
      component: "social-media-cms",
      ...this.config.customAttributes,
    });

    // Configure exporters
    const exporters = this.configureExporters();

    // Configure instrumentations
    const instrumentations = createTelemetryInstrumentations();

    // Initialize SDK (use conditional spreading for exactOptionalPropertyTypes compliance)
    this.sdk = new NodeSDK({
      resource,
      instrumentations,
      ...(exporters.trace && { traceExporter: exporters.trace }),
      ...(exporters.metrics && { metricReader: exporters.metrics }),
    });

    this.logger.info(
      {
        serviceName: this.config.serviceName,
        version: this.config.serviceVersion,
        environment: this.config.environment,
      },
      "OpenTelemetry SDK initialized"
    );
  }

  private configureExporters() {
    let traceExporter: OTLPTraceExporter | undefined;
    let metricsReader: PrometheusExporter | undefined;

    // Configure OTLP HTTP exporter for distributed tracing (Jaeger 2.x native)
    if (this.config.otlpEndpoint) {
      traceExporter = new OTLPTraceExporter({
        url: `${this.config.otlpEndpoint}/v1/traces`,
      });
      this.logger.info({ endpoint: this.config.otlpEndpoint }, "OTLP trace exporter configured");
    }

    // Configure Prometheus exporter for metrics
    if (this.config.enablePrometheusExporter) {
      metricsReader = new PrometheusExporter({
        port: parseInt(process.env.PROMETHEUS_PORT || "9464"),
        endpoint: "/metrics",
      });
      this.logger.info("Prometheus metrics exporter configured");
    }

    return { trace: traceExporter, metrics: metricsReader };
  }

  /**
   * @method start
   * @description Starts the NodeSDK: registers the tracer and meter providers and enables every
   *              instrumentation of `createTelemetryInstrumentations()`.
   */
  async start(): Promise<void> {
    try {
      await this.sdk.start();
      this.logger.info("OpenTelemetry instrumentation started successfully");
    } catch (error) {
      this.logger.error({ error }, "Failed to start OpenTelemetry instrumentation");
      throw error;
    }
  }

  /**
   * @method shutdown
   * @description Flushes pending spans and metrics and shuts the NodeSDK down.
   */
  async shutdown(): Promise<void> {
    try {
      await this.sdk.shutdown();
      this.logger.info("OpenTelemetry instrumentation stopped");
    } catch (error) {
      this.logger.error({ error }, "Error during OpenTelemetry shutdown");
      throw error;
    }
  }

  /**
   * @method getConfig
   * @description Returns a shallow copy of the configuration this instance was built with.
   * @returns The telemetry configuration
   */
  getConfig(): TelemetryConfig {
    return { ...this.config };
  }
}

/**
 * @description Builds the instrumentations the NodeSDK of `SocialMediaTelemetry` enables: the
 *              auto-instrumentations map, with its file-system instrumentation switched on and its
 *              HTTP instrumentation carrying two hooks, and `@fastify/otel`. The hooks are set in
 *              the map's `@opentelemetry/instrumentation-http` entry, never on a second
 *              `HttpInstrumentation`: `InstrumentationBase._wrap` unwraps a target that is already
 *              wrapped, so a second instance of one instrumentation replaces the first one's
 *              wrapper, and only the configuration of the instance that wraps last reaches a span.
 *              Redis spans come from the map's `ioredis` entry, the client every file uses: the
 *              node-redis instrumentation that used to be listed here saw no command, because the
 *              tree holds no `redis` package, and the map's default statement serializer, from
 *              `@opentelemetry/redis-common`, writes `AUTH` with no arguments and `SET` with its
 *              key alone.
 *              Fastify is instrumented by `@fastify/otel` with `registerOnInitialization`: on
 *              `enable()` it subscribes to Fastify's `fastify.initialization` diagnostics channel
 *              and registers its plugin on every instance created afterwards, patching no module.
 *              The API is ESM and imports `fastify` before the SDK starts, so a module-patching
 *              instrumentation would never see that import; a subscription made before
 *              `Fastify()` runs does.
 * @returns The instrumentations, in the shape `NodeSDKConfiguration.instrumentations` takes
 */
export function createTelemetryInstrumentations(): NodeSDKConfiguration["instrumentations"] {
  return [
    // Auto-instrumentations for common Node.js libraries
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": {
        enabled: true,
      },
      "@opentelemetry/instrumentation-http": {
        // Always on, as the explicit instance this entry replaced was: the map's
        // `OTEL_NODE_DISABLED_INSTRUMENTATIONS` switch does not remove the provider spans.
        enabled: true,
        // No client span for a request to the internal health and metrics endpoints
        ignoreOutgoingRequestHook: (request) => {
          const path = request.path ?? "";
          return path.includes("/health") || path.includes("/metrics");
        },
        // Social provider context on outgoing requests. The provider is recognised by host-name
        // equality, because a substring test on a URL lets `api.twitter.com.evil.example` pass, and
        // the host is read from the request itself, because the `path` of an outgoing request never
        // holds it. Incoming requests are never tagged: the client chooses their `Host` header.
        requestHook: tagProviderSpan,
      },
    }),

    // Fastify route spans: one `request` span per request and one child span per handler and hook
    new FastifyOtelInstrumentation({ registerOnInitialization: true }),
  ];
}

/**
 * @description Builds the telemetry for one service and registers SIGINT and SIGTERM handlers that
 *              shut it down before the process exits. The SDK is not started here.
 * @param config - The service's telemetry configuration
 * @returns The telemetry instance, to be started with `start()`
 */
export function initializeTelemetry(config: TelemetryConfig): SocialMediaTelemetry {
  const telemetry = new SocialMediaTelemetry(config);

  // Handle graceful shutdown
  const shutdownLogger = pino({ name: "telemetry-shutdown" });

  process.on("SIGINT", async () => {
    try {
      await telemetry.shutdown();
      process.exit(0);
    } catch (error) {
      shutdownLogger.error({ err: error }, "Error during telemetry shutdown (SIGINT)");
      process.exit(1);
    }
  });

  process.on("SIGTERM", async () => {
    try {
      await telemetry.shutdown();
      process.exit(0);
    } catch (error) {
      shutdownLogger.error({ err: error }, "Error during telemetry shutdown (SIGTERM)");
      process.exit(1);
    }
  });

  return telemetry;
}

/**
 * @description Builds the API server's telemetry: OTLP traces, the Prometheus exporter, and
 *              detailed diagnostics in development.
 * @param environment - The runtime environment name
 * @returns The telemetry instance, to be started with `start()`
 */
export const createApiTelemetry = (environment: string = "development") => {
  return initializeTelemetry({
    serviceName: process.env.OTEL_SERVICE_NAME || "omnipost-api",
    serviceVersion: process.env.npm_package_version || "1.0.0",
    environment,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",
    enablePrometheusExporter: true,
    enableDetailedLogging: environment === "development",
    samplingRatio: environment === "production" ? 0.1 : 1.0,
    customAttributes: {
      "service.type": "api",
      "deployment.environment": environment,
    },
  });
};

/**
 * @description Builds the workers' telemetry: OTLP traces, the Prometheus exporter, and detailed
 *              diagnostics in development.
 * @param environment - The runtime environment name
 * @returns The telemetry instance, to be started with `start()`
 */
export const createWorkerTelemetry = (environment: string = "development") => {
  return initializeTelemetry({
    serviceName: process.env.OTEL_SERVICE_NAME || "omnipost-worker",
    serviceVersion: process.env.npm_package_version || "1.0.0",
    environment,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",
    enablePrometheusExporter: true,
    enableDetailedLogging: environment === "development",
    samplingRatio: environment === "production" ? 0.1 : 1.0,
    customAttributes: {
      "service.type": "worker",
      "deployment.environment": environment,
    },
  });
};

/**
 * @description Builds the client portal's telemetry: OTLP traces, no Prometheus exporter, and
 *              detailed diagnostics in development.
 * @param environment - The runtime environment name
 * @returns The telemetry instance, to be started with `start()`
 */
export const createClientTelemetry = (environment: string = "development") => {
  return initializeTelemetry({
    serviceName: process.env.OTEL_SERVICE_NAME || "omnipost-client",
    serviceVersion: process.env.npm_package_version || "1.0.0",
    environment,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",
    enablePrometheusExporter: false, // Client apps typically don't expose metrics
    enableDetailedLogging: environment === "development",
    samplingRatio: environment === "production" ? 0.05 : 1.0,
    customAttributes: {
      "service.type": "client",
      "deployment.environment": environment,
    },
  });
};

/**
 * @description Builds the admin portal's telemetry: OTLP traces, no Prometheus exporter, and
 *              detailed diagnostics in development.
 * @param environment - The runtime environment name
 * @returns The telemetry instance, to be started with `start()`
 */
export const createAdminTelemetry = (environment: string = "development") => {
  return initializeTelemetry({
    serviceName: process.env.OTEL_SERVICE_NAME || "omnipost-admin",
    serviceVersion: process.env.npm_package_version || "1.0.0",
    environment,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",
    enablePrometheusExporter: false,
    enableDetailedLogging: environment === "development",
    samplingRatio: environment === "production" ? 0.05 : 1.0,
    customAttributes: {
      "service.type": "admin",
      "deployment.environment": environment,
    },
  });
};

export * from "./customInstrumentation.js";
export * from "./businessMetrics.js";
export * from "./correlationTracking.js";
