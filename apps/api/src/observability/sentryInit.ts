/**
 * @file sentryInit.ts
 * @description Sentry initialization for the API server.
 *   Reads DSN from MONITORING credentials in PlatformCredentialService.
 *   Must be called after the DI container is set up.
 *   Idempotent — calling multiple times is safe.
 * @layer infrastructure
 */

import * as Sentry from "@sentry/node";
import { createLogger } from "../lib/logger.js";
import { env } from "../config/env.js";

const sentryLogger = createLogger("sentry");

let initialized = false;

/**
 * @function initSentry
 * @description Initializes Sentry error tracking. Skips in test environment.
 * @param dsn - Sentry DSN from MONITORING credentials (null to skip)
 * @param environment - Runtime environment name
 * @param tracesSampleRate - Sampling rate for performance traces (0-1)
 */
export function initSentry(
  dsn: string | null,
  environment: string = env.NODE_ENV ?? "development",
  tracesSampleRate: number = 0.1
): void {
  if (initialized) return;
  if (environment === "test") return;

  if (!dsn) {
    sentryLogger.info("Sentry DSN not configured — error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: Math.min(Math.max(tracesSampleRate, 0), 1),
    beforeSend(event) {
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value?.includes("ECONNREFUSED") || ex.value?.includes("ENOTFOUND")) {
            return null;
          }
        }
      }
      return event;
    },
  });

  initialized = true;
  sentryLogger.info({ environment, tracesSampleRate }, "Sentry initialized");
}

/**
 * @function captureError
 * @description Captures an exception to Sentry if initialized. Safe to call anytime.
 * @param error - The error to capture
 * @param context - Optional extra context
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  if (context) {
    Sentry.captureException(error, { extra: context });
  } else {
    Sentry.captureException(error);
  }
}

export { Sentry };
