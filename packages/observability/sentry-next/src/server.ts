/**
 * @file server.ts
 * @description Server-side Sentry wiring shared by the Next.js portals. Each portal's
 *              `instrumentation.ts`, the file Next.js 16 loads on the server, re-exports the pair
 *              `createServerInstrumentation` returns: `register()` initializes Sentry's Node.js SDK
 *              once per server instance, and `onRequestError` reports the errors Next catches in
 *              server rendering, route handlers, server actions and the proxy. The portal passes
 *              its own env module as `loadEnv`, so this package reads no deployment configuration.
 * @layer infrastructure
 */
import * as Sentry from "@sentry/nextjs";

/** The part of a portal's validated `env` the server init reads. */
export interface SentryServerEnv {
  /** The server DSN; it wins over the public one. */
  readonly SENTRY_DSN?: string | undefined;
  /** The browser DSN, the server's fallback when no server DSN is set. */
  readonly NEXT_PUBLIC_SENTRY_DSN?: string | undefined;
  /** Reported as Sentry's `environment`; `test` keeps Sentry disabled. */
  readonly NODE_ENV: string;
}

/** What a portal hands `createServerInstrumentation`. */
export interface ServerInstrumentationOptions {
  /**
   * Loads the portal's env module, as `() => import("./lib/env")`. `register()` calls it on the
   * Node.js runtime only, so the module, which validates the server variables when it loads, is
   * never evaluated on the Edge runtime.
   */
  readonly loadEnv: () => Promise<{ readonly env: SentryServerEnv }>;
}

/** The two exports Next reads from a portal's `instrumentation.ts`. */
export interface ServerInstrumentation {
  /** Initializes Sentry on the Node.js runtime; Next awaits it before the first request. */
  readonly register: () => Promise<void>;
  /** Reports every error Next catches on the server to Sentry, with its route and request. */
  readonly onRequestError: typeof Sentry.captureRequestError;
}

/**
 * @description Builds the `register` and `onRequestError` exports of a portal's
 *   `instrumentation.ts`. The server DSN wins, with the public one as its fallback, and Sentry
 *   stays disabled without a DSN or under tests.
 * @param options - The portal's `loadEnv`.
 * @returns The pair the portal re-exports to Next.
 */
export function createServerInstrumentation({
  loadEnv,
}: ServerInstrumentationOptions): ServerInstrumentation {
  return {
    async register(): Promise<void> {
      // NEXT_RUNTIME is not deployment configuration: Next writes "nodejs" or "edge" into each
      // server bundle at compile time, as it does NODE_ENV, so it has no place in the validated
      // `env` schema. Read raw, the comparison is a constant the bundler folds, which keeps the
      // Node.js init out of any Edge bundle (the convention in Next's instrumentation guide).
      if (process.env.NEXT_RUNTIME !== "nodejs") return;
      const { env } = await loadEnv();
      const dsn = env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN;
      Sentry.init({
        dsn,
        environment: env.NODE_ENV,
        tracesSampleRate: 0.1,
        enabled: Boolean(dsn) && env.NODE_ENV !== "test",
      });
    },
    onRequestError: Sentry.captureRequestError,
  };
}
