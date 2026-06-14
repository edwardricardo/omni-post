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
  // @infra/prisma is EXTERNAL (not bundled): the Prisma 7 generated client is raw
  // TS with an `import * as Prisma` namespace re-export that esbuild cannot bundle
  // (build-time "No matching export") and mangles at runtime (fileURLToPath/node:path
  // — prisma/prisma#27324, #28126). Per Prisma 7's blessed path it is tsc-compiled
  // to JS separately and externalized; only the first-party app + the rest of the
  // workspace TS is bundled here. An onResolve plugin forces it external BEFORE the
  // tsconfig-paths alias can redirect `@infra/prisma` to its raw `src/*.ts`.
  esbuildPlugins: [
    {
      name: "external-infra-prisma",
      setup(build) {
        build.onResolve({ filter: /^@infra\// }, () => ({ external: true }));
      },
    },
  ],
  noExternal: [
    /^@core\//,
    /^@ports\//,
    /^@adapters\//,
    /^@observability\//,
    /^@shared\//,
    /^@monitoring\//,
    /^@providers\//,
    /^@packages\//,
  ],
});
