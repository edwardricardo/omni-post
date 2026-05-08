/**
 * @file assetUseCases.test.ts
 * @description Tests for Asset Library use cases: CreateMediaAsset, UpdateMediaAsset,
 *   DeleteMediaAsset, TagMediaAsset, GetMediaAssets, CreateAssetTag, ListAssetTags,
 *   and CreateAssetFolder.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { CreateMediaAssetUseCase } from "../../../src/application/assets/CreateMediaAssetUseCase.js";
import { UpdateMediaAssetUseCase } from "../../../src/application/assets/UpdateMediaAssetUseCase.js";
import { DeleteMediaAssetUseCase } from "../../../src/application/assets/DeleteMediaAssetUseCase.js";
import { TagMediaAssetUseCase } from "../../../src/application/assets/TagMediaAssetUseCase.js";
import { GetMediaAssetsQuery } from "../../../src/application/assets/GetMediaAssetsQuery.js";
import { CreateAssetTagUseCase } from "../../../src/application/assets/CreateAssetTagUseCase.js";
import { ListAssetTagsQuery } from "../../../src/application/assets/ListAssetTagsQuery.js";
import { CreateAssetFolderUseCase } from "../../../src/application/assets/CreateAssetFolderUseCase.js";
import { MediaAsset } from "../../../src/domain/entities/MediaAsset.js";
import { type MediaAssetRepository } from "../../../src/domain/repositories/MediaAssetRepository.js";
import {
  type AssetTagRepository,
  type AssetTagDTO,
} from "../../../src/domain/repositories/AssetTagRepository.js";
import {
  type AssetFolderRepository,
  type AssetFolderDTO,
} from "../../../src/domain/repositories/AssetFolderRepository.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "acc-00000000-0000-0000-0000-000000000001";
const OTHER_ACCOUNT_ID = "acc-00000000-0000-0000-0000-000000000099";

function makeAsset(overrides: Record<string, unknown> = {}): MediaAsset {
  const result = MediaAsset.create({
    accountId: ACCOUNT_ID,
    name: "hero-banner.png",
    url: "https://cdn.example.com/hero-banner.png",
    storageKey: "uploads/hero-banner.png",
    mimeType: "image/png",
    sizeBytes: 204800,
    ...overrides,
  });
  assert.ok(result.ok, "makeAsset should succeed");
  return result.value;
}

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

function makeAssetTagRepo(overrides: Partial<AssetTagRepository> = {}): AssetTagRepository {
  return {
    findByAccount: vi.fn(async () => []),
    findByIds: vi.fn(async () => []),
    save: vi.fn(async (data: { accountId: string; name: string; color?: string }) => ({
      ok: true as const,
      value: {
        id: "tag-001",
        accountId: data.accountId,
        name: data.name,
        color: data.color ?? "#000000",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      } satisfies AssetTagDTO,
    })),
    delete: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  };
}

function makeAssetFolderRepo(
  overrides: Partial<AssetFolderRepository> = {}
): AssetFolderRepository {
  return {
    findByAccount: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    save: vi.fn(async (data: { accountId: string; name: string; parentId?: string }) => ({
      ok: true as const,
      value: {
        id: "folder-001",
        accountId: data.accountId,
        name: data.name,
        parentId: data.parentId ?? null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      } satisfies AssetFolderDTO,
    })),
    delete: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CreateMediaAssetUseCase
// ---------------------------------------------------------------------------

describe("CreateMediaAssetUseCase", () => {
  let repo: MediaAssetRepository;
  let uc: CreateMediaAssetUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMediaAssetRepo();
    uc = new CreateMediaAssetUseCase(repo);
  });

  it("creates asset and returns output DTO", async () => {
    const r = await uc.execute({
      accountId: ACCOUNT_ID,
      name: "banner.jpg",
      url: "https://cdn.example.com/banner.jpg",
      storageKey: "uploads/banner.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 102400,
    });

    assert.ok(r.ok, "Should succeed");
    assert.ok(r.value.id.length > 0);
    assert.strictEqual(r.value.name, "banner.jpg");
    assert.strictEqual(r.value.url, "https://cdn.example.com/banner.jpg");
    assert.strictEqual(r.value.mimeType, "image/jpeg");
    assert.strictEqual(r.value.sizeBytes, 102400);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects empty name", async () => {
    const r = await uc.execute({
      accountId: ACCOUNT_ID,
      name: "",
      url: "https://cdn.example.com/file.jpg",
      storageKey: "uploads/file.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
    });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
    expect(r.error.message).toContain("name");
  });

  it("rejects empty url", async () => {
    const r = await uc.execute({
      accountId: ACCOUNT_ID,
      name: "file.jpg",
      url: "",
      storageKey: "uploads/file.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
    });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
    expect(r.error.message).toContain("URL");
  });

  it("passes optional fields through to the entity", async () => {
    const r = await uc.execute({
      accountId: ACCOUNT_ID,
      projectId: "proj-001",
      name: "video.mp4",
      description: "Product demo video",
      url: "https://cdn.example.com/video.mp4",
      storageKey: "uploads/video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 5242880,
      width: 1920,
      height: 1080,
      duration: 120,
      folderId: "folder-001",
    });

    assert.ok(r.ok, "Should succeed with optional fields");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("returns error when repository save fails", async () => {
    repo = makeMediaAssetRepo({
      save: vi.fn(async () => ({ ok: false as const, error: new Error("DB error") })),
    });
    uc = new CreateMediaAssetUseCase(repo);

    const r = await uc.execute({
      accountId: ACCOUNT_ID,
      name: "file.jpg",
      url: "https://cdn.example.com/file.jpg",
      storageKey: "uploads/file.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
    });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
// UpdateMediaAssetUseCase
// ---------------------------------------------------------------------------

describe("UpdateMediaAssetUseCase", () => {
  let repo: MediaAssetRepository;
  let uc: UpdateMediaAssetUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    const existingAsset = makeAsset();
    repo = makeMediaAssetRepo({
      findById: vi.fn(async (id: string, accountId: string) =>
        accountId === ACCOUNT_ID ? existingAsset : null
      ),
    });
    uc = new UpdateMediaAssetUseCase(repo);
  });

  it("updates asset name successfully", async () => {
    const r = await uc.execute({
      id: "asset-001",
      accountId: ACCOUNT_ID,
      name: "updated-banner.png",
    });

    assert.ok(r.ok);
    assert.strictEqual(r.value.name, "updated-banner.png");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("returns NOT_FOUND when asset does not exist", async () => {
    const _r = await uc.execute({
      id: "nonexistent",
      accountId: ACCOUNT_ID,
      name: "new-name.png",
    });

    // findById returns null for unknown ids because the mock checks ACCOUNT_ID
    // but id doesn't matter in mock — let's use a different account
    repo = makeMediaAssetRepo({ findById: vi.fn(async () => null) });
    uc = new UpdateMediaAssetUseCase(repo);

    const r2 = await uc.execute({
      id: "asset-001",
      accountId: ACCOUNT_ID,
      name: "new-name.png",
    });

    assert.ok(!r2.ok);
    expect(r2.error.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when wrong account tries to update", async () => {
    const r = await uc.execute({
      id: "asset-001",
      accountId: OTHER_ACCOUNT_ID,
      name: "hijacked.png",
    });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("NOT_FOUND");
  });

  it("updates description", async () => {
    const r = await uc.execute({
      id: "asset-001",
      accountId: ACCOUNT_ID,
      description: "Updated description",
    });

    assert.ok(r.ok);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("moves asset to a different folder", async () => {
    const r = await uc.execute({
      id: "asset-001",
      accountId: ACCOUNT_ID,
      folderId: "folder-new",
    });

    assert.ok(r.ok);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("moves asset to root (null folder)", async () => {
    const r = await uc.execute({
      id: "asset-001",
      accountId: ACCOUNT_ID,
      folderId: null,
    });

    assert.ok(r.ok);
    expect(repo.save).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// DeleteMediaAssetUseCase
// ---------------------------------------------------------------------------

describe("DeleteMediaAssetUseCase", () => {
  let repo: MediaAssetRepository;
  let uc: DeleteMediaAssetUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    const existingAsset = makeAsset();
    repo = makeMediaAssetRepo({
      findById: vi.fn(async (_id: string, accountId: string) =>
        accountId === ACCOUNT_ID ? existingAsset : null
      ),
    });
    uc = new DeleteMediaAssetUseCase(repo);
  });

  it("soft-deletes asset successfully", async () => {
    const r = await uc.execute({ id: "asset-001", accountId: ACCOUNT_ID });

    assert.ok(r.ok);
    expect(repo.softDelete).toHaveBeenCalledWith("asset-001", ACCOUNT_ID);
  });

  it("returns NOT_FOUND when asset does not exist", async () => {
    repo = makeMediaAssetRepo({ findById: vi.fn(async () => null) });
    uc = new DeleteMediaAssetUseCase(repo);

    const r = await uc.execute({ id: "nonexistent", accountId: ACCOUNT_ID });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when wrong account tries to delete", async () => {
    const r = await uc.execute({ id: "asset-001", accountId: OTHER_ACCOUNT_ID });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("NOT_FOUND");
  });

  it("returns error when softDelete fails", async () => {
    repo = makeMediaAssetRepo({
      findById: vi.fn(async () => makeAsset()),
      softDelete: vi.fn(async () => ({ ok: false as const, error: new Error("DB error") })),
    });
    uc = new DeleteMediaAssetUseCase(repo);

    const r = await uc.execute({ id: "asset-001", accountId: ACCOUNT_ID });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
// TagMediaAssetUseCase
// ---------------------------------------------------------------------------

describe("TagMediaAssetUseCase", () => {
  let assetRepo: MediaAssetRepository;
  let tagRepo: AssetTagRepository;
  let uc: TagMediaAssetUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    const existingAsset = makeAsset();
    assetRepo = makeMediaAssetRepo({
      findById: vi.fn(async (_id: string, accountId: string) =>
        accountId === ACCOUNT_ID ? existingAsset : null
      ),
    });
    tagRepo = makeAssetTagRepo({
      findByIds: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          accountId: ACCOUNT_ID,
          name: `tag-${id}`,
          color: "#FF0000",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        }))
      ),
    });
    uc = new TagMediaAssetUseCase(assetRepo, tagRepo);
  });

  it("sets tags on asset successfully", async () => {
    const r = await uc.execute({
      assetId: "asset-001",
      accountId: ACCOUNT_ID,
      tagIds: ["tag-001", "tag-002"],
    });

    assert.ok(r.ok);
    expect(assetRepo.updateTags).toHaveBeenCalledWith("asset-001", ["tag-001", "tag-002"]);
  });

  it("allows setting empty tag list", async () => {
    const r = await uc.execute({
      assetId: "asset-001",
      accountId: ACCOUNT_ID,
      tagIds: [],
    });

    assert.ok(r.ok);
    expect(assetRepo.updateTags).toHaveBeenCalledWith("asset-001", []);
  });

  it("rejects tags from wrong account", async () => {
    tagRepo = makeAssetTagRepo({
      findByIds: vi.fn(async (ids: string[]) =>
        // Only return tag-001, simulating tag-002 belongs to another account
        ids
          .filter((id) => id === "tag-001")
          .map((id) => ({
            id,
            accountId: ACCOUNT_ID,
            name: `tag-${id}`,
            color: "#FF0000",
            createdAt: new Date("2026-01-01T00:00:00Z"),
          }))
      ),
    });
    uc = new TagMediaAssetUseCase(assetRepo, tagRepo);

    const r = await uc.execute({
      assetId: "asset-001",
      accountId: ACCOUNT_ID,
      tagIds: ["tag-001", "tag-002"],
    });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
    expect(r.error.message).toContain("tag-002");
  });

  it("returns NOT_FOUND when asset does not exist", async () => {
    assetRepo = makeMediaAssetRepo({ findById: vi.fn(async () => null) });
    uc = new TagMediaAssetUseCase(assetRepo, tagRepo);

    const r = await uc.execute({
      assetId: "nonexistent",
      accountId: ACCOUNT_ID,
      tagIds: ["tag-001"],
    });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// GetMediaAssetsQuery
// ---------------------------------------------------------------------------

describe("GetMediaAssetsQuery", () => {
  let repo: MediaAssetRepository;
  let query: GetMediaAssetsQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    const asset = makeAsset();
    repo = makeMediaAssetRepo({
      findMany: vi.fn(async () => ({
        items: [asset],
        total: 1,
        hasMore: false,
        nextCursor: null,
      })),
    });
    query = new GetMediaAssetsQuery(repo);
  });

  it("returns paginated results", async () => {
    const r = await query.execute({ accountId: ACCOUNT_ID });

    assert.ok(r.ok);
    assert.strictEqual(r.value.items.length, 1);
    assert.strictEqual(r.value.total, 1);
    assert.strictEqual(r.value.hasMore, false);
    assert.strictEqual(r.value.nextCursor, null);
  });

  it("passes filters to repository", async () => {
    await query.execute({
      accountId: ACCOUNT_ID,
      projectId: "proj-001",
      folderId: "folder-001",
      tagIds: ["tag-001"],
      mimeType: "image/png",
      search: "banner",
      limit: 20,
      cursor: "cursor-abc",
    });

    expect(repo.findMany).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      projectId: "proj-001",
      folderId: "folder-001",
      tagIds: ["tag-001"],
      mimeType: "image/png",
      search: "banner",
      limit: 20,
      cursor: "cursor-abc",
    });
  });

  it("rejects empty account ID", async () => {
    const r = await query.execute({ accountId: "" });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects whitespace-only account ID", async () => {
    const r = await query.execute({ accountId: "   " });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// CreateAssetTagUseCase
// ---------------------------------------------------------------------------

describe("CreateAssetTagUseCase", () => {
  let repo: AssetTagRepository;
  let uc: CreateAssetTagUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeAssetTagRepo();
    uc = new CreateAssetTagUseCase(repo);
  });

  it("creates tag and returns DTO", async () => {
    const r = await uc.execute({
      accountId: ACCOUNT_ID,
      name: "Product Photos",
      color: "#3B82F6",
    });

    assert.ok(r.ok);
    assert.strictEqual(r.value.name, "Product Photos");
    assert.strictEqual(r.value.accountId, ACCOUNT_ID);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects empty name", async () => {
    const r = await uc.execute({ accountId: ACCOUNT_ID, name: "" });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
    expect(r.error.message).toContain("name");
  });

  it("rejects whitespace-only name", async () => {
    const r = await uc.execute({ accountId: ACCOUNT_ID, name: "   " });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("handles unique constraint violation", async () => {
    repo = makeAssetTagRepo({
      save: vi.fn(async () => ({
        ok: false as const,
        error: new Error("unique constraint violation"),
      })),
    });
    uc = new CreateAssetTagUseCase(repo);

    const r = await uc.execute({ accountId: ACCOUNT_ID, name: "Duplicate Tag" });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("CONFLICT");
    expect(r.error.message).toContain("already exists");
  });

  it("handles generic save failure", async () => {
    repo = makeAssetTagRepo({
      save: vi.fn(async () => ({
        ok: false as const,
        error: new Error("connection timeout"),
      })),
    });
    uc = new CreateAssetTagUseCase(repo);

    const r = await uc.execute({ accountId: ACCOUNT_ID, name: "New Tag" });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
// ListAssetTagsQuery
// ---------------------------------------------------------------------------

describe("ListAssetTagsQuery", () => {
  let repo: AssetTagRepository;
  let query: ListAssetTagsQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    const tags: AssetTagDTO[] = [
      {
        id: "tag-001",
        accountId: ACCOUNT_ID,
        name: "Photos",
        color: "#FF0000",
        createdAt: new Date(),
      },
      {
        id: "tag-002",
        accountId: ACCOUNT_ID,
        name: "Videos",
        color: "#00FF00",
        createdAt: new Date(),
      },
    ];
    repo = makeAssetTagRepo({
      findByAccount: vi.fn(async () => tags),
    });
    query = new ListAssetTagsQuery(repo);
  });

  it("returns tags for account", async () => {
    const r = await query.execute({ accountId: ACCOUNT_ID });

    assert.ok(r.ok);
    assert.strictEqual(r.value.length, 2);
    assert.strictEqual(r.value[0]?.name, "Photos");
    assert.strictEqual(r.value[1]?.name, "Videos");
  });

  it("rejects empty account ID", async () => {
    const r = await query.execute({ accountId: "" });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns empty array when no tags exist", async () => {
    repo = makeAssetTagRepo({ findByAccount: vi.fn(async () => []) });
    query = new ListAssetTagsQuery(repo);

    const r = await query.execute({ accountId: ACCOUNT_ID });

    assert.ok(r.ok);
    assert.strictEqual(r.value.length, 0);
  });
});

// ---------------------------------------------------------------------------
// CreateAssetFolderUseCase
// ---------------------------------------------------------------------------

describe("CreateAssetFolderUseCase", () => {
  let repo: AssetFolderRepository;
  let uc: CreateAssetFolderUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeAssetFolderRepo();
    uc = new CreateAssetFolderUseCase(repo);
  });

  it("creates folder and returns DTO", async () => {
    const r = await uc.execute({ accountId: ACCOUNT_ID, name: "Marketing" });

    assert.ok(r.ok);
    assert.strictEqual(r.value.name, "Marketing");
    assert.strictEqual(r.value.accountId, ACCOUNT_ID);
    assert.strictEqual(r.value.parentId, null);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects empty name", async () => {
    const r = await uc.execute({ accountId: ACCOUNT_ID, name: "" });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
    expect(r.error.message).toContain("name");
  });

  it("rejects whitespace-only name", async () => {
    const r = await uc.execute({ accountId: ACCOUNT_ID, name: "   " });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("creates subfolder when parent exists", async () => {
    const parentFolder: AssetFolderDTO = {
      id: "folder-parent",
      accountId: ACCOUNT_ID,
      name: "Root",
      parentId: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    repo = makeAssetFolderRepo({
      findById: vi.fn(async () => parentFolder),
    });
    uc = new CreateAssetFolderUseCase(repo);

    const r = await uc.execute({
      accountId: ACCOUNT_ID,
      name: "Sub-Marketing",
      parentId: "folder-parent",
    });

    assert.ok(r.ok);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects non-existent parent folder", async () => {
    const r = await uc.execute({
      accountId: ACCOUNT_ID,
      name: "Orphan Folder",
      parentId: "nonexistent-parent",
    });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("NOT_FOUND");
    expect(r.error.message).toContain("Parent folder");
  });

  it("handles save failure", async () => {
    repo = makeAssetFolderRepo({
      save: vi.fn(async () => ({
        ok: false as const,
        error: new Error("DB error"),
      })),
    });
    uc = new CreateAssetFolderUseCase(repo);

    const r = await uc.execute({ accountId: ACCOUNT_ID, name: "Folder" });

    assert.ok(!r.ok);
    expect(r.error.code).toBe("INTERNAL_ERROR");
  });
});
