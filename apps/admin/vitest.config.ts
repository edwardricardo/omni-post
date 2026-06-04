/**
 * @file vitest.config.ts
 * @description Vitest configuration for the admin app — jsdom environment,
 *   @vitejs/plugin-react, explicit `resolve.alias` mirroring tsconfig.json
 *   `paths` (no third-party tsconfig-paths plugin — its transitive `tsconfck`
 *   declares `peerDependencies.typescript: ^5.0.0` which conflicts with our
 *   TypeScript 6 install). Aliases must stay in sync with `tsconfig.json`.
 * @layer infrastructure
 */
import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@packages/api-errors": path.resolve(__dirname, "../../packages/api-errors/src/index.ts"),
      "@shared/types": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      // @shared/* wildcard — mirrors tsconfig.base.json `"@shared/*"` path mapping
      // so sub-path imports like @shared/stores/notificationStore resolve at test time.
      // Note: @shared/types alias above takes precedence for the exact key.
      "@shared/": path.resolve(__dirname, "../../packages/shared/src") + "/",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/unit/setup.ts"],
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/e2e/**",
      // Plain fetch scripts with no vitest syntax
      "tests/apiClient.smoke.test.ts",
      "tests/posts.flow.test.ts",
    ],
  },
});
