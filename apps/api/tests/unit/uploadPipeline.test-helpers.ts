/**
 * Shared test helpers for VideoUploadPipeline tests.
 *
 * Exports mockFsData (shared mutable state) and setupFsMocks() which applies
 * mock.method() overrides for all fs.promises operations used by uploadPipeline.ts.
 *
 * When called with a TestContext argument, uses t.mock.method() for auto-cleanup.
 * When called without arguments, falls back to the global mock.method() for
 * backward compatibility with test files that haven't been migrated yet.
 */
import { mock } from "node:test";
import type { TestContext } from "node:test";
import { promises as fs } from "fs";

export const mockFsData = {
  files: new Map<string, Buffer>(),
  stats: new Map<string, { size: number; isDirectory: () => boolean }>(),
  fileHandles: new Map<string, unknown>(),
};

/**
 * Install fs mocks. Accepts an optional TestContext for scoped cleanup.
 * If no TestContext is provided, uses the global mock API.
 */
export function setupFsMocks(t?: TestContext): void {
  const mockApi = t ? t.mock : mock;

  mockApi.method(fs, "stat", async (path: string) => {
    const stats = mockFsData.stats.get(path);
    if (!stats) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }
    return stats as ReturnType<typeof fs.stat> extends Promise<infer S> ? S : never;
  });

  mockApi.method(fs, "open", async (path: string, _flags: string) => {
    const buffer = mockFsData.files.get(path);
    if (!buffer) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    const handle = {
      path,
      buffer,
      async read(targetBuffer: Buffer, offset: number, length: number, position: number) {
        const sourceData = buffer.slice(position, position + length);
        sourceData.copy(targetBuffer, offset);
        return { bytesRead: sourceData.length, buffer: targetBuffer };
      },
      async close() {
        return;
      },
    };

    mockFsData.fileHandles.set(path, handle);
    return handle as ReturnType<typeof fs.open> extends Promise<infer H> ? H : never;
  });

  mockApi.method(fs, "writeFile", async (path: string, data: Buffer | string) => {
    mockFsData.files.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data));
  });

  mockApi.method(fs, "readFile", async (path: string) => {
    const content = mockFsData.files.get(path);
    if (!content) {
      throw new Error(`ENOENT: no such file or directory, readFile '${path}'`);
    }
    return content;
  });

  mockApi.method(fs, "mkdir", async () => {
    return undefined;
  });

  mockApi.method(fs, "rm", async () => {
    return undefined;
  });

  mockApi.method(fs, "unlink", async () => {
    return undefined;
  });
}
