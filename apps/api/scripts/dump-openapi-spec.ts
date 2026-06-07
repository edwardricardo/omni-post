/**
 * @file dump-openapi-spec.ts
 * @description Boots `createApp()` in-memory, dumps `app.swagger()` to
 *   `/tmp/omnipost-openapi.json`, and exits. Invoked by
 *   `scripts/generate-api-types.ts` at repo root via `pnpm --filter @apps/api dump:openapi`.
 *
 *   Lives in `apps/api/scripts/` (not the root `scripts/`) so tsx resolves
 *   the path aliases declared in `apps/api/tsconfig.json` (`@core/*`,
 *   `@adapters/*`, etc.).
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
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ dump-openapi-spec failed:", err);
  process.exit(1);
});
