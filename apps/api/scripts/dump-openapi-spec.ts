/**
 * @file dump-openapi-spec.ts
 * @description Bootea `createApp()` en-memoria, dumpea `app.swagger()` a
 *   `/tmp/omnipost-openapi.json`, y cierra. Invocado por
 *   `scripts/generate-api-types.ts` en root via `pnpm --filter @apps/api dump:openapi`.
 *
 *   Vive en `apps/api/scripts/` (no en root `scripts/`) para que tsx
 *   resuelva los path aliases del `apps/api/tsconfig.json` (`@core/*`,
 *   `@adapters/*`, etc.).
 *
 *   Workstream: §3.1 Normalization Roadmap.
 *
 * @layer infrastructure
 */
import { writeFileSync } from "node:fs";

const SPEC_TMP_PATH = "/tmp/omnipost-openapi.json";

async function main() {
  console.log("🔧 Booting API (createApp) to dump OpenAPI spec…");

  const { createApp } = await import("../src/index.js");
  const app = await createApp();

  // Fastify needs ready() before swagger() reflects all registered routes.
  await app.ready();

  const spec = app.swagger();
  await app.close();

  if (!spec || typeof spec !== "object") {
    throw new Error("createApp().swagger() returned empty spec");
  }

  writeFileSync(SPEC_TMP_PATH, JSON.stringify(spec, null, 2));
  const paths = Object.keys((spec as Record<string, unknown>).paths ?? {});

  console.log(`📋 OpenAPI spec dumped (${paths.length} paths) → ${SPEC_TMP_PATH}`);
}

main().catch((err) => {
  console.error("❌ dump-openapi-spec failed:", err);
  process.exit(1);
});
