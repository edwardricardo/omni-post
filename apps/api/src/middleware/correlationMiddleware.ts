/**
 * Correlation ID Middleware
 *
 * Adds correlation IDs to all requests for distributed tracing.
 * The correlation ID is:
 * 1. Taken from X-Correlation-ID header if present (forwarded from upstream)
 * 2. Generated as a new UUID if not present
 * 3. Added to the response headers
 * 4. Made available throughout the request lifecycle
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { createRequestLogger, httpLogger } from "../lib/logger.js";

/**
 * Correlation ID header name (standard across microservices)
 */
export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Generate a new correlation ID
 */
function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Extract correlation ID from request headers or generate new one
 */
function getOrCreateCorrelationId(request: FastifyRequest): string {
  const existingId = request.headers[CORRELATION_ID_HEADER];

  if (typeof existingId === "string" && existingId.length > 0) {
    return existingId;
  }

  return generateCorrelationId();
}

/**
 * Register correlation ID middleware
 */
export async function correlationMiddleware(fastify: FastifyInstance): Promise<void> {
  // Add correlation ID to every request
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Get or create correlation ID
    const correlationId = getOrCreateCorrelationId(request);
    const requestId = generateCorrelationId();

    // Attach to request for access in handlers
    request.correlationId = correlationId;
    request.requestId = requestId;

    // Add to response headers for client tracking
    reply.header(CORRELATION_ID_HEADER, correlationId);
    reply.header(REQUEST_ID_HEADER, requestId);
  });

  // Log request with correlation ID
  fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const responseTime = reply.elapsedTime;

    // Create request-scoped logger
    const requestLogger = createRequestLogger({
      correlationId: request.correlationId ?? "unknown",
      ...(request.requestId !== undefined && { requestId: request.requestId }),
      ...(request.userId !== undefined && { userId: request.userId }),
      path: request.url,
      method: request.method,
    });

    // Log the completed request
    const logData = {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: Math.round(responseTime * 100) / 100,
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    };

    if (reply.statusCode >= 500) {
      requestLogger.error(logData, "Request failed");
    } else if (reply.statusCode >= 400) {
      requestLogger.warn(logData, "Request error");
    } else {
      requestLogger.info(logData, "Request completed");
    }
  });

  // Log errors with correlation ID
  fastify.addHook("onError", async (request: FastifyRequest, reply: FastifyReply, error: Error) => {
    const requestLogger = createRequestLogger({
      correlationId: request.correlationId ?? "unknown",
      ...(request.requestId !== undefined && { requestId: request.requestId }),
      ...(request.userId !== undefined && { userId: request.userId }),
      path: request.url,
      method: request.method,
    });

    requestLogger.error(
      {
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack,
        },
        method: request.method,
        url: request.url,
      },
      "Request error occurred"
    );
  });

  httpLogger.info("Correlation ID middleware registered");
}

/**
 * Get correlation ID from request (utility for handlers)
 */
export function getCorrelationId(request: FastifyRequest): string {
  return request.correlationId || "unknown";
}

/**
 * Get request ID from request (utility for handlers)
 */
export function getRequestId(request: FastifyRequest): string {
  return request.requestId || "unknown";
}
