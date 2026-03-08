/**
 * Unit Tests for VideoUploadPipeline — Session Lifecycle
 * Tests session cancellation, cleanup of old sessions, and chunk retry logic.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { VideoUploadPipeline, type UploadDestination } from "../../src/video/uploadPipeline";
import { mockFsData, setupFsMocks } from "./uploadPipeline.test-helpers";

// Apply fs mocks before any describe/it blocks run
setupFsMocks();

describe("VideoUploadPipeline - Session Cancellation", { concurrency: 1 }, () => {
  let pipeline: VideoUploadPipeline;

  before(() => {
    pipeline = new VideoUploadPipeline(0);
  });

  it("should cancel active upload session", async () => {
    const session = await pipeline.createUploadSession(
      "cancel-test.mp4",
      10 * 1024 * 1024,
      "video/mp4"
    );

    const cancelled = await pipeline.cancelUpload(session.sessionId);

    assert.equal(cancelled, true);

    const retrieved = pipeline.getUploadSession(session.sessionId);
    assert.equal(retrieved?.status, "cancelled");
  });

  it("should return false when cancelling non-existent session", async () => {
    const cancelled = await pipeline.cancelUpload("non-existent-session");
    assert.equal(cancelled, false);
  });
});

describe("VideoUploadPipeline - Session Cleanup", { concurrency: 1 }, () => {
  let pipeline: VideoUploadPipeline;

  before(() => {
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

    assert.equal(cleaned, 2);

    // Recent session should still exist
    const remaining = pipeline.getUploadSession(session3.sessionId);
    assert.ok(remaining);
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

    assert.equal(cleaned, 0);
  });
});

describe("VideoUploadPipeline - Chunk Retry Logic", { concurrency: 1 }, () => {
  let pipeline: VideoUploadPipeline;

  before(() => {
    pipeline = new VideoUploadPipeline(0);
  });

  it("should initialize chunks with zero retries", async () => {
    const session = await pipeline.createUploadSession(
      "retry-test.mp4",
      10 * 1024 * 1024,
      "video/mp4"
    );

    session.chunks.forEach((chunk) => {
      assert.equal(chunk.retries, 0);
      assert.equal(chunk.uploaded, false);
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
    assert.ok(session.chunks.every((chunk) => chunk.uploaded === true));
  });
});
