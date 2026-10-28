/**
 * @file openapi-ts.config.ts
 * @description Config for `@hey-api/openapi-ts`, whose design and status the OpenAPI
 *   auto-generation entry of `docs/architecture/NORMALIZATION_ROADMAP.md` records.
 *   Generates TypeScript types from the OpenAPI spec emitted by Fastify.
 *
 *   Workflow:
 *     1. `scripts/generate-api-types.ts` boots `createApp()` and dumps
 *        `app.swagger()` to `/tmp/omnipost-openapi.json`.
 *     2. `pnpm exec openapi-ts` reads this config + the dumped spec and writes
 *        to `packages/shared/src/api-generated/`.
 *
 *   Plugins enabled (minimal):
 *     - `@hey-api/typescript`: types only (types.gen.ts). No SDK and no runtime
 *       client for now — the output is type-only. `@hey-api/sdk` can be added
 *       when the frontends consume more endpoints.
 *
 * @layer infrastructure
 */
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "/tmp/omnipost-openapi.json",
  output: {
    path: "packages/shared/src/api-generated",
  },
  // `postProcess: ['prettier']` replaces the deprecated `format: 'prettier'`.
  postProcess: ["prettier"],
  plugins: ["@hey-api/typescript"],
});
