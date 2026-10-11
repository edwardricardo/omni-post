/**
 * @file instrumentation.ts
 * @description Server-side Sentry wiring for the client portal, in the file Next.js 16 loads on
 *              the server. `register()` initializes Sentry's Node.js SDK once per server
 *              instance, and `onRequestError` reports the errors Next catches in server
 *              rendering, route handlers, server actions and the proxy. The init belongs
 *              here because Next 16 runs no other server file at startup: a config file of
 *              Sentry's older convention is never loaded, and Sentry stays uninitialized.
 * @layer infrastructure
 */
import * as Sentry from "@sentry/nextjs";

/**
 * @description Initializes Sentry on the Node.js runtime. Next calls it once when a server
 *   instance starts and waits for it before the first request. The server DSN wins, with the
 *   public one as its fallback, and Sentry stays disabled without a DSN or under tests.
 */
export async function register(): Promise<void> {
  // NEXT_RUNTIME is not deployment configuration: Next writes "nodejs" or "edge" into each
  // server bundle at compile time, as it does NODE_ENV, so it has no place in the validated
  // `env` schema. Read raw, the comparison is a constant the bundler folds, which keeps the
  // Node.js init out of any Edge bundle (the convention in Next's instrumentation guide).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("./lib/env");
  const dsn = env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN;
  Sentry.init({
    dsn,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
    enabled: Boolean(dsn) && env.NODE_ENV !== "test",
  });
}

/** Reports every error Next catches on the server to Sentry, with its route and request. */
export const onRequestError = Sentry.captureRequestError;
