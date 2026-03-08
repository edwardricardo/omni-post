/**
 * Fastify Error Handler Plugin
 *
 * Registers centralized error handling for the entire application.
 * SECURITY: Ensures no internal details are leaked to clients.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createErrorHandler } from "./errorHandler.js";

/**
 * Error Handler Plugin
 *
 * This plugin registers the centralized error handler that:
 * - Catches all unhandled errors
 * - Sanitizes error messages before sending to clients
 * - Logs full error details internally for debugging
 * - Prevents exposure of stack traces, database schema, or internal paths
 */
const errorHandlerPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Register the error handler
  const errorHandler = createErrorHandler(fastify.log);
  fastify.setErrorHandler(errorHandler);

  fastify.log.info("Error handler plugin registered");
};

// Export as Fastify plugin
export default fp(errorHandlerPlugin, {
  name: "error-handler",
  fastify: ">=5.0.0",
});
