/**
 * @file sentry.server.config.ts
 * @description Sentry server-side configuration for the admin dashboard.
 *   Initializes Node.js error tracking for SSR and API routes.
 * @layer infrastructure
 */

import * as Sentry from "@sentry/nextjs";
import { env } from "./lib/env";

Sentry.init({
  dsn: env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: 0.1,
  enabled: !!(env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN) && process.env.NODE_ENV !== "test",
});
