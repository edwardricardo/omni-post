/**
 * @file tsup.config.ts
 * @description Production ESM bundle config for the api deployable. Compiles
 *              src/index.ts plus the consumed first-party workspace TS packages
 *              (@core/@ports/@adapters/@observability/@shared/@monitoring/@infra/
 *              @providers/@packages) into apps/api/dist/index.js, leaving 100%
 *              of node_modules external (resolved at runtime). Plain `tsup`
 *              (NOT tsup-node) preserves native ESM `import.meta.url`.
 * @layer infrastructure
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
