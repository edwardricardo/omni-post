/**
 * Unit Tests for VideoUploadPipeline — Multi-Destination Support
 * Tests uploading to S3, Google Cloud Storage, Azure Blob Storage, and YouTube.
 */
import { describe, it, beforeAll, expect } from "vitest";
import { VideoUploadPipeline, type UploadDestination } from "../../src/video/uploadPipeline";
import { mockFsData, setupFsMocks } from "./uploadPipeline.test-helpers";

// Apply fs mocks before any describe/it blocks run
setupFsMocks();

describe("VideoUploadPipeline - Multi-Destination Support", () => {
  let pipeline: VideoUploadPipeline;

  beforeAll(() => {
    pipeline = new VideoUploadPipeline(0);
  });

  it("should upload to S3 destination", async () => {
    const filePath = "/test/s3-video.mp4";
    const fileData = Buffer.alloc(5 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "s3",
      config: {
        bucket: "test-bucket",
        region: "us-east-1",
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
      },
    };

    const session = await pipeline.uploadFile(filePath, destination);

    expect(session.status).toBe("completed");
    expect(session.finalUrl?.startsWith("s3://")).toBeTruthy();
    expect(session.finalUrl?.includes("test-bucket")).toBeTruthy();
  });

  it("should upload to Google Cloud Storage", async () => {
    const filePath = "/test/gcs-video.mp4";
    const fileData = Buffer.alloc(3 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "gcs",
      config: {
        bucket: "test-gcs-bucket",
        projectId: "test-project",
      },
    };

    const session = await pipeline.uploadFile(filePath, destination);

    expect(session.status).toBe("completed");
    expect(session.finalUrl?.startsWith("gs://")).toBeTruthy();
  });

  it("should upload to Azure Blob Storage", async () => {
    const filePath = "/test/azure-video.mp4";
    const fileData = Buffer.alloc(4 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "azure",
      config: {
        storageAccount: "teststorage",
        storageKey: "test-key",
        containerName: "videos",
      },
    };

    const session = await pipeline.uploadFile(filePath, destination);

    expect(session.status).toBe("completed");
    expect(session.finalUrl?.includes("blob.core.windows.net")).toBeTruthy();
  });

  it("should upload to YouTube", async () => {
    const filePath = "/test/youtube-video.mp4";
    const fileData = Buffer.alloc(2 * 1024 * 1024);
    mockFsData.files.set(filePath, fileData);
    mockFsData.stats.set(filePath, {
      size: fileData.length,
      isDirectory: () => false,
    });

    const destination: UploadDestination = {
      type: "youtube",
      config: {
        credentials: {
          clientId: "test-client-id",
          clientSecret: "test-secret",
          refreshToken: "test-refresh",
        },
      },
    };

    const session = await pipeline.uploadFile(filePath, destination);

    expect(session.status).toBe("completed");
    expect(session.finalUrl?.includes("youtube.com")).toBeTruthy();
  });
});
