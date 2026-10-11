/**
 * @file instrumentation.ts
 * @description Server-side Sentry wiring for the admin portal, in the file Next.js 16 loads on
 *              the server. The init belongs here because Next 16 runs no other server file at
 *              startup: a config file of Sentry's older convention is never loaded. The logic lives
 *              in `@observability/sentry-next`, shared with the client portal; this file hands it
 *              the admin portal's own env module, imported only once Next runs `register()`.
 * @layer infrastructure
 */
import { createServerInstrumentation } from "@observability/sentry-next/server";

export const { register, onRequestError } = createServerInstrumentation({
  // The import is destructured so knip still sees which exports of the env module are read; a
  // namespace handed on whole would count every one of them as used.
  loadEnv: async () => {
    const { env } = await import("./lib/env");
    return { env };
  },
});
