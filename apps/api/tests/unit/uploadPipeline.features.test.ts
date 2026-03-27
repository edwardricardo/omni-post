/**
 * Unit Tests for VideoUploadPipeline — Advanced Features
 * Tests progress tracking, encryption, compression, webhook notifications,
 * and edge cases (tiny files, exact-divisible sizes, unknown extensions).
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
import {
  VideoUploadPipeline,
  type UploadOptions,
  type UploadDestination,
} from "../../src/video/uploadPipeline";
import { mockFsData, setupFsMocks } from "./uploadPipeline.test-helpers";

describe("VideoUploadPipeline - Progress Tracking", () => {
  let pipeline: VideoUploadPipeline;

  beforeEach(() => {
    setupFsMocks();
    pipeline = new VideoUploadPipeline(0);
  });

  it("should calculate progress percentage correctly", async () => {
    const filePath = "/test/progress.mp4";
    const fileData = Buffer.alloc(10 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    let finalProgress = 0;

    await pipeline.uploadFile(filePath, destination, {}, (progress) => {
      expect(progress.progress >= 0 && progress.progress <= 100).toBeTruthy();
      finalProgress = progress.progress;
    });

    expect(finalProgress).toBe(100);
  });

  it("should provide upload speed and ETA", async () => {
    const filePath = "/test/speed-test.mp4";
    const fileData = Buffer.alloc(8 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    let receivedSpeed = false;
    let receivedETA = false;

    await pipeline.uploadFile(filePath, destination, {}, (progress) => {
      if (progress.speed > 0) receivedSpeed = true;
      if (progress.eta !== undefined) receivedETA = true;
    });

    // At least some progress updates should have speed/ETA
    expect(receivedSpeed || receivedETA).toBeTruthy();
  });
});

describe("VideoUploadPipeline - Encryption and Compression", () => {
  let pipeline: VideoUploadPipeline;

  beforeEach(() => {
    setupFsMocks();
    pipeline = new VideoUploadPipeline(0);
  });

  it("should support encryption option", async () => {
    const filePath = "/test/encrypt.mp4";
    const fileData = Buffer.alloc(1 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    const options: UploadOptions = {
      encryption: {
        enabled: true,
        algorithm: "aes-256-gcm",
      },
    };

    const session = await pipeline.uploadFile(filePath, destination, options);

    expect(session.status).toBe("completed");
  });

  it("should support compression option", async () => {
    const filePath = "/test/compress.mp4";
    const fileData = Buffer.alloc(2 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    const options: UploadOptions = {
      compression: {
        enabled: true,
        level: 6,
      },
    };

    const session = await pipeline.uploadFile(filePath, destination, options);

    expect(session.status).toBe("completed");
  });
});

describe("VideoUploadPipeline - Webhook Notifications", () => {
  let pipeline: VideoUploadPipeline;

  beforeEach(() => {
    setupFsMocks();
    pipeline = new VideoUploadPipeline(0);
  });

  it("should support webhook configuration", async (_t) => {
    const filePath = "/test/webhook.mp4";
    const fileData = Buffer.alloc(1 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    // Mock global fetch using t.mock.fn
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response;
    }) as typeof fetch;

    const options: UploadOptions = {
      webhook: {
        url: "https://example.com/webhook",
        events: ["completed", "failed"],
        headers: {
          Authorization: "Bearer test-token",
        },
      },
    };

    const session = await pipeline.uploadFile(filePath, destination, options);

    expect(session.status).toBe("completed");
  });
});

describe("VideoUploadPipeline - Edge Cases", () => {
  let pipeline: VideoUploadPipeline;

  beforeEach(() => {
    setupFsMocks();
    pipeline = new VideoUploadPipeline(0);
  });

  it("should handle very small files", async () => {
    const session = await pipeline.createUploadSession("tiny.mp4", 1024, "video/mp4");

    expect(session.totalChunks).toBe(1);
    expect(session.chunks[0]!.size).toBe(1024);
  });

  it("should handle files exactly divisible by chunk size", async () => {
    const session = await pipeline.createUploadSession("exact.mp4", 15 * 1024 * 1024, "video/mp4", {
      chunkSize: 5 * 1024 * 1024,
    });

    expect(session.totalChunks).toBe(3);
    expect(session.chunks[0]!.size).toBe(5 * 1024 * 1024);
    expect(session.chunks[1]!.size).toBe(5 * 1024 * 1024);
    expect(session.chunks[2]!.size).toBe(5 * 1024 * 1024);
  });

  it("should handle single chunk upload", async () => {
    const filePath = "/test/single-chunk.mp4";
    const fileData = Buffer.alloc(1 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    const session = await pipeline.uploadFile(filePath, destination);

    expect(session.status).toBe("completed");
    expect(session.totalChunks).toBe(1);
  });

  it("should handle unknown file extension", async () => {
    const filePath = "/test/unknown.xyz";
    const fileData = Buffer.alloc(100);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    const session = await pipeline.uploadFile(filePath, destination);

    expect(session.mimeType).toBe("application/octet-stream");
  });
});
