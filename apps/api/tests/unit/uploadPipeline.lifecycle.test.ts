/**
 * Unit Tests for VideoUploadPipeline — Session Lifecycle
 * Tests session cancellation, cleanup of old sessions, and chunk retry logic.
 *
 * @file uploadPipeline.lifecycle.test.ts
 * @description Tests for VideoUploadPipeline - Session Cancellation
 * @layer infrastructure
 */
import { describe, it, beforeAll, expect } from "vitest";
import { VideoUploadPipeline, type UploadDestination } from "../../src/video/uploadPipeline.js";
import { mockFsData, setupFsMocks } from "./uploadPipeline.test-helpers.js";

// Apply fs mocks before any describe/it blocks run
setupFsMocks();

describe("VideoUploadPipeline - Session Cancellation", () => {
  let pipeline: VideoUploadPipeline;

  beforeAll(() => {
    pipeline = new VideoUploadPipeline(0);
  });

  it("should cancel active upload session", async () => {
    const session = await pipeline.createUploadSession(
      "cancel-test.mp4",
      10 * 1024 * 1024,
      "video/mp4"
    );

    const cancelled = await pipeline.cancelUpload(session.sessionId);

    expect(cancelled).toBe(true);

    const retrieved = pipeline.getUploadSession(session.sessionId);
    expect(retrieved?.status).toBe("cancelled");
  });

  it("should return false when cancelling non-existent session", async () => {
    const cancelled = await pipeline.cancelUpload("non-existent-session");
    expect(cancelled).toBe(false);
  });
});

describe("VideoUploadPipeline - Session Cleanup", () => {
  let pipeline: VideoUploadPipeline;

  beforeAll(() => {
    pipeline = new VideoUploadPipeline(0);
  });

  it("should cleanup old completed sessions", async () => {
    const session1 = await pipeline.createUploadSession("old1.mp4", 1024, "video/mp4");
    const session2 = await pipeline.createUploadSession("old2.mp4", 1024, "video/mp4");
    const session3 = await pipeline.createUploadSession("recent.mp4", 1024, "video/mp4");

    // Mark sessions as completed/failed
    session1.status = "completed";
    session2.status = "failed";
    session3.status = "completed";

    // Make first two sessions old (25 hours ago)
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    session1.updatedAt = oldDate;
    session2.updatedAt = oldDate;

    // Clean up sessions older than 24 hours
    const cleaned = await pipeline.cleanupSessions(24 * 60 * 60 * 1000);

    expect(cleaned).toBe(2);

    // Recent session should still exist
    const remaining = pipeline.getUploadSession(session3.sessionId);
    expect(remaining).toBeTruthy();
  });

  it("should not cleanup active sessions", async () => {
    const pipeline2 = new VideoUploadPipeline(0);

    const session1 = await pipeline2.createUploadSession("uploading.mp4", 1024, "video/mp4");
    const session2 = await pipeline2.createUploadSession("processing.mp4", 1024, "video/mp4");

    session1.status = "uploading";
    session2.status = "processing";

    // Make them old
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    session1.updatedAt = oldDate;
    session2.updatedAt = oldDate;

    const cleaned = await pipeline2.cleanupSessions(24 * 60 * 60 * 1000);

    expect(cleaned).toBe(0);
  });
});

describe("VideoUploadPipeline - Chunk Retry Logic", () => {
  let pipeline: VideoUploadPipeline;

  beforeAll(() => {
    pipeline = new VideoUploadPipeline(0);
  });

  it("should initialize chunks with zero retries", async () => {
    const session = await pipeline.createUploadSession(
      "retry-test.mp4",
      10 * 1024 * 1024,
      "video/mp4"
    );

    session.chunks.forEach((chunk) => {
      expect(chunk.retries).toBe(0);
      expect(chunk.uploaded).toBe(false);
    });
  });

  it("should track chunk upload status", async () => {
    const filePath = "/test/chunk-status.mp4";
    const fileData = Buffer.alloc(6 * 1024 * 1024);
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

    // All chunks should be marked as uploaded
    expect(session.chunks.every((chunk) => chunk.uploaded === true)).toBeTruthy();
  });
});
