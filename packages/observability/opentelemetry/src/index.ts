// OpenTelemetry Core Instrumentation for Social Media CMS
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis";
import { FsInstrumentation } from "@opentelemetry/instrumentation-fs";
import pino from "pino";

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
    // Create resource with service information
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: this.config.serviceName,
      [ATTR_SERVICE_VERSION]: this.config.serviceVersion,
      environment: this.config.environment,
      tenant: "multi-tenant",
      component: "social-media-cms",
      ...this.config.customAttributes,
    });

    // Configure exporters
    const exporters = this.configureExporters();

    // Configure instrumentations
    const instrumentations = this.configureInstrumentations();

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

  private configureInstrumentations() {
    return [
      // Auto-instrumentations for common Node.js libraries
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": {
          enabled: true,
        },
      }),

      // Fastify-specific instrumentation for API server
      new FastifyInstrumentation({
        enabled: true,
        requestHook: (span, request) => {
          // Add custom attributes for social media context
          const headers = (
            request as unknown as { headers: Record<string, string | string[] | undefined> }
          ).headers;
          if (headers["x-tenant-id"]) {
            span.setAttributes({
              "tenant.id": headers["x-tenant-id"] as string,
            });
          }
          if (headers["x-project-id"]) {
            span.setAttributes({
              "project.id": headers["x-project-id"] as string,
            });
          }
          if (headers["x-provider"]) {
            span.setAttributes({
              "social.provider": headers["x-provider"] as string,
            });
          }
        },
      }),

      // HTTP instrumentation for provider API calls
      new HttpInstrumentation({
        enabled: true,
        ignoreOutgoingRequestHook: (req) => {
          // Don't trace internal health checks
          const url = (req as unknown as { path?: string }).path || "";
          return url.includes("/health") || url.includes("/metrics");
        },
        requestHook: (span, request) => {
          // Add social media provider context
          const url = (request as unknown as { path?: string }).path || "";
          if (url.includes("api.twitter.com") || url.includes("api.x.com")) {
            span.setAttributes({
              "social.provider": "x",
              "social.api.version": "2",
            });
          } else if (url.includes("graph.facebook.com")) {
            span.setAttributes({
              "social.provider": "instagram",
              "social.api.version": "v18.0",
            });
          }
        },
      }),

      // Redis instrumentation for cache and queues
      new RedisInstrumentation({
        enabled: true,
        dbStatementSerializer: (cmdName, cmdArgs) => {
          // Sanitize sensitive data in Redis commands
          if (cmdName.toLowerCase().includes("auth") || cmdName.toLowerCase().includes("set")) {
            return `${cmdName} [REDACTED]`;
          }
          return `${cmdName} ${cmdArgs.join(" ")}`;
        },
      }),

      // File system instrumentation for media handling
      new FsInstrumentation({
        enabled: true,
      }),
    ];
  }

  /**
   * Start the telemetry system
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
   * Gracefully shutdown the telemetry system
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
   * Get the current configuration
   */
  getConfig(): TelemetryConfig {
    return { ...this.config };
  }
}

/**
 * Initialize OpenTelemetry for different service types.
 * Registers SIGINT/SIGTERM handlers for graceful shutdown.
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

// Pre-configured telemetry setups for different services
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
