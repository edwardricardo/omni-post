/**
 * @file mediaProcessor.test-helpers.ts
 * @description Shared test helpers for InstagramMediaProcessor test suites.
 *              Provides a passthrough circuit breaker and a mock FFmpeg instance.
 *
 * NOTE: The source `mediaProcessor.ts` creates a circuit breaker at module scope.
 * Tests must use `mock.module("@adapters/external-apis", ...)` BEFORE importing
 * the processor to intercept the module-level factory call.
 */

import { mock } from "node:test";

/**
 * A circuit breaker that passes every call straight through (no circuit logic).
 * Matches the shape returned by `createExternalApiCircuitBreaker()`.
 */
export function createPassthroughCB() {
  return {
    call: async (_svc: string, _op: string, fn: (...a: any[]) => Promise<any>) => fn(),
    getAllStatuses: () => ({}),
  };
}

/**
 * A mock FFmpeg command instance with all chainable methods.
 * The `on("end", cb)` handler fires the callback after 5 ms so that
 * code paths that await the "end" event resolve immediately.
 */
export function createMockFfmpegInstance() {
  const instance: any = {
    seekInput: mock.fn(() => instance),
    duration: mock.fn(() => instance),
    videoCodec: mock.fn(() => instance),
    audioCodec: mock.fn(() => instance),
    audioBitrate: mock.fn(() => instance),
    addOption: mock.fn(() => instance),
    videoFilters: mock.fn(() => instance),
    output: mock.fn(() => instance),
    frames: mock.fn(() => instance),
    on: mock.fn((event: string, callback: Function) => {
      if (event === "end") {
        // Use queueMicrotask instead of setTimeout+unref to avoid event loop
        // draining before the callback fires (causes --test-force-exit issues)
        queueMicrotask(() => callback());
      }
      return instance;
    }),
    run: mock.fn(),
  };
  return instance;
}
