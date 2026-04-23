/**
 * @file vitest.config.ts
 * @description Vitest configuration for the browser-logger package — jsdom environment,
 *              React plugin, and forked pool for React component tests.
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
