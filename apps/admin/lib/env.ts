/**
 * @file env.ts
 * @description Typed environment validation for the admin Next.js app via
 *              `@t3-oss/env-nextjs`. Enforces server/client variable split:
 *              client-exposed values must be prefixed `NEXT_PUBLIC_*`, server
 *              values cannot be referenced from client components (the action
 *              would throw at runtime via `onInvalidAccess`). Mirrors the
 *              pattern of `apps/api/src/config/env.ts`.
 * @layer infrastructure
 */
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Issue shape passed to `onValidationError`. See env-core's
 * StandardSchemaV1.Issue — t3-env is schema-library-agnostic so this is the
 * neutral type, not Zod's `ZodIssue`.
 */
interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

const urlString = z.string().url();

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    /**
     * URL of the Fastify backend API. Default points at the local dev server;
     * deploy targets override via env. Currently used by:
     * - `apps/admin/app/api/auth/refresh/route.ts` (token refresh proxy)
     * - `apps/admin/app/api/backend/[...path]/route.ts` (backend proxy)
     * - `apps/admin/lib/auth/backend-client.ts` (server actions)
     */
    API_URL: urlString.default("http://localhost:3000"),
    /**
     * Sentry DSN for SERVER-SIDE error capture. Distinct from
     * NEXT_PUBLIC_SENTRY_DSN because SDK behaviour differs (server captures
     * full stack + request context; client captures user-facing errors).
     */
    SENTRY_DSN: z.string().optional(),
  },

  client: {
    /**
     * Public API URL exposed to browser bundle for direct fetches. Same value
     * as API_URL for now; kept separate so a future CDN-fronted setup can
     * point them at different hosts (server-side direct, client-side via
     * edge cache).
     */
    NEXT_PUBLIC_API_URL: urlString.default("http://localhost:3000"),
    /**
     * Public app URL used for self-redirects and link generation client-side.
     */
    NEXT_PUBLIC_URL: urlString.default("http://localhost:3100"),
    /**
     * Sentry DSN exposed to browser bundle. Safe to expose (DSN is a public
     * identifier; project-level filters in Sentry restrict ingest).
     */
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },

  /**
   * `runtimeEnv` requires every key declared in server/client to be referenced
   * statically here so Webpack's DefinePlugin can inline the values into the
   * client bundle. Without this, missing keys silently become `undefined` at
   * runtime — exactly the failure mode t3-env exists to prevent.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    API_URL: process.env.API_URL,
    SENTRY_DSN: process.env.SENTRY_DSN,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },

  emptyStringAsUndefined: true,

  onValidationError: (issues: readonly SchemaIssue[]): never => {
    const formatted = issues
      .map((i) => {
        const segments = (i.path ?? []).map((seg) =>
          typeof seg === "object" && "key" in seg ? String(seg.key) : String(seg)
        );
        const path = segments.join(".") || "(root)";
        return `  - ${path}: ${i.message}`;
      })
      .join("\n");
    throw new Error(
      `apps/admin env validation failed. Refusing to boot.\n\n` +
        `${formatted}\n\n` +
        `Reference: docs/architecture/secrets-and-env.md`
    );
  },
});

export type Env = typeof env;
