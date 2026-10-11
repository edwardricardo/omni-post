/**
 * @file client.ts
 * @description Browser-side Sentry wiring shared by the Next.js portals. Each portal's
 *              `instrumentation-client.ts`, the file Next.js 16 runs in the browser before
 *              hydration, calls `initBrowserSentry` with its public DSN and re-exports
 *              `onRouterTransitionStart`, so each App Router navigation opens a Sentry span. The
 *              init belongs in that file because a Turbopack build injects no other client file: a
 *              config file of Sentry's older convention never reaches the browser bundle.
 * @layer infrastructure
 */
import * as Sentry from "@sentry/nextjs";

/** What a portal's `instrumentation-client.ts` passes to `initBrowserSentry`. */
export interface BrowserSentryOptions {
  /** The public DSN the build inlines into the client bundle; without one Sentry stays disabled. */
  readonly dsn: string | undefined;
  /** The `NODE_ENV` the build inlines into the client bundle; `test` keeps Sentry disabled. */
  readonly nodeEnv: string | undefined;
}

/**
 * @description Initializes Sentry's browser SDK once, with the public DSN. Sentry stays disabled
 *   without a DSN or under tests, and reports `development` when the build inlined no `NODE_ENV`.
 * @param options - The portal's public DSN and inlined `NODE_ENV`.
 */
export function initBrowserSentry({ dsn, nodeEnv }: BrowserSentryOptions): void {
  Sentry.init({
    dsn,
    environment: nodeEnv ?? "development",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    enabled: Boolean(dsn) && nodeEnv !== "test",
  });
}

/** Opens a Sentry navigation span at the start of each App Router transition. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
