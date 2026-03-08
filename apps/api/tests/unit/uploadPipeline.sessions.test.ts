/**
 * Unit Tests for VideoUploadPipeline — Upload Session Management
 * Tests session creation, chunk boundary calculation, retrieval, and listing.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { VideoUploadPipeline, type UploadOptions } from "../../src/video/uploadPipeline";
import { setupFsMocks } from "./uploadPipeline.test-helpers";

// Apply fs mocks before any describe/it blocks run
setupFsMocks();

describe("VideoUploadPipeline - Upload Session Management", { concurrency: 1 }, () => {
  let pipeline: VideoUploadPipeline;

  before(() => {
    // Pass 0 ms simulated delay so cloud-destination chunk uploads complete immediately in tests
    pipeline = new VideoUploadPipeline(0);
  });

  it("should create upload session with default chunk size", async () => {
    const session = await pipeline.createUploadSession(
      "test-video.mp4",
      10 * 1024 * 1024,
      "video/mp4"
    );

    assert.ok(session);
    assert.ok(session.sessionId);
    assert.equal(session.fileName, "test-video.mp4");
    assert.equal(session.fileSize, 10 * 1024 * 1024);
    assert.equal(session.mimeType, "video/mp4");
    assert.equal(session.status, "created");
    assert.equal(session.progress, 0);
    assert.equal(session.uploadedChunks, 0);
    assert.equal(session.chunkSize, 5 * 1024 * 1024); // Default 5MB
    assert.equal(session.totalChunks, 2); // 10MB / 5MB = 2 chunks
    assert.ok(Array.isArray(session.chunks));
    assert.equal(session.chunks.length, 2);
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

    assert.equal(session.chunkSize, 1 * 1024 * 1024);
    assert.equal(session.totalChunks, 10); // 10MB / 1MB = 10 chunks
  });

  it("should calculate chunk boundaries correctly", async () => {
    const fileSize = 10 * 1024 * 1024; // 10MB
    const session = await pipeline.createUploadSession("test.mp4", fileSize, "video/mp4", {
      chunkSize: 3 * 1024 * 1024, // 3MB chunks
    });

    assert.equal(session.chunks.length, 4); // ceil(10/3) = 4 chunks

    // First chunk
    assert.equal(session.chunks[0]!.index, 0);
    assert.equal(session.chunks[0]!.start, 0);
    assert.equal(session.chunks[0]!.end, 3 * 1024 * 1024 - 1);
    assert.equal(session.chunks[0]!.size, 3 * 1024 * 1024);

    // Last chunk (smaller)
    const lastChunk = session.chunks[3]!;
    assert.equal(lastChunk.index, 3);
    assert.equal(lastChunk.start, 9 * 1024 * 1024);
    assert.equal(lastChunk.end, fileSize - 1);
    assert.equal(lastChunk.size, 1 * 1024 * 1024);
  });

  it("should get upload session by ID", async () => {
    const session = await pipeline.createUploadSession("test.mp4", 5 * 1024 * 1024, "video/mp4");

    const retrieved = pipeline.getUploadSession(session.sessionId);

    assert.ok(retrieved);
    assert.equal(retrieved.sessionId, session.sessionId);
    assert.equal(retrieved.fileName, "test.mp4");
  });

  it("should return undefined for non-existent session", () => {
    const retrieved = pipeline.getUploadSession("non-existent-id");
    assert.equal(retrieved, undefined);
  });

  it("should list all upload sessions", async () => {
    const pipeline2 = new VideoUploadPipeline(0);

    await pipeline2.createUploadSession("video1.mp4", 5 * 1024 * 1024, "video/mp4");
    await pipeline2.createUploadSession("video2.mp4", 10 * 1024 * 1024, "video/mp4");

    const sessions = pipeline2.listUploadSessions();

    assert.equal(sessions.length, 2);
    assert.ok(sessions.some((s) => s.fileName === "video1.mp4"));
    assert.ok(sessions.some((s) => s.fileName === "video2.mp4"));
  });
});
