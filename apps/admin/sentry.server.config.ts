/**
 * @file sentry.server.config.ts
 * @description Sentry server-side configuration for the admin dashboard.
 *   Initializes Node.js error tracking for SSR and API routes.
 * @layer infrastructure
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: 0.1,
  enabled:
    !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN) &&
    process.env.NODE_ENV !== "test",
});
