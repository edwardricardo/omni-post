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

/** The span attribute Sentry's database instrumentations write the connection's user name to. */
const DB_USER_ATTRIBUTE = "db.user";

/** A span as Sentry serializes it for `beforeSendSpan`; `@sentry/node` exports no name for it. */
type SentrySpanJson = Parameters<NonNullable<Sentry.NodeOptions["beforeSendSpan"]>>[0];

/**
 * @function stripDatabaseUser
 * @description The `beforeSendSpan` hook: removes the `db.user` attribute from a span before
 *   Sentry sends it, and changes nothing else. Sentry's own database instrumentations write the
 *   connection's user name there on every pg connect and query span: `@sentry/node` 10.76.2
 *   vendors the pg instrumentation that sets it (`build/esm/integrations/tracing/postgres/
 *   vendored/utils.js`, lines 50 and 71), and its channel-based pg integration in
 *   `@sentry/server-utils` 10.76.2 does too. The overrides that hold
 *   `@opentelemetry/instrumentation-pg` and its siblings at releases without the attribute cover
 *   only the OpenTelemetry SDK this API starts when tracing is enabled, never the copies Sentry
 *   vendors. The boot order is not a control either. `pg` loads with `@infra/prisma` before
 *   `initSentry` runs, so Sentry's pg instrumentation, the one that writes `db.user`, never
 *   attaches today; Prisma's own spans (`prisma:client:*`, and the query span with op `db`) reach
 *   Sentry in either order and never carry the attribute. Nothing holds that order, and an init
 *   moved earlier, where Sentry's setup guide places it, puts the name on every pg span. The
 *   payload gate `apps/api/tests/integration/sentryPayload.integration.test.ts` runs that order
 *   and fails when `db.user` reaches the transport, so the hook holds whatever the boot order.
 *   The hook never drops a span: Sentry no longer honours `null` here.
 * @param span - A root or child span, as Sentry serializes it immediately before sending.
 * @returns The span itself when it carries no `db.user`; otherwise a copy whose `data` lacks
 *   only that key.
 */
export function stripDatabaseUser(span: SentrySpanJson): SentrySpanJson {
  if (!Object.hasOwn(span.data, DB_USER_ATTRIBUTE)) return span;
  const { [DB_USER_ATTRIBUTE]: _dbUser, ...data } = span.data;
  return { ...span, data };
}

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
    beforeSendSpan: stripDatabaseUser,
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
