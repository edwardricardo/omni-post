/**
 * @file entities.mediaAsset.test.ts
 * @description Unit tests for MediaAsset entity — creation, validation, tags, folders, usage.
 * @layer domain
 */

import { describe, it, expect } from "vitest";
import { MediaAsset, MediaAssetId } from "@core/domain/entities/MediaAsset.js";

function validInput(overrides?: Record<string, unknown>) {
  return {
    accountId: "acc-1",
    name: "photo.jpg",
    url: "https://cdn.example.com/photo.jpg",
    storageKey: "uploads/photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    ...overrides,
  };
}

describe("MediaAsset", () => {
  describe("create()", () => {
    it("creates with valid data and defaults", () => {
      const result = MediaAsset.create(validInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe("photo.jpg");
      expect(result.value.usageCount).toBe(0);
      expect(result.value.tagIds).toEqual([]);
      expect(result.value.folderId).toBeUndefined();
      expect(result.value.deletedAt).toBeUndefined();
    });

    it("creates with optional fields", () => {
      const result = MediaAsset.create(
        validInput({
          projectId: "proj-1",
          description: "A nice photo",
          width: 1920,
          height: 1080,
          folderId: "folder-1",
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.projectId).toBe("proj-1");
      expect(result.value.description).toBe("A nice photo");
      expect(result.value.width).toBe(1920);
      expect(result.value.height).toBe(1080);
      expect(result.value.folderId).toBe("folder-1");
    });

    it("creates with duration for video", () => {
      const result = MediaAsset.create(
        validInput({
          mimeType: "video/mp4",
          duration: 120,
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.duration).toBe(120);
      expect(result.value.isVideo).toBe(true);
      expect(result.value.isImage).toBe(false);
    });

    it("trims name whitespace", () => {
      const result = MediaAsset.create(validInput({ name: "  photo.jpg  " }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe("photo.jpg");
    });

    it("generates unique ID", () => {
      const a = MediaAsset.create(validInput());
      const b = MediaAsset.create(validInput());
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.value.id.value).not.toBe(b.value.id.value);
    });

    it("rejects empty name", () => {
      const result = MediaAsset.create(validInput({ name: "" }));
      expect(result.ok).toBe(false);
    });

    it("rejects whitespace-only name", () => {
      const result = MediaAsset.create(validInput({ name: "   " }));
      expect(result.ok).toBe(false);
    });

    it("rejects empty url", () => {
      const result = MediaAsset.create(validInput({ url: "" }));
      expect(result.ok).toBe(false);
    });

    it("rejects empty mimeType", () => {
      const result = MediaAsset.create(validInput({ mimeType: "" }));
      expect(result.ok).toBe(false);
    });

    it("rejects negative sizeBytes", () => {
      const result = MediaAsset.create(validInput({ sizeBytes: -1 }));
      expect(result.ok).toBe(false);
    });

    it("accepts sizeBytes of 0", () => {
      const result = MediaAsset.create(validInput({ sizeBytes: 0 }));
      expect(result.ok).toBe(true);
    });
  });

  describe("isImage / isVideo", () => {
    it("isImage returns true for image/jpeg", () => {
      const result = MediaAsset.create(validInput({ mimeType: "image/jpeg" }));
      if (!result.ok) return;
      expect(result.value.isImage).toBe(true);
      expect(result.value.isVideo).toBe(false);
    });

    it("isImage returns true for image/png", () => {
      const result = MediaAsset.create(validInput({ mimeType: "image/png" }));
      if (!result.ok) return;
      expect(result.value.isImage).toBe(true);
    });

    it("isVideo returns true for video/mp4", () => {
      const result = MediaAsset.create(validInput({ mimeType: "video/mp4" }));
      if (!result.ok) return;
      expect(result.value.isVideo).toBe(true);
      expect(result.value.isImage).toBe(false);
    });
  });

  describe("updateName()", () => {
    it("updates name", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      const asset = result.value;
      const updateResult = asset.updateName("new-name.png");
      expect(updateResult.ok).toBe(true);
      expect(asset.name).toBe("new-name.png");
    });

    it("rejects empty name", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      const updateResult = result.value.updateName("");
      expect(updateResult.ok).toBe(false);
    });
  });

  describe("updateDescription()", () => {
    it("sets description", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      result.value.updateDescription("New description");
      expect(result.value.description).toBe("New description");
    });

    it("clears description with undefined", () => {
      const result = MediaAsset.create(validInput({ description: "Old" }));
      if (!result.ok) return;
      result.value.updateDescription(undefined);
      expect(result.value.description).toBeUndefined();
    });
  });

  describe("moveTo()", () => {
    it("sets folderId", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      result.value.moveTo("folder-1");
      expect(result.value.folderId).toBe("folder-1");
    });

    it("clears folderId with undefined (move to root)", () => {
      const result = MediaAsset.create(validInput({ folderId: "folder-1" }));
      if (!result.ok) return;
      result.value.moveTo(undefined);
      expect(result.value.folderId).toBeUndefined();
    });
  });

  describe("incrementUsage()", () => {
    it("increments usage count", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      expect(result.value.usageCount).toBe(0);
      result.value.incrementUsage();
      expect(result.value.usageCount).toBe(1);
      result.value.incrementUsage();
      expect(result.value.usageCount).toBe(2);
    });
  });

  describe("tag operations", () => {
    it("addTag adds a tag", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      result.value.addTag("tag-1");
      expect(result.value.tagIds).toEqual(["tag-1"]);
    });

    it("addTag does not duplicate", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      result.value.addTag("tag-1");
      result.value.addTag("tag-1");
      expect(result.value.tagIds).toEqual(["tag-1"]);
    });

    it("removeTag removes existing tag", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      result.value.addTag("tag-1");
      result.value.addTag("tag-2");
      result.value.removeTag("tag-1");
      expect(result.value.tagIds).toEqual(["tag-2"]);
    });

    it("removeTag is no-op for non-existent tag", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      result.value.removeTag("nonexistent");
      expect(result.value.tagIds).toEqual([]);
    });

    it("setTags replaces all tags", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      result.value.addTag("old-tag");
      result.value.setTags(["new-1", "new-2"]);
      expect(result.value.tagIds).toEqual(["new-1", "new-2"]);
    });

    it("setTags deduplicates", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      result.value.setTags(["tag-1", "tag-1", "tag-2"]);
      expect(result.value.tagIds).toEqual(["tag-1", "tag-2"]);
    });
  });

  describe("softDelete()", () => {
    it("sets deletedAt", () => {
      const result = MediaAsset.create(validInput());
      if (!result.ok) return;
      expect(result.value.deletedAt).toBeUndefined();
      result.value.softDelete();
      expect(result.value.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("toJSON()", () => {
    it("serializes all fields", () => {
      const result = MediaAsset.create(
        validInput({
          projectId: "proj-1",
          description: "Desc",
          width: 800,
          height: 600,
        })
      );
      if (!result.ok) return;
      result.value.addTag("tag-1");
      const json = result.value.toJSON();
      expect(json.name).toBe("photo.jpg");
      expect(json.projectId).toBe("proj-1");
      expect(json.description).toBe("Desc");
      expect(json.width).toBe(800);
      expect(json.height).toBe(600);
      expect(json.usageCount).toBe(0);
      expect(json.tagIds).toEqual(["tag-1"]);
      expect(json.createdAt).toBeTruthy();
    });
  });

  describe("MediaAssetId", () => {
    it("generates unique IDs", () => {
      const a = MediaAssetId.generate();
      const b = MediaAssetId.generate();
      expect(a.value).not.toBe(b.value);
    });

    it("fromString rejects empty", () => {
      const result = MediaAssetId.fromString("");
      expect(result.ok).toBe(false);
    });

    it("fromString accepts valid string", () => {
      const result = MediaAssetId.fromString("test-id-123");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.value).toBe("test-id-123");
    });

    it("equals compares by value", () => {
      const a = MediaAssetId.fromString("same-id");
      const b = MediaAssetId.fromString("same-id");
      if (!a.ok || !b.ok) return;
      expect(a.value.equals(b.value)).toBe(true);
    });
  });
});
