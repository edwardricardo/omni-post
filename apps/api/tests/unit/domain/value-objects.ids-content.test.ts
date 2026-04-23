/**
 * @file value-objects.ids-content.test.ts
 * @description Tests for Domain Value Objects
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import {
  PostId,
  ChannelId,
  AccountId,
  ProjectId,
  ContentId,
  MediaId,
  TrackedLinkId,
  LinkClickId,
  Content,
  PublishStatus,
  PUBLISH_STATUS,
} from "./value-objects.fixtures.js";

describe("Domain Value Objects", () => {
  describe("Entity Identifiers", () => {
    describe("PostId", () => {
      it("should generate a new PostId", () => {
        const postId = PostId.generate();
        expect(postId).toBeTruthy();
        expect(postId.value.length === 36).toBeTruthy();
      });

      it("should create PostId from valid UUID string", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174000";
        const result = PostId.fromString(uuid);
        expect(result.ok).toBeTruthy();
        if (result.ok) {
          expect(result.value.value).toBe(uuid);
        }
      });

      it("should reject invalid UUID string", () => {
        const result = PostId.fromString("invalid-id");
        expect(result.ok).toBeFalsy();
      });

      it("should reject empty string", () => {
        const result = PostId.fromString("");
        expect(result.ok).toBeFalsy();
      });

      it("should check equality correctly", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174000";
        const id1 = PostId.fromStringUnsafe(uuid);
        const id2 = PostId.fromStringUnsafe(uuid);
        const id3 = PostId.generate();

        expect(id1.equals(id2)).toBeTruthy();
        expect(id1.equals(id3)).toBeFalsy();
      });

      it("should reject UUID with version nibble != 4 (version 3)", () => {
        const uuidV3 = "123e4567-e89b-32d3-a456-426614174000";
        const result = PostId.fromString(uuidV3);
        expect(result.ok).toBeFalsy();
      });

      it("should reject UUID with invalid variant nibble", () => {
        const uuidBadVariant = "123e4567-e89b-42d3-c456-426614174000";
        const result = PostId.fromString(uuidBadVariant);
        expect(result.ok).toBeFalsy();
      });

      it("should reject whitespace-only string", () => {
        const result = PostId.fromString("   ");
        expect(result.ok).toBeFalsy();
      });

      it("should return uuid via toString()", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174000";
        const id = PostId.fromStringUnsafe(uuid);
        expect(id.toString()).toBe(uuid);
      });

      it("should have non-empty error message for empty id", () => {
        const result = PostId.fromString("");
        expect(result.ok).toBeFalsy();
        if (!result.ok) {
          expect(result.error.message.length > 0).toBeTruthy();
        }
      });
    });

    describe("ContentId", () => {
      it("should generate a new ContentId", () => {
        const id = ContentId.generate();
        expect(id).toBeTruthy();
        expect(id.value.length).toBe(36);
      });

      it("should create ContentId from valid UUID", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174002";
        const result = ContentId.fromString(uuid);
        expect(result.ok).toBeTruthy();
        if (result.ok) {
          expect(result.value.value).toBe(uuid);
        }
      });

      it("should reject invalid UUID in ContentId", () => {
        const result = ContentId.fromString("not-valid");
        expect(result.ok).toBeFalsy();
      });
    });

    describe("MediaId", () => {
      it("should generate a new MediaId", () => {
        const id = MediaId.generate();
        expect(id).toBeTruthy();
        expect(id.value.length).toBe(36);
      });

      it("should create MediaId from valid UUID", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174003";
        const result = MediaId.fromString(uuid);
        expect(result.ok).toBeTruthy();
        if (result.ok) {
          expect(result.value.value).toBe(uuid);
        }
      });

      it("should reject empty string in MediaId", () => {
        const result = MediaId.fromString("");
        expect(result.ok).toBeFalsy();
      });
    });

    describe("TrackedLinkId", () => {
      it("should generate a new TrackedLinkId", () => {
        const id = TrackedLinkId.generate();
        expect(id).toBeTruthy();
        expect(id.value.length).toBe(36);
      });

      it("should create TrackedLinkId from valid UUID", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174004";
        const result = TrackedLinkId.fromString(uuid);
        expect(result.ok).toBeTruthy();
      });

      it("should reject invalid UUID in TrackedLinkId", () => {
        const result = TrackedLinkId.fromString("bad-id");
        expect(result.ok).toBeFalsy();
      });
    });

    describe("LinkClickId", () => {
      it("should generate a new LinkClickId", () => {
        const id = LinkClickId.generate();
        expect(id).toBeTruthy();
        expect(id.value.length).toBe(36);
      });

      it("should create LinkClickId from valid UUID", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174005";
        const result = LinkClickId.fromString(uuid);
        expect(result.ok).toBeTruthy();
      });

      it("should reject empty string in LinkClickId", () => {
        const result = LinkClickId.fromString("");
        expect(result.ok).toBeFalsy();
      });
    });

    describe("ChannelId", () => {
      it("should generate a new ChannelId", () => {
        const channelId = ChannelId.generate();
        expect(channelId).toBeTruthy();
      });

      it("should create ChannelId from valid UUID", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174001";
        const result = ChannelId.fromString(uuid);
        expect(result.ok).toBeTruthy();
      });
    });

    describe("AccountId", () => {
      it("should generate a new AccountId", () => {
        const accountId = AccountId.generate();
        expect(accountId).toBeTruthy();
      });
    });

    describe("ProjectId", () => {
      it("should generate a new ProjectId", () => {
        const projectId = ProjectId.generate();
        expect(projectId).toBeTruthy();
      });
    });
  }); // Entity Identifiers

  describe("PublishStatus", () => {
    it("should create a draft status", () => {
      const status = PublishStatus.draft();
      expect(status.value).toBe(PUBLISH_STATUS.DRAFT);
      expect(status.isDraft()).toBeTruthy();
    });

    it("should create from string", () => {
      const result = PublishStatus.fromString("scheduled");
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.isScheduled()).toBeTruthy();
      }
    });

    it("should reject invalid status string", () => {
      const result = PublishStatus.fromString("invalid");
      expect(result.ok).toBeFalsy();
    });

    it("should allow valid state transitions", () => {
      const draft = PublishStatus.draft();
      expect(draft.canTransitionTo(PUBLISH_STATUS.SCHEDULED)).toBeTruthy();
      expect(draft.canTransitionTo(PUBLISH_STATUS.PUBLISHING)).toBeTruthy();
    });

    it("should reject invalid state transitions", () => {
      const published = PublishStatus.published();
      expect(published.canTransitionTo(PUBLISH_STATUS.DRAFT)).toBeFalsy();
      expect(published.isTerminal()).toBeTruthy();
    });

    it("should transition to valid status", () => {
      const draft = PublishStatus.draft();
      const result = draft.transitionTo(PUBLISH_STATUS.SCHEDULED);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.isScheduled()).toBeTruthy();
      }
    });

    it("should identify editable statuses", () => {
      expect(PublishStatus.draft().isEditable()).toBeTruthy();
      expect(PublishStatus.failed().isEditable()).toBeTruthy();
      expect(PublishStatus.published().isEditable()).toBeFalsy();
      expect(PublishStatus.publishing().isEditable()).toBeFalsy();
    });
  }); // PublishStatus

  describe("Content", () => {
    it("should create content with valid body", () => {
      const result = Content.create({ body: "Hello world" });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.body).toBe("Hello world");
        expect(result.value.locale).toBe("en");
      }
    });

    it("should reject empty body", () => {
      const result = Content.create({ body: "" });
      expect(result.ok).toBeFalsy();
    });

    it("should create content with all properties", () => {
      const result = Content.create({
        body: "Hello world",
        title: "My Title",
        summary: "A summary",
        tags: ["tag1", "tag2"],
        locale: "en",
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.title).toBe("My Title");
        expect(result.value.summary).toBe("A summary");
        expect([...result.value.tags]).toEqual(["tag1", "tag2"]);
        expect(result.value.locale).toBe("en");
      }
    });

    it("should deduplicate tags", () => {
      const result = Content.create({
        body: "Hello",
        tags: ["tag1", "tag1", "tag2"],
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect([...result.value.tags]).toEqual(["tag1", "tag2"]);
      }
    });

    it("should be immutable - withBody returns new instance", () => {
      const content1 = Content.create({ body: "Original" });
      expect(content1.ok).toBeTruthy();
      if (content1.ok) {
        const result = content1.value.withBody("Updated");
        expect(result.ok).toBeTruthy();
        if (result.ok) {
          expect(content1.value.body).toBe("Original");
          expect(result.value.body).toBe("Updated");
        }
      }
    });

    it("should calculate character count", () => {
      const result = Content.create({ body: "Hello", title: "World" });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.characterCount).toBe(10);
      }
    });

    it("should calculate word count", () => {
      const result = Content.create({ body: "Hello world from test" });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.wordCount).toBe(4);
      }
    });

    it("should reject whitespace-only body", () => {
      const result = Content.create({ body: "   " });
      expect(result.ok).toBeFalsy();
    });

    it("should filter empty and whitespace-only tags", () => {
      const result = Content.create({ body: "Hello", tags: ["", " ", "tag1"] });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect([...result.value.tags]).toEqual(["tag1"]);
      }
    });

    it("should compute word count for single word", () => {
      const result = Content.create({ body: "Hello" });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.wordCount).toBe(1);
      }
    });

    it("should compute word count with multiple spaces", () => {
      const result = Content.create({ body: "Hello  world" });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.wordCount).toBe(2);
      }
    });

    it("should have hasMedia false when no mediaIds", () => {
      const result = Content.create({ body: "Hello" });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.hasMedia).toBe(false);
      }
    });

    it("should have hasMedia true after withMedia", () => {
      const result = Content.create({ body: "Hello" });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const mediaId = MediaId.generate();
        const withMedia = result.value.withMedia([mediaId]);
        expect(withMedia.hasMedia).toBe(true);
      }
    });

    it("should accept body of exactly 280 chars for X platform", () => {
      const body = "x".repeat(280);
      const result = Content.create({ body });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const fitResult = result.value.fitsInPlatform("X");
        expect(fitResult.ok).toBeTruthy();
      }
    });

    it("should reject body of 281 chars for X platform", () => {
      const body = "x".repeat(281);
      const result = Content.create({ body });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const fitResult = result.value.fitsInPlatform("X");
        expect(fitResult.ok).toBeFalsy();
      }
    });

    it("should preserve original title after withTitle", () => {
      const result = Content.create({ body: "Body", title: "Original" });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const updated = result.value.withTitle("New Title");
        expect(result.value.title).toBe("Original");
        expect(updated.title).toBe("New Title");
      }
    });

    it("should preserve original tags after withTags", () => {
      const result = Content.create({ body: "Body", tags: ["old"] });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const updated = result.value.withTags(["new"]);
        expect([...result.value.tags]).toEqual(["old"]);
        expect([...updated.tags]).toEqual(["new"]);
      }
    });

    it("should be equal when body, title, tags, locale are identical", () => {
      const r1 = Content.create({ body: "Same body", tags: ["tag1"], locale: "en" });
      const r2 = Content.create({ body: "Same body", tags: ["tag1"], locale: "en" });
      expect(r1.ok && r2.ok).toBeTruthy();
      if (r1.ok && r2.ok) {
        expect(r1.value.equals(r2.value)).toBeTruthy();
      }
    });

    it("should not be equal when bodies differ", () => {
      const r1 = Content.create({ body: "Body A" });
      const r2 = Content.create({ body: "Body B" });
      expect(r1.ok && r2.ok).toBeTruthy();
      if (r1.ok && r2.ok) {
        expect(r1.value.equals(r2.value)).toBeFalsy();
      }
    });

    it("should include 'body' in empty body error message", () => {
      const result = Content.create({ body: "" });
      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.message.toLowerCase().includes("body")).toBeTruthy();
      }
    });

    it("reconstitute should bypass empty body validation (for DB data)", () => {
      // reconstitute() is for trusted data from persistence, bypasses create() validation
      const content = Content.reconstitute({
        body: "Reconstituted body",
        title: "Title",
        tags: ["tag1"],
        locale: "en",
      });
      expect(content.body).toBe("Reconstituted body");
      expect(content.title).toBe("Title");
      expect([...content.tags]).toEqual(["tag1"]);
      expect(content.locale).toBe("en");
    });

    it("reconstitute should deduplicate and filter tags", () => {
      const content = Content.reconstitute({
        body: "Body",
        tags: ["tag1", "tag1", " ", "tag2"],
        locale: "en",
      });
      expect([...content.tags]).toEqual(["tag1", "tag2"]);
    });

    it("Content.create should trim leading/trailing whitespace from body", () => {
      const result = Content.create({ body: "  Hello world  " });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.body).toBe("Hello world");
      }
    });

    it("Content.withMedia should return new instance without mutating original", () => {
      const r = Content.create({ body: "Body" });
      expect(r.ok).toBeTruthy();
      if (r.ok) {
        const original = r.value;
        expect(original.hasMedia).toBe(false);

        const mediaId = MediaId.generate();
        const updated = original.withMedia([mediaId]);

        expect(original.hasMedia).toBe(false);
        expect(updated.hasMedia).toBe(true);
        expect(updated.mediaIds.length).toBe(1);
      }
    });
  }); // Content
}); // Domain Value Objects
