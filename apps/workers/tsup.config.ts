/**
 * @file tsup.config.ts
 * @description Production ESM bundle config for the workers deployable. Compiles
 *              bootstrap.ts (the unified CMD entry) plus the two standalone worker
 *              entries (publishWorker, mentionIngestWorker — each carries an
 *              import.meta.url main-module guard for `node dist/<worker>.js` runs)
 *              and the consumed first-party workspace TS packages into
 *              apps/workers/dist/*.js, leaving node_modules external. Plain `tsup`
 *              preserves native ESM `import.meta.url`.
 * @layer infrastructure
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bootstrap.ts", "src/publishWorker.ts", "src/mentionIngestWorker.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  skipNodeModulesBundle: true,
  noExternal: [
    /^@core\//,
    /^@ports\//,
    /^@adapters\//,
    /^@observability\//,
    /^@shared\//,
    /^@monitoring\//,
    /^@infra\//,
    /^@providers\//,
    /^@packages\//,
  ],
});
