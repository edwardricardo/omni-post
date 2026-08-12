/**
 * @file vitest.config.ts
 * @description Vitest configuration for the admin app — jsdom environment,
 *   @vitejs/plugin-react, and `resolve.alias` that composes app-local aliases
 *   (from admin's OWN tsconfig.json) FIRST, then the shared workspace alias map
 *   derived from `tsconfig.base.json` (single source shared with every package
 *   config). No third-party tsconfig-paths plugin — its transitive `tsconfck`
 *   declares `peerDependencies.typescript: ^5.0.0`, conflicting with our
 *   TypeScript 6 install — so the workspace specifiers come from the shared
 *   derived map instead. @rollup/plugin-alias matches in array order, so the
 *   precedence-sensitive app-local entries must precede the generic map.
 * @layer infrastructure
 */
import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { buildWorkspaceAliases, findMonorepoRoot } from "../../vitest.shared";

const root = findMonorepoRoot(__dirname);

// App-local aliases — resolved BEFORE the shared workspace map (precedence is
// array order). These come from admin's OWN tsconfig.json, which OVERRIDES the
// base `@shared/*` paths and has NO bare `@shared/*`:
//  - `@shared/types/*` deep imports + bare index.
//  - `@packages/api-errors` index.
//  - `@` → app root.
const appLocalAliases: { find: string; replacement: string }[] = [
  // @shared/types/* sub-path — mirrors admin tsconfig.json `"@shared/types/*"` -> src/*
  // (admin OVERRIDES the base paths and has NO bare `@shared/*`). Must precede the
  // exact `@shared/types` alias below so the longer prefix wins in @rollup/plugin-alias.
  { find: "@shared/types/", replacement: path.resolve(root, "packages/shared/src") + "/" },
  { find: "@shared/types", replacement: path.resolve(root, "packages/shared/src/index.ts") },
  {
    find: "@packages/api-errors",
    replacement: path.resolve(root, "packages/api-errors/src/index.ts"),
  },
  { find: "@", replacement: path.resolve(__dirname, "./") },
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    // App-local aliases FIRST (precedence), then the shared workspace map derived
    // from tsconfig.base.json. @rollup/plugin-alias matches in array order.
    alias: [...appLocalAliases, ...buildWorkspaceAliases(root)],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/unit/setup.ts"],
    globals: true,
    // A committed `.only()` silently reduces the suite to one test and still
    // exits 0, so CI reports green on a run that proved almost nothing. Fail the
    // run instead (canon: "Zero .only() committed"); apps/api sets the same flag.
    forbidOnly: true,
    exclude: [
      "**/node_modules/**",
      "**/e2e/**",
      // Plain fetch scripts with no vitest syntax
      "tests/apiClient.smoke.test.ts",
      "tests/posts.flow.test.ts",
    ],
  },
});
