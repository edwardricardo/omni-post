/**
 * @file metricsMiddleware.ts
 * @description Fastify pre-handler and onResponse hooks for tracking per-request Prometheus
 *              metrics including duration, status codes, and endpoint-specific counters.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { ApiMetrics } from "../metrics/apiMetrics.js";

interface ErrorWithCorrelation extends Error {
  correlationId?: string;
}

/**
 * @function createMetricsMiddleware
 * @description Builds Fastify hooks (preHandler / onResponse / onError) that record per-request
 *              Prometheus metrics, propagate correlation IDs, and count endpoint errors.
 * @param apiMetrics - ApiMetrics façade exposing counters, histograms, and helpers
 * @returns Object with preHandler / onResponse / onError hook callbacks
 */
export function createMetricsMiddleware(apiMetrics: ApiMetrics) {
  return {
    // Pre-handler hook to start request tracking
    preHandler: (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
      const requestId = request.id;
      const correlationId = apiMetrics.generateCorrelationId(requestId);

      // Add correlation ID to request context
      request.correlationId = correlationId;

      // Start request tracking
      const finishRequest = apiMetrics.recordRequest(
        request.method,
        request.routeOptions?.url || request.url
      );
      request.finishRequest = finishRequest;

      // Track endpoint-specific metrics
      const endpoint = request.routeOptions?.url || request.url;
      const finishEndpoint = apiMetrics.recordEndpointRequest(endpoint, request.method);
      request.finishEndpoint = finishEndpoint;

      done();
    },

    // Response hook to complete request tracking
    onResponse: (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
      const finishRequest = request.finishRequest;
      const finishEndpoint = request.finishEndpoint;
      const correlationId = request.correlationId;

      if (finishRequest) {
        finishRequest(reply.statusCode);
      }

      if (finishEndpoint) {
        const status = reply.statusCode >= 400 ? "error" : "success";
        finishEndpoint(status);
      }

      // Record response size
      const endpoint = request.routeOptions?.url || request.url;
      const statusClass = Math.floor(reply.statusCode / 100) + "xx";
      const responseLength = reply.getHeader("content-length");
      if (responseLength) {
        apiMetrics.metrics.responseSize.observe(
          { endpoint, status_class: statusClass },
          parseInt(responseLength.toString())
        );
      }

      // Record errors by endpoint
      if (reply.statusCode >= 400) {
        const errorCategory = reply.statusCode >= 500 ? "server_error" : "client_error";
        apiMetrics.metrics.errorsByEndpoint.inc({
          endpoint,
          status_code: reply.statusCode.toString(),
          error_category: errorCategory,
        });
      }

      // Clean up correlation ID
      if (correlationId) {
        apiMetrics.removeCorrelationId(request.id);
      }

      done();
    },

    // Error hook to track errors
    onError: (
      request: FastifyRequest,
      reply: FastifyReply,
      error: Error,
      done: HookHandlerDoneFunction
    ) => {
      const endpoint = request.routeOptions?.url || request.url;
      const correlationId = request.correlationId;

      // Record error by type
      apiMetrics.recordError("api", error.name || "UnknownError", true);

      // Record error by endpoint
      const statusCode = reply.statusCode >= 400 ? reply.statusCode : 500;
      const errorCategory = statusCode >= 500 ? "server_error" : "client_error";

      apiMetrics.metrics.errorsByEndpoint.inc({
        endpoint,
        status_code: statusCode.toString(),
        error_category: errorCategory,
      });

      // Add correlation ID to error context for logging
      if (correlationId) {
        (error as ErrorWithCorrelation).correlationId = correlationId;
      }

      done();
    },
  };
}

/**
 * @function getRoutePattern
 * @description Extracts a clean route pattern (without query string) from a Fastify request.
 * @param request - Incoming Fastify request
 * @returns Route URL pattern or "unknown"
 */
export function getRoutePattern(request: FastifyRequest): string {
  return request.routeOptions?.url || request.url?.split("?")[0] || "unknown";
}

/**
 * @function recordBusinessMetric
 * @description Increments the relevant business-metric counter for a known operation.
 * @param apiMetrics - ApiMetrics façade
 * @param operation - Business operation name (e.g. post_created, post_published)
 * @param labels - Optional Prometheus labels for the counter
 */
export function recordBusinessMetric(
  apiMetrics: ApiMetrics,
  operation: string,
  labels: Record<string, string> = {}
) {
  switch (operation) {
    case "post_created":
      apiMetrics.metrics.postsCreated.inc(labels);
      break;
    case "post_published":
      apiMetrics.metrics.postsPublished.inc(labels);
      break;
    case "media_uploaded":
      apiMetrics.metrics.mediaUploads.inc(labels);
      break;
    case "thread_created":
      apiMetrics.metrics.threadsCreated.inc(labels);
      break;
    case "tweet_created":
      apiMetrics.metrics.tweetsCreated.inc(labels);
      break;
    case "preview_requested":
      apiMetrics.metrics.previewRequests.inc(labels);
      break;
  }
}
