/**
 * Shared test helpers for VideoProcessor tests.
 * Provides mock spawn infrastructure, fs mocks, and spawn response queue.
 *
 * spawn is injected via constructor DI -- no module-level mock needed.
 */
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { promises as fs } from "fs";

/**
 * Spawn call response descriptor.
 * When multiple entries are queued, each successive spawn call consumes
 * the next entry. Once the queue is exhausted, the last entry is reused.
 */
export interface SpawnResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Queue of responses -- each spawn call pops from the front, last is repeated */
export const spawnResponseQueue: SpawnResponse[] = [];

/** Shared mock state for single-call tests (convenience alias into queue[0]) */
export const mockSpawnState = {
  get stdout() {
    return spawnResponseQueue[0]?.stdout ?? "";
  },
  set stdout(v: string) {
    if (spawnResponseQueue[0]) spawnResponseQueue[0].stdout = v;
  },
  get stderr() {
    return spawnResponseQueue[0]?.stderr ?? "";
  },
  set stderr(v: string) {
    if (spawnResponseQueue[0]) spawnResponseQueue[0].stderr = v;
  },
  get exitCode() {
    return spawnResponseQueue[0]?.exitCode ?? 0;
  },
  set exitCode(v: number) {
    if (spawnResponseQueue[0]) spawnResponseQueue[0].exitCode = v;
  },
};

/** Reset the response queue to a single state (used before most tests) */
export function _setSpawnResponse(stdout: string, stderr: string, exitCode: number): void {
  spawnResponseQueue.length = 0;
  spawnResponseQueue.push({ stdout, stderr, exitCode });
}

/** Queue a sequence of responses (used when processVideo calls ffprobe then ffmpeg) */
export function queueSpawnResponses(...responses: SpawnResponse[]): void {
  spawnResponseQueue.length = 0;
  spawnResponseQueue.push(...responses);
}

/** Factory for a fake ChildProcess. Each call consumes the next queued response. */
export function createMockSpawn() {
  return function mockSpawn(_command: string, _args: string[]): ChildProcess {
    // Consume the first response, fall back to repeating the last one
    const response =
      spawnResponseQueue.length > 1
        ? spawnResponseQueue.shift()!
        : (spawnResponseQueue[0] ?? { stdout: "", stderr: "", exitCode: 0 });

    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    const proc = new EventEmitter() as ChildProcess;

    proc.stdout = stdoutEmitter as any;
    proc.stderr = stderrEmitter as any;

    process.nextTick(() => {
      if (response.stdout) {
        stdoutEmitter.emit("data", Buffer.from(response.stdout));
      }
      if (response.stderr) {
        stderrEmitter.emit("data", Buffer.from(response.stderr));
      }
      proc.emit("close", response.exitCode);
    });

    return proc;
  };
}

// Mock fs operations -- in-memory file registry
export const mockFsData = {
  files: new Map<string, boolean>(),
};

/**
 * Custom stat size override. When non-null, fs.stat returns this size
 * instead of the default 10MB. Reset to null in beforeEach.
 */
export let statSizeOverride: number | null = null;

/** Update statSizeOverride from test files (module-level let workaround) */
export function setStatSizeOverride(value: number | null): void {
  statSizeOverride = value;
}

/**
 * Sets up fs mocks scoped to the current test via vi.spyOn().
 * Automatically restored after each test completes.
 */
export function setupFsMocks(_t: import("vitest").TestContext): void {
  vi.spyOn(fs, "access").mockImplementation(async (path: string) => {
    if (!mockFsData.files.has(path as string)) {
      throw new Error(`ENOENT: no such file or directory, access '${path}'`);
    }
  });

  vi.spyOn(fs, "stat").mockImplementation(async (path: string) => {
    if (!mockFsData.files.has(path)) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }
    return {
      size: statSizeOverride ?? 10 * 1024 * 1024,
      isFile: () => true,
    } as any;
  });

  vi.spyOn(fs, "mkdir").mockImplementation(async () => {
    return undefined;
  });
}

/** Reset shared state before each test */
export function resetSharedState(): void {
  spawnResponseQueue.length = 0;
  spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
  statSizeOverride = null;
  mockFsData.files.clear();
}
