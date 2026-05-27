/**
 * @file openapi-ts.config.ts
 * @description Config for `@hey-api/openapi-ts` (§3.1 Normalization Roadmap).
 *   Genera tipos TypeScript desde el OpenAPI spec emitido por Fastify.
 *
 *   Workflow:
 *     1. `scripts/generate-api-types.ts` bootea `createApp()` y dumpea
 *        `app.swagger()` a `/tmp/omnipost-openapi.json`.
 *     2. `pnpm exec openapi-ts` lee este config + el spec dumped y escribe
 *        a `packages/shared/src/api-generated/`.
 *
 *   Plugins habilitados (minimal):
 *     - `@hey-api/typescript`: solo tipos (types.gen.ts). Sin SDK ni runtime
 *       client por ahora — Phase A es type-only. Phase B podrá agregar
 *       `@hey-api/sdk` cuando los frontends consuman más endpoints.
 *
 * @layer infrastructure
 */
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "/tmp/omnipost-openapi.json",
  output: {
    path: "packages/shared/src/api-generated",
  },
  // `postProcess: ['prettier']` reemplaza el deprecated `format: 'prettier'`.
  postProcess: ["prettier"],
  plugins: ["@hey-api/typescript"],
});
