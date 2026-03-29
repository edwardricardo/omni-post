/**
 * @file importFromGoogleDrive.test.ts
 * @description Tests for ImportFromGoogleDriveUseCase: validates MIME type filtering,
 *   correct MediaAsset creation with Google Drive metadata, folder assignment, and
 *   graceful handling of missing fields and repository failures.
 * @layer test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ImportFromGoogleDriveUseCase } from "../../../src/application/assets/ImportFromGoogleDriveUseCase.js";
import { MediaAsset } from "../../../src/domain/entities/MediaAsset.js";
import { type MediaAssetRepository } from "../../../src/domain/repositories/MediaAssetRepository.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "acc-00000000-0000-0000-0000-000000000001";
const FILE_ID = "1abc-google-drive-file-id";
const ACCESS_TOKEN = "ya29.mock-google-access-token";
const FOLDER_ID = "folder-00000000-0000-0000-0000-000000000001";

function makeMediaAssetRepo(overrides: Partial<MediaAssetRepository> = {}): MediaAssetRepository {
  return {
    findById: vi.fn(async () => null),
    findMany: vi.fn(async () => ({ items: [], total: 0, hasMore: false, nextCursor: null })),
    save: vi.fn(async (asset: MediaAsset) => ({ ok: true as const, value: asset })),
    softDelete: vi.fn(async () => ({ ok: true as const, value: undefined })),
    updateTags: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  };
}

function makeValidInput(overrides: Record<string, unknown> = {}): {
  accountId: string;
  fileId: string;
  accessToken: string;
  fileName: string;
  mimeType: string;
  folderId?: string;
  projectId?: string;
} {
  return {
    accountId: ACCOUNT_ID,
    fileId: FILE_ID,
    accessToken: ACCESS_TOKEN,
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ImportFromGoogleDriveUseCase", () => {
  let repo: MediaAssetRepository;
  let useCase: ImportFromGoogleDriveUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMediaAssetRepo();
    useCase = new ImportFromGoogleDriveUseCase(repo);
  });

  describe("success scenarios", () => {
    it("creates MediaAsset with correct Google Drive metadata for an image", async () => {
      const input = makeValidInput();
      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should succeed");
      expect(result.value.fileName).toBe("photo.jpg");
      expect(result.value.mimeType).toBe("image/jpeg");
      expect(result.value.type).toBe("image");
      expect(result.value.googleDriveFileId).toBe(FILE_ID);
      expect(result.value.url).toContain(FILE_ID);
      expect(result.value.url).toContain("googleapis.com/drive/v3/files/");
      expect(result.value.id).toBeTruthy();

      // Verify repository save was called
      expect(repo.save).toHaveBeenCalledTimes(1);
      const savedAsset = vi.mocked(repo.save).mock.calls[0]![0]!;
      expect(savedAsset.name).toBe("photo.jpg");
      expect(savedAsset.mimeType).toBe("image/jpeg");
      expect(savedAsset.storageKey).toBe(`google-drive/${FILE_ID}`);
      expect(savedAsset.sizeBytes).toBe(0);
    });

    it("creates MediaAsset with type video for video/* MIME types", async () => {
      const input = makeValidInput({ mimeType: "video/mp4", fileName: "clip.mp4" });
      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should succeed");
      expect(result.value.type).toBe("video");
      expect(result.value.mimeType).toBe("video/mp4");
    });

    it("accepts image/png MIME type", async () => {
      const input = makeValidInput({ mimeType: "image/png", fileName: "screenshot.png" });
      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should succeed");
      expect(result.value.type).toBe("image");
    });

    it("accepts video/webm MIME type", async () => {
      const input = makeValidInput({ mimeType: "video/webm", fileName: "recording.webm" });
      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should succeed");
      expect(result.value.type).toBe("video");
    });

    it("passes folderId when provided", async () => {
      const input = makeValidInput({ folderId: FOLDER_ID });
      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should succeed");

      const savedAsset = vi.mocked(repo.save).mock.calls[0]![0]!;
      expect(savedAsset.folderId).toBe(FOLDER_ID);
    });

    it("creates asset without folderId when not provided", async () => {
      const input = makeValidInput();
      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should succeed");

      const savedAsset = vi.mocked(repo.save).mock.calls[0]![0]!;
      expect(savedAsset.folderId).toBeUndefined();
    });

    it("passes projectId when provided", async () => {
      const projectId = "proj-00000000-0000-0000-0000-000000000001";
      const input = makeValidInput({ projectId });
      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should succeed");

      const savedAsset = vi.mocked(repo.save).mock.calls[0]![0]!;
      expect(savedAsset.projectId).toBe(projectId);
    });

    it("trims whitespace from fileName", async () => {
      const input = makeValidInput({ fileName: "  spaced name.jpg  " });
      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should succeed");
      expect(result.value.fileName).toBe("spaced name.jpg");
    });
  });

  describe("MIME type validation", () => {
    it("rejects application/pdf", async () => {
      const input = makeValidInput({ mimeType: "application/pdf" });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.message).toContain("Unsupported MIME type");
      expect(result.error.message).toContain("application/pdf");
    });

    it("rejects text/plain", async () => {
      const input = makeValidInput({ mimeType: "text/plain" });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects audio/mpeg", async () => {
      const input = makeValidInput({ mimeType: "audio/mpeg" });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects application/zip", async () => {
      const input = makeValidInput({ mimeType: "application/zip" });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("missing fields", () => {
    it("returns error when fileId is empty", async () => {
      const input = makeValidInput({ fileId: "" });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.message).toContain("file ID");
    });

    it("returns error when accessToken is empty", async () => {
      const input = makeValidInput({ accessToken: "" });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.message).toContain("access token");
    });

    it("returns error when fileName is empty", async () => {
      const input = makeValidInput({ fileName: "" });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.message).toContain("File name");
    });

    it("returns error when mimeType is empty", async () => {
      const input = makeValidInput({ mimeType: "" });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.message).toContain("MIME type");
    });

    it("returns error when fileId is whitespace-only", async () => {
      const input = makeValidInput({ fileId: "   " });
      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("repository failure", () => {
    it("returns INTERNAL_ERROR when repository save fails", async () => {
      const failingRepo = makeMediaAssetRepo({
        save: vi.fn(async () => ({ ok: false as const, error: new Error("DB connection lost") })),
      });
      const failUseCase = new ImportFromGoogleDriveUseCase(failingRepo);

      const input = makeValidInput();
      const result = await failUseCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).toContain("Failed to save");
    });

    it("returns INTERNAL_ERROR when repository throws", async () => {
      const throwingRepo = makeMediaAssetRepo({
        save: vi.fn(async () => {
          throw new Error("Unexpected DB error");
        }),
      });
      const throwUseCase = new ImportFromGoogleDriveUseCase(throwingRepo);

      const input = makeValidInput();
      const result = await throwUseCase.execute(input);

      assert.ok(!result.ok, "Should fail");
      expect(result.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("UnitOfWork integration", () => {
    it("executes within transaction when UoW is provided", async () => {
      const mockUoW = {
        executeInTransaction: vi.fn(async (fn: () => Promise<void>) => {
          await fn();
        }),
      };
      const uowUseCase = new ImportFromGoogleDriveUseCase(repo, mockUoW);

      const input = makeValidInput();
      const result = await uowUseCase.execute(input);

      assert.ok(result.ok, "Should succeed");
      expect(mockUoW.executeInTransaction).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });
});
