/**
 * @file vitest.config.ts
 * @description Vitest configuration for @packages/query-client — jsdom environment for React,
 *              forked pool to keep TanStack Query state isolated per test.
 * @layer infrastructure
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    pool: "forks",
  },
});
