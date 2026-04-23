/**
 * @file vitest.config.ts
 * @description Vitest configuration for the admin app — jsdom environment, @vitejs/plugin-react,
 *              vite-tsconfig-paths for alias resolution, and unit-test setup file.
 * @layer infrastructure
 */
import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths({ ignoreConfigErrors: true }), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
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
