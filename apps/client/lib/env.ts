/**
 * @file env.ts
 * @description Typed environment validation for the client Next.js app via
 *              `@t3-oss/env-nextjs`. Enforces server/client variable split.
 *              Mirrors `apps/admin/lib/env.ts` and `apps/api/src/config/env.ts`.
 * @layer infrastructure
 */
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

const urlString = z.string().url();

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    /**
     * Backend API URL for server-side fetches (server actions, route handlers).
     */
    API_URL: urlString.default("http://localhost:3000"),
    /**
     * Alternative API base URL — aliased to API_URL. Kept as a separate key
     * because some routes reference `process.env.API_BASE_URL`.
     */
    API_BASE_URL: urlString.default("http://localhost:3000"),
    SENTRY_DSN: z.string().optional(),
  },

  client: {
    NEXT_PUBLIC_API_URL: urlString.default("http://localhost:3000"),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    API_URL: process.env.API_URL,
    API_BASE_URL: process.env.API_BASE_URL,
    SENTRY_DSN: process.env.SENTRY_DSN,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
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
      `apps/client env validation failed. Refusing to boot.\n\n` +
        `${formatted}\n\n` +
        `Reference: docs/architecture/secrets-and-env.md`
    );
  },
});

export type Env = typeof env;
