/**
 * Environment Variable Validation Utilities
 *
 * Provides safe access to required environment variables with strict
 * enforcement in production and developer-friendly fallbacks in development.
 */

import { createLogger } from "./logger.js";

const envLogger = createLogger("env-validation");

/**
 * Retrieve a required secret from environment variables.
 *
 * - In production (NODE_ENV === "production"): throws if the env var is not set.
 * - In development/test: returns the env var if set, otherwise returns
 *   devFallback and logs a warning.
 *
 * @param envVar - The name of the environment variable to read
 * @param devFallback - Fallback value used only in non-production environments
 * @returns The secret value
 * @throws Error if the env var is missing in production
 */
export function getRequiredSecret(envVar: string, devFallback: string): string {
  const value = process.env[envVar];

  if (value) {
    return value;
  }

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    throw new Error(
      `Missing required environment variable: ${envVar}. ` +
        "This variable must be set in production. " +
        "The application cannot start without it."
    );
  }

  envLogger.warn(
    { envVar },
    `Environment variable ${envVar} is not set. Using development fallback. ` +
      "Set this variable before deploying to production."
  );

  return devFallback;
}
