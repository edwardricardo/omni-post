/**
 * Centralized Error Handling Module
 *
 * This module provides:
 * - Standardized error codes
 * - Type-safe error classes with factory methods
 * - Secure error handling that prevents information leakage
 * - Automatic sanitization of errors before sending to clients
 * - Fastify plugin for centralized error handling
 */

export {
  // Base error class with factory methods
  AppError,
} from "./AppError.js";
