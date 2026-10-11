/**
 * @file instrumentation.ts
 * @description The client portal's server instrumentation, the module Next.js 16 imports when a
 *              server instance starts: its `register()` initializes Sentry's Node.js SDK, and its
 *              `onRequestError` reports what Next catches on the server. Both come from
 *              `@observability/sentry-next`, which the admin portal shares; the portal contributes
 *              its env module, loaded inside `register()` and never on the Edge runtime.
 * @layer infrastructure
 */
import { createServerInstrumentation } from "@observability/sentry-next/server";

export const { register, onRequestError } = createServerInstrumentation({
  // Destructured rather than returned whole: a module namespace that escapes reads to knip as
  // every export used, and the env module's unused exports would leave its report.
  loadEnv: async () => {
    const { env } = await import("./lib/env");
    return { env };
  },
});
