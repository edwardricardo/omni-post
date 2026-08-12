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
import react from "@vitejs/plugin-react";
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
  // @vitejs/plugin-react handles the JSX transform explicitly (mirrors apps/admin).
  // Without it, vite 8's default rolldown SSR parser fails to parse JSX in these test
  // files ("Unexpected JSX expression"); with it, apps/client runs on vite 8 —
  // eliminating the former vite 7/8 catalog split (ADR-0019).
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./lib/api/__tests__/setup.ts"],
    globals: true,
    // A committed `.only()` silently reduces the suite to one test and still
    // exits 0, so CI reports green on a run that proved almost nothing. Fail the
    // run instead (canon: "Zero .only() committed"); apps/api sets the same flag.
    forbidOnly: true,
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
