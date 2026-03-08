/**
 * Shared test helpers for ThumbnailGenerator tests.
 *
 * All mock setup uses `t.mock.method()` inside `beforeEach` callbacks so that
 * mocks are scoped to each test and automatically restored afterwards.
 * This avoids the dangerous pattern of module-level `mock.method()` calls
 * that persist across all tests in a file.
 */
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type { TestContext } from "node:test";
import { promises as fs } from "fs";

/** Mutable state that each test mutates to control spawn behaviour. */
export const mockSpawnState = {
  stdout: "",
  stderr: "",
  exitCode: 0,
};

/**
 * Factory that returns a mock spawn function.
 * The returned function creates a fake ChildProcess whose stdout/stderr/close
 * events are driven entirely by `mockSpawnState` at call time.
 */
export function createMockSpawn() {
  return function mockSpawn(_command: string, _args: string[]): ChildProcess {
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    const proc = new EventEmitter() as ChildProcess;

    proc.stdout = stdoutEmitter as any;
    proc.stderr = stderrEmitter as any;

    process.nextTick(() => {
      if (mockSpawnState.stdout) {
        stdoutEmitter.emit("data", Buffer.from(mockSpawnState.stdout));
      }
      if (mockSpawnState.stderr) {
        stderrEmitter.emit("data", Buffer.from(mockSpawnState.stderr));
      }
      proc.emit("close", mockSpawnState.exitCode);
    });

    return proc;
  };
}

/** Shared in-memory filesystem state used by all setupFsMocks() calls. */
export const mockFsData = {
  files: new Map<string, Buffer>(),
  stats: new Map<string, { size: number; mtime: Date }>(),
};

/**
 * Apply t.mock.method patches to `fs` (the `fs.promises` object).
 * Call this inside a `beforeEach((t) => { ... })` callback, passing the
 * test context's mock object and the `promises as fs` import from `"fs"`.
 *
 * Because `t.mock.method` auto-restores after each test, there is no
 * cross-test contamination.
 *
 * @example
 * import { beforeEach } from "node:test";
 * import { promises as fs } from "fs";
 * import { setupFsMocks } from "./thumbnailGenerator.test-helpers.js";
 *
 * describe("Feature", () => {
 *   beforeEach((t) => {
 *     setupFsMocks(t, fs);
 *   });
 * });
 */
export function setupFsMocks(t: TestContext, fsPromises: typeof fs): void {
  t.mock.method(fsPromises, "stat", async (path: string) => {
    const stats = mockFsData.stats.get(path);
    if (!stats) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }
    return stats as any;
  });

  t.mock.method(fsPromises, "readFile", async (path: string) => {
    const content = mockFsData.files.get(path);
    if (!content) {
      throw new Error(`ENOENT: no such file or directory, readFile '${path}'`);
    }
    return content;
  });

  t.mock.method(fsPromises, "writeFile", async (path: string, data: Buffer | string) => {
    mockFsData.files.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data));
    mockFsData.stats.set(path, { size: Buffer.byteLength(data), mtime: new Date() });
  });

  t.mock.method(fsPromises, "mkdir", async () => {
    return undefined;
  });

  t.mock.method(fsPromises, "rm", async () => {
    return undefined;
  });

  t.mock.method(fsPromises, "access", async (path: string) => {
    if (!mockFsData.files.has(path) && !mockFsData.stats.has(path)) {
      throw new Error(`ENOENT: no such file or directory, access '${path}'`);
    }
  });
}
