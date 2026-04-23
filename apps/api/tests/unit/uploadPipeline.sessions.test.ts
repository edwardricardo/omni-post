/**
 * Unit Tests for VideoUploadPipeline — Upload Session Management
 * Tests session creation, chunk boundary calculation, retrieval, and listing.
 *
 * @file uploadPipeline.sessions.test.ts
 * @description Tests for VideoUploadPipeline - Upload Session Management
 * @layer infrastructure
 */
import { describe, it, beforeAll, expect } from "vitest";
import { VideoUploadPipeline, type UploadOptions } from "../../src/video/uploadPipeline";
import { setupFsMocks } from "./uploadPipeline.test-helpers";

// Apply fs mocks before any describe/it blocks run
setupFsMocks();

describe("VideoUploadPipeline - Upload Session Management", () => {
  let pipeline: VideoUploadPipeline;

  beforeAll(() => {
    // Pass 0 ms simulated delay so cloud-destination chunk uploads complete immediately in tests
    pipeline = new VideoUploadPipeline(0);
  });

  it("should create upload session with default chunk size", async () => {
    const session = await pipeline.createUploadSession(
      "test-video.mp4",
      10 * 1024 * 1024,
      "video/mp4"
    );

    expect(session).toBeTruthy();
    expect(session.sessionId).toBeTruthy();
    expect(session.fileName).toBe("test-video.mp4");
    expect(session.fileSize).toBe(10 * 1024 * 1024);
    expect(session.mimeType).toBe("video/mp4");
    expect(session.status).toBe("created");
    expect(session.progress).toBe(0);
    expect(session.uploadedChunks).toBe(0);
    expect(session.chunkSize).toBe(5 * 1024 * 1024); // Default 5MB
    expect(session.totalChunks).toBe(2); // 10MB / 5MB = 2 chunks
    expect(Array.isArray(session.chunks)).toBeTruthy();
    expect(session.chunks.length).toBe(2);
  });

  it("should create upload session with custom chunk size", async () => {
    const options: UploadOptions = {
      chunkSize: 1 * 1024 * 1024, // 1MB chunks
    };

    const session = await pipeline.createUploadSession(
      "large-video.mp4",
      10 * 1024 * 1024,
      "video/mp4",
      options
    );

    expect(session.chunkSize).toBe(1 * 1024 * 1024);
    expect(session.totalChunks).toBe(10); // 10MB / 1MB = 10 chunks
  });

  it("should calculate chunk boundaries correctly", async () => {
    const fileSize = 10 * 1024 * 1024; // 10MB
    const session = await pipeline.createUploadSession("test.mp4", fileSize, "video/mp4", {
      chunkSize: 3 * 1024 * 1024, // 3MB chunks
    });

    expect(session.chunks.length).toBe(4); // ceil(10/3) = 4 chunks

    // First chunk
    expect(session.chunks[0]!.index).toBe(0);
    expect(session.chunks[0]!.start).toBe(0);
    expect(session.chunks[0]!.end).toBe(3 * 1024 * 1024 - 1);
    expect(session.chunks[0]!.size).toBe(3 * 1024 * 1024);

    // Last chunk (smaller)
    const lastChunk = session.chunks[3]!;
    expect(lastChunk.index).toBe(3);
    expect(lastChunk.start).toBe(9 * 1024 * 1024);
    expect(lastChunk.end).toBe(fileSize - 1);
    expect(lastChunk.size).toBe(1 * 1024 * 1024);
  });

  it("should get upload session by ID", async () => {
    const session = await pipeline.createUploadSession("test.mp4", 5 * 1024 * 1024, "video/mp4");

    const retrieved = pipeline.getUploadSession(session.sessionId);

    expect(retrieved).toBeTruthy();
    expect(retrieved.sessionId).toBe(session.sessionId);
    expect(retrieved.fileName).toBe("test.mp4");
  });

  it("should return undefined for non-existent session", () => {
    const retrieved = pipeline.getUploadSession("non-existent-id");
    expect(retrieved).toBe(undefined);
  });

  it("should list all upload sessions", async () => {
    const pipeline2 = new VideoUploadPipeline(0);

    await pipeline2.createUploadSession("video1.mp4", 5 * 1024 * 1024, "video/mp4");
    await pipeline2.createUploadSession("video2.mp4", 10 * 1024 * 1024, "video/mp4");

    const sessions = pipeline2.listUploadSessions();

    expect(sessions.length).toBe(2);
    expect(sessions.some((s) => s.fileName === "video1.mp4")).toBeTruthy();
    expect(sessions.some((s) => s.fileName === "video2.mp4")).toBeTruthy();
  });
});
