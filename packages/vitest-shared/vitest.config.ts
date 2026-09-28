/**
 * @file vitest.config.ts
 * @description Vitest config for @packages/vitest-shared. It calls the factory this package
 *              exports, so the package tests itself through the same entry point every other
 *              package uses: a change that breaks the factory's defaults breaks this suite
 *              before it reaches the 85 configs downstream. The import is relative because it
 *              is intra-package — the header of `src/index.ts` forbids a relative specifier
 *              that crosses package boundaries, which this one does not.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "./src/index.js";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
