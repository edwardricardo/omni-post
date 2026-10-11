/**
 * @file instrumentation-client.ts
 * @description The client portal's browser instrumentation, which Next.js 16 runs before the page
 *              hydrates: Sentry's browser SDK starts here with the portal's public DSN (inlined at
 *              build time), and App Router navigations are traced through the re-exported
 *              `onRouterTransitionStart`. The admin portal calls the same
 *              `@observability/sentry-next` entry point.
 * @layer infrastructure
 */
import { initBrowserSentry } from "@observability/sentry-next/client";
import { env } from "./lib/env";

// NODE_ENV is a server variable of the `env` schema, which throws when browser code reads
// one; Next inlines `process.env.NODE_ENV` into the client bundle, so it is read raw here.
initBrowserSentry({ dsn: env.NEXT_PUBLIC_SENTRY_DSN, nodeEnv: process.env.NODE_ENV });

export { onRouterTransitionStart } from "@observability/sentry-next/client";
