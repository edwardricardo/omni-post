/**
 * @file mediaProcessor.test-helpers.ts
 * @description Shared test helpers for InstagramMediaProcessor test suites.
 *              Provides a passthrough circuit breaker and a mock FFmpeg instance.
 *
 * NOTE: The source `mediaProcessor.ts` creates a circuit breaker at module scope.
 * Tests must use `vi.mock("@adapters/external-apis", ...)` BEFORE importing
 * the processor to intercept the module-level factory call.
 */

import { vi } from "vitest";

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
    seekInput: vi.fn(() => instance),
    duration: vi.fn(() => instance),
    videoCodec: vi.fn(() => instance),
    audioCodec: vi.fn(() => instance),
    audioBitrate: vi.fn(() => instance),
    addOption: vi.fn(() => instance),
    videoFilters: vi.fn(() => instance),
    output: vi.fn(() => instance),
    frames: vi.fn(() => instance),
    on: vi.fn((event: string, callback: Function) => {
      if (event === "end") {
        // Use queueMicrotask instead of setTimeout+unref to avoid event loop
        // draining before the callback fires
        queueMicrotask(() => callback());
      }
      return instance;
    }),
    run: vi.fn(),
  };
  return instance;
}
