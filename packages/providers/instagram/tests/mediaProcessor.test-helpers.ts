/**
 * @file mediaProcessor.test-helpers.ts
 * @description Shared test helpers for InstagramMediaProcessor test suites.
 *              Provides a passthrough circuit breaker and mock execFileAsync for ffprobe/ffmpeg.
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
 * Default ffprobe JSON output used by mock execFileAsync.
 */
export const DEFAULT_PROBE_DATA = {
  streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
  format: { duration: "45.5", bit_rate: "2500000", format_name: "mp4,mov" },
};

/**
 * Creates the mock for node:child_process that intercepts execFile.
 * Returns the mock function so tests can override behavior per-test.
 */
export function createExecFileMock(probeDataFn: () => any = () => DEFAULT_PROBE_DATA) {
  const execFileMockFn = vi.fn(
    (
      cmd: string,
      _args: string[],
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      if (cmd === "ffprobe") {
        const data = probeDataFn();
        if (data instanceof Error) {
          callback(data, { stdout: "", stderr: data.message });
        } else {
          callback(null, { stdout: JSON.stringify(data), stderr: "" });
        }
      } else {
        // ffmpeg command -- just succeed
        callback(null, { stdout: "", stderr: "" });
      }
    }
  );
  return execFileMockFn;
}
