/**
 * @file instrumentation-client.ts
 * @description Browser-side Sentry wiring for the admin portal, in the file Next.js 16 runs in
 *              the browser before hydration. It initializes Sentry's browser SDK with the public
 *              DSN, which the build inlines into the client bundle, and re-exports
 *              `onRouterTransitionStart` so each App Router navigation opens a Sentry span. Both
 *              come from `@observability/sentry-next`, shared with the client portal.
 * @layer infrastructure
 */
import { initBrowserSentry } from "@observability/sentry-next/client";
import { env } from "./lib/env";

// NODE_ENV is a server variable of the `env` schema, which throws when browser code reads
// one; Next inlines `process.env.NODE_ENV` into the client bundle, so it is read raw here.
initBrowserSentry({ dsn: env.NEXT_PUBLIC_SENTRY_DSN, nodeEnv: process.env.NODE_ENV });

export { onRouterTransitionStart } from "@observability/sentry-next/client";
