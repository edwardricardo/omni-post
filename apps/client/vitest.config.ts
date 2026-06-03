/**
 * @file vitest.config.ts
 * @description Vitest configuration for the client app — jsdom environment, setup file, and
 *              @/ path alias resolution.
 * @layer infrastructure
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./lib/api/__tests__/setup.ts"],
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**"],
    // Cap parallel workers (default is one per CPU). jsdom workers are heavy;
    // running the whole suite that wide OOM-collapses the memory-constrained dev
    // box. Two workers bounds peak memory while keeping some parallelism.
    // (vitest 4 dropped `poolOptions`; `maxWorkers` is the supported cap.)
    pool: "forks",
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@packages/api-errors": path.resolve(__dirname, "../../packages/api-errors/src/index.ts"),
      "@packages/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts"),
      // Sub-path alias for the runtime-free scheduling CSV schema module.
      // Points at the schema file directly (not the barrel index or the server parser)
      // so Vite/Vitest never attempts to resolve csv-parse (server-only dep).
      "@core/bulk-scheduling/schedulingCsvSchema.js": path.resolve(
        __dirname,
        "../../packages/core/bulk-scheduling/src/schedulingCsvSchema.ts"
      ),
    },
  },
});
