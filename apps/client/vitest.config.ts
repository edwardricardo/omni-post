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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
