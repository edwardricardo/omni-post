/**
 * Shared test helpers for VideoUploadPipeline tests.
 *
 * Exports mockFsData (shared mutable state) and setupFsMocks() which applies
 * vi.spyOn() overrides for all fs.promises operations used by uploadPipeline.ts.
 */
import { vi } from "vitest";
import { promises as fs } from "fs";

export const mockFsData = {
  files: new Map<string, Buffer>(),
  stats: new Map<string, { size: number; isDirectory: () => boolean }>(),
  fileHandles: new Map<string, unknown>(),
};

/**
 * Install fs mocks using vi.spyOn for automatic cleanup.
 */
export function setupFsMocks(): void {
  vi.spyOn(fs, "stat").mockImplementation(async (path: Parameters<typeof fs.stat>[0]) => {
    const pathStr = String(path);
    const stats = mockFsData.stats.get(pathStr);
    if (!stats) {
      throw new Error(`ENOENT: no such file or directory, stat '${pathStr}'`);
    }
    return stats as Awaited<ReturnType<typeof fs.stat>>;
  });

  vi.spyOn(fs, "open").mockImplementation(
    async (path: Parameters<typeof fs.open>[0], _flags?: Parameters<typeof fs.open>[1]) => {
      const pathStr = String(path);
      const buffer = mockFsData.files.get(pathStr);
      if (!buffer) {
        throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
      }

      const handle = {
        path: pathStr,
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

      mockFsData.fileHandles.set(pathStr, handle);
      return handle as Awaited<ReturnType<typeof fs.open>>;
    }
  );

  vi.spyOn(fs, "writeFile").mockImplementation(
    async (path: Parameters<typeof fs.writeFile>[0], data: Parameters<typeof fs.writeFile>[1]) => {
      const pathStr = String(path);
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      mockFsData.files.set(pathStr, buf);
    }
  );

  vi.spyOn(fs, "readFile").mockImplementation(async (path: Parameters<typeof fs.readFile>[0]) => {
    const pathStr = String(path);
    const content = mockFsData.files.get(pathStr);
    if (!content) {
      throw new Error(`ENOENT: no such file or directory, readFile '${pathStr}'`);
    }
    return content;
  });

  vi.spyOn(fs, "mkdir").mockImplementation(async () => {
    return undefined as unknown as string | undefined;
  });

  vi.spyOn(fs, "rm").mockImplementation(async () => {
    return undefined;
  });

  vi.spyOn(fs, "unlink").mockImplementation(async () => {
    return undefined;
  });
}
