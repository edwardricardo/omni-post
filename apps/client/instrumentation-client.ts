/**
 * @file instrumentation-client.ts
 * @description Browser-side Sentry wiring for the client portal, in the file Next.js 16 runs in
 *              the browser before hydration. It initializes Sentry's browser SDK with the public
 *              DSN, which the build inlines into the client bundle, and exports
 *              `onRouterTransitionStart` so each App Router navigation opens a Sentry span. The
 *              init belongs here because a Turbopack build injects no other client file: a
 *              config file of Sentry's older convention never reaches the browser bundle.
 * @layer infrastructure
 */
import * as Sentry from "@sentry/nextjs";
import { env } from "./lib/env";

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN,
  // NODE_ENV is a server variable of the `env` schema, which throws when browser code reads
  // one; Next inlines `process.env.NODE_ENV` into the client bundle, so it is read raw here.
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  enabled: Boolean(env.NEXT_PUBLIC_SENTRY_DSN) && process.env.NODE_ENV !== "test",
});

/** Opens a Sentry navigation span at the start of each App Router transition. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
