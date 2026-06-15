/**
 * @file vitest.config.ts
 * @description Vitest configuration for the client app — jsdom environment, setup file, and
 *              @/ path alias resolution. App-local aliases (jsdom-specific overrides + the `@`
 *              app-root alias) are composed FIRST, then the shared workspace alias map derived
 *              from `tsconfig.base.json` (single source shared with every package config).
 *              @rollup/plugin-alias matches in array order, so app-local precedence-sensitive
 *              entries must precede the generic workspace map.
 * @layer infrastructure
 */
import { defineConfig } from "vitest/config";
import path from "node:path";
import { buildWorkspaceAliases, findMonorepoRoot } from "../../vitest.shared";

const root = findMonorepoRoot(__dirname);

// App-local aliases — resolved BEFORE the shared workspace map (precedence is
// array order). These come from the app's OWN tsconfig.json, not tsconfig.base.json:
//  - `@packages/ui/*` deep imports + bare index (mirrors client tsconfig).
//  - the runtime-free scheduling CSV schema override (avoids the server-only
//    csv-parse dep that the barrel index would pull in).
//  - `@packages/api-errors` index.
//  - `@` → app root.
const appLocalAliases: { find: string; replacement: string }[] = [
  // @packages/ui/* sub-path — mirrors client tsconfig.json `"@packages/ui/*"` -> src/*
  // so deep imports like @packages/ui/components/business/ChannelMultiSelect resolve at
  // test time. Must precede the exact `@packages/ui` alias so the longer prefix wins.
  { find: "@packages/ui/", replacement: path.resolve(root, "packages/ui/src") + "/" },
  { find: "@packages/ui", replacement: path.resolve(root, "packages/ui/src/index.ts") },
  // Sub-path alias for the runtime-free scheduling CSV schema module.
  // Points at the schema file directly (not the barrel index or the server parser)
  // so Vite/Vitest never attempts to resolve csv-parse (server-only dep).
  {
    find: "@core/bulk-scheduling/schedulingCsvSchema.js",
    replacement: path.resolve(root, "packages/core/bulk-scheduling/src/schedulingCsvSchema.ts"),
  },
  {
    find: "@packages/api-errors",
    replacement: path.resolve(root, "packages/api-errors/src/index.ts"),
  },
  { find: "@", replacement: path.resolve(__dirname, "./") },
];

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
    // App-local aliases FIRST (precedence), then the shared workspace map derived
    // from tsconfig.base.json. @rollup/plugin-alias matches in array order.
    alias: [...appLocalAliases, ...buildWorkspaceAliases(root)],
  },
});
