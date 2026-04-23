/**
 * Unit Tests for VideoUploadPipeline — File Upload & Resumable Uploads
 * Tests basic file upload flows, progress tracking, checksum validation,
 * custom retry settings, MIME type detection, and resumable upload behaviour.
 *
 * BUG FIX: The "should resume partially uploaded file" test now pre-populates
 * the mock filesystem with chunk data for chunks 0 and 1 before calling
 * resumeUpload(). Without this, finalizeLocalUpload() tries to readFile()
 * those chunks and throws ENOENT because they were only marked as uploaded in
 * memory but were never physically written.
 *
 * @file uploadPipeline.upload.test.ts
 * @description Tests for VideoUploadPipeline - File Upload
 * @layer infrastructure
 */
import { describe, it, beforeAll, expect } from "vitest";
import {
  VideoUploadPipeline,
  type UploadOptions,
  type UploadDestination,
  type UploadProgress,
} from "../../src/video/uploadPipeline";
import { mockFsData, setupFsMocks } from "./uploadPipeline.test-helpers";

// Apply fs mocks before any describe/it blocks run
setupFsMocks();

describe("VideoUploadPipeline - File Upload", () => {
  let pipeline: VideoUploadPipeline;

  beforeAll(() => {
    pipeline = new VideoUploadPipeline(0);
  });

  it("should upload small file to local storage", async () => {
    const filePath = "/test/small-video.mp4";
    const fileData = Buffer.alloc(2 * 1024 * 1024); // 2MB file
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: {
        directory: "/test/uploads",
      },
    };

    const session = await pipeline.uploadFile(filePath, destination);

    expect(session).toBeTruthy();
    expect(session.status).toBe("completed");
    expect(session.progress).toBe(100);
    expect(session.finalUrl).toBeTruthy();
  });

  it("should track upload progress", async () => {
    const filePath = "/test/video-progress.mp4";
    const fileData = Buffer.alloc(10 * 1024 * 1024); // 10MB
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test/uploads" },
    };

    const progressUpdates: UploadProgress[] = [];

    const session = await pipeline.uploadFile(filePath, destination, {}, (progress) => {
      progressUpdates.push({ ...progress });
    });

    expect(session).toBeTruthy();
    expect(progressUpdates.length > 0).toBeTruthy();

    // Verify progress increases monotonically
    for (let i = 1; i < progressUpdates.length; i++) {
      expect(progressUpdates[i]!.progress >= progressUpdates[i - 1]!.progress).toBeTruthy();
    }
  });

  it("should upload with checksum validation", async () => {
    const filePath = "/test/checksum-video.mp4";
    const fileData = Buffer.from("test video content");
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test/uploads" },
    };

    const options: UploadOptions = {
      checksumValidation: true,
    };

    const session = await pipeline.uploadFile(filePath, destination, options);

    expect(session).toBeTruthy();
    expect(session.chunks.every((chunk) => chunk.checksum)).toBeTruthy();
  });

  it("should handle upload with custom retry settings", async () => {
    const filePath = "/test/retry-video.mp4";
    const fileData = Buffer.alloc(1 * 1024 * 1024); // 1MB
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test/uploads" },
    };

    const options: UploadOptions = {
      maxRetries: 5,
      timeout: 60000,
    };

    const session = await pipeline.uploadFile(filePath, destination, options);

    expect(session.status).toBe("completed");
  });

  it("should detect correct MIME type from extension", async () => {
    const testCases = [
      { file: "/test/video.mp4", expected: "video/mp4" },
      { file: "/test/video.avi", expected: "video/x-msvideo" },
      { file: "/test/video.mov", expected: "video/quicktime" },
      { file: "/test/video.webm", expected: "video/webm" },
    ];

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    for (const testCase of testCases) {
      const fileData = Buffer.alloc(100);
      mockFsData.files.set(testCase.file, fileData);
      mockFsData.stats.set(testCase.file, {
        size: fileData.length,
        isDirectory: () => false,
      });

      const session = await pipeline.uploadFile(testCase.file, destination);

      expect(session.mimeType).toBe(testCase.expected);
    }
  });
});

describe("VideoUploadPipeline - Resumable Uploads", () => {
  let pipeline: VideoUploadPipeline;

  beforeAll(() => {
    pipeline = new VideoUploadPipeline(0);
  });

  it("should resume partially uploaded file", async () => {
    const filePath = "/test/resume-video.mp4";
    const fileData = Buffer.alloc(10 * 1024 * 1024); // 10MB
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    // Create initial session with 5 chunks of 2MB each
    const session = await pipeline.createUploadSession(
      "resume-video.mp4",
      fileData.length,
      "video/mp4",
      {
        chunkSize: 2 * 1024 * 1024, // 2MB chunks = 5 chunks total
      }
    );

    // Mark first 2 chunks as uploaded
    session.chunks[0]!.uploaded = true;
    session.chunks[1]!.uploaded = true;
    session.uploadedChunks = 2;
    session.progress = 40;

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test/uploads" },
    };

    // BUG FIX: Pre-populate the mock filesystem with the data for chunks 0 and 1.
    // finalizeLocalUpload() reads ALL chunk files (including already-uploaded ones)
    // to concatenate them. Without these entries the readFile mock throws ENOENT.
    const chunkSize = 2 * 1024 * 1024;
    const dir = "/test/uploads";
    mockFsData.files.set(`${dir}/${session.sessionId}_chunk_0`, Buffer.alloc(chunkSize));
    mockFsData.files.set(`${dir}/${session.sessionId}_chunk_1`, Buffer.alloc(chunkSize));

    // Resume upload — should only upload chunks 2, 3, 4 then finalize
    const completedSession = await pipeline.resumeUpload(session.sessionId, filePath, destination);

    expect(completedSession.status).toBe("completed");
    expect(completedSession.progress).toBe(100);
    expect(completedSession.uploadedChunks).toBe(session.totalChunks);
  });

  it("should return completed session if already finished", async () => {
    const session = await pipeline.createUploadSession("completed.mp4", 1024 * 1024, "video/mp4");
    session.status = "completed";
    session.progress = 100;

    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    const result = await pipeline.resumeUpload(session.sessionId, "/test/file.mp4", destination);

    expect(result.status).toBe("completed");
  });

  it("should throw error if resuming non-existent session", async () => {
    const destination: UploadDestination = {
      type: "local",
      config: { directory: "/test" },
    };

    await expect(
      pipeline.resumeUpload("non-existent-session", "/test/file.mp4", destination)
    ).rejects.toThrow(/Upload session not found/);
  });
});
