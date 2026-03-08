import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
} from "./value-objects.test-helpers.js";

describe("Domain Value Objects - Entity Identifiers", () => {
  describe("PostId", () => {
    it("should generate a new PostId", () => {
      const postId = PostId.generate();
      assert.ok(postId, "PostId should be generated");
      assert.ok(postId.value.length === 36, "PostId should be a UUID");
    });

    it("should create PostId from valid UUID string", () => {
      const uuid = "123e4567-e89b-42d3-a456-426614174000";
      const result = PostId.fromString(uuid);
      assert.ok(result.ok, "Should create PostId from valid UUID");
      if (result.ok) {
        assert.equal(result.value.value, uuid);
      }
    });

    it("should reject invalid UUID string", () => {
      const result = PostId.fromString("invalid-id");
      assert.ok(!result.ok, "Should reject invalid UUID");
    });

    it("should reject empty string", () => {
      const result = PostId.fromString("");
      assert.ok(!result.ok, "Should reject empty string");
    });

    it("should check equality correctly", () => {
      const uuid = "123e4567-e89b-42d3-a456-426614174000";
      const id1 = PostId.fromStringUnsafe(uuid);
      const id2 = PostId.fromStringUnsafe(uuid);
      const id3 = PostId.generate();

      assert.ok(id1.equals(id2), "Same UUIDs should be equal");
      assert.ok(!id1.equals(id3), "Different UUIDs should not be equal");
    });

    it("should reject UUID with version nibble != 4 (version 3)", () => {
      const uuidV3 = "123e4567-e89b-32d3-a456-426614174000";
      const result = PostId.fromString(uuidV3);
      assert.ok(!result.ok, "Should reject UUID v3 (version nibble = 3)");
    });

    it("should reject UUID with invalid variant nibble", () => {
      const uuidBadVariant = "123e4567-e89b-42d3-c456-426614174000";
      const result = PostId.fromString(uuidBadVariant);
      assert.ok(!result.ok, "Should reject UUID with variant nibble 'c'");
    });

    it("should reject whitespace-only string", () => {
      const result = PostId.fromString("   ");
      assert.ok(!result.ok, "Should reject whitespace-only string");
    });

    it("should return uuid via toString()", () => {
      const uuid = "123e4567-e89b-42d3-a456-426614174000";
      const id = PostId.fromStringUnsafe(uuid);
      assert.equal(id.toString(), uuid);
    });

    it("should have non-empty error message for empty id", () => {
      const result = PostId.fromString("");
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.ok(result.error.message.length > 0, "Error message should not be empty");
      }
    });
  });

  describe("ContentId", () => {
    it("should generate a new ContentId", () => {
      const id = ContentId.generate();
      assert.ok(id, "ContentId should be generated");
      assert.equal(id.value.length, 36, "ContentId should be a UUID");
    });

    it("should create ContentId from valid UUID", () => {
      const uuid = "123e4567-e89b-42d3-a456-426614174002";
      const result = ContentId.fromString(uuid);
      assert.ok(result.ok, "Should create ContentId from valid UUID");
      if (result.ok) {
        assert.equal(result.value.value, uuid);
      }
    });

    it("should reject invalid UUID in ContentId", () => {
      const result = ContentId.fromString("not-valid");
      assert.ok(!result.ok, "Should reject invalid UUID");
    });
  });

  describe("MediaId", () => {
    it("should generate a new MediaId", () => {
      const id = MediaId.generate();
      assert.ok(id, "MediaId should be generated");
      assert.equal(id.value.length, 36, "MediaId should be a UUID");
    });

    it("should create MediaId from valid UUID", () => {
      const uuid = "123e4567-e89b-42d3-a456-426614174003";
      const result = MediaId.fromString(uuid);
      assert.ok(result.ok, "Should create MediaId from valid UUID");
      if (result.ok) {
        assert.equal(result.value.value, uuid);
      }
    });

    it("should reject empty string in MediaId", () => {
      const result = MediaId.fromString("");
      assert.ok(!result.ok, "Should reject empty string");
    });
  });

  describe("TrackedLinkId", () => {
    it("should generate a new TrackedLinkId", () => {
      const id = TrackedLinkId.generate();
      assert.ok(id, "TrackedLinkId should be generated");
      assert.equal(id.value.length, 36, "TrackedLinkId should be a UUID");
    });

    it("should create TrackedLinkId from valid UUID", () => {
      const uuid = "123e4567-e89b-42d3-a456-426614174004";
      const result = TrackedLinkId.fromString(uuid);
      assert.ok(result.ok, "Should create TrackedLinkId from valid UUID");
    });

    it("should reject invalid UUID in TrackedLinkId", () => {
      const result = TrackedLinkId.fromString("bad-id");
      assert.ok(!result.ok, "Should reject invalid UUID");
    });
  });

  describe("LinkClickId", () => {
    it("should generate a new LinkClickId", () => {
      const id = LinkClickId.generate();
      assert.ok(id, "LinkClickId should be generated");
      assert.equal(id.value.length, 36, "LinkClickId should be a UUID");
    });

    it("should create LinkClickId from valid UUID", () => {
      const uuid = "123e4567-e89b-42d3-a456-426614174005";
      const result = LinkClickId.fromString(uuid);
      assert.ok(result.ok, "Should create LinkClickId from valid UUID");
    });

    it("should reject empty string in LinkClickId", () => {
      const result = LinkClickId.fromString("");
      assert.ok(!result.ok, "Should reject empty string");
    });
  });

  describe("ChannelId", () => {
    it("should generate a new ChannelId", () => {
      const channelId = ChannelId.generate();
      assert.ok(channelId, "ChannelId should be generated");
    });

    it("should create ChannelId from valid UUID", () => {
      const uuid = "123e4567-e89b-42d3-a456-426614174001";
      const result = ChannelId.fromString(uuid);
      assert.ok(result.ok, "Should create ChannelId from valid UUID");
    });
  });

  describe("AccountId", () => {
    it("should generate a new AccountId", () => {
      const accountId = AccountId.generate();
      assert.ok(accountId, "AccountId should be generated");
    });
  });

  describe("ProjectId", () => {
    it("should generate a new ProjectId", () => {
      const projectId = ProjectId.generate();
      assert.ok(projectId, "ProjectId should be generated");
    });
  });
});

describe("Domain Value Objects - PublishStatus", () => {
  it("should create a draft status", () => {
    const status = PublishStatus.draft();
    assert.equal(status.value, PUBLISH_STATUS.DRAFT);
    assert.ok(status.isDraft());
  });

  it("should create from string", () => {
    const result = PublishStatus.fromString("scheduled");
    assert.ok(result.ok, "Should create from lowercase string");
    if (result.ok) {
      assert.ok(result.value.isScheduled());
    }
  });

  it("should reject invalid status string", () => {
    const result = PublishStatus.fromString("invalid");
    assert.ok(!result.ok, "Should reject invalid status");
  });

  it("should allow valid state transitions", () => {
    const draft = PublishStatus.draft();
    assert.ok(draft.canTransitionTo(PUBLISH_STATUS.SCHEDULED), "Draft can transition to Scheduled");
    assert.ok(
      draft.canTransitionTo(PUBLISH_STATUS.PUBLISHING),
      "Draft can transition to Publishing"
    );
  });

  it("should reject invalid state transitions", () => {
    const published = PublishStatus.published();
    assert.ok(
      !published.canTransitionTo(PUBLISH_STATUS.DRAFT),
      "Published cannot transition to Draft"
    );
    assert.ok(published.isTerminal(), "Published should be terminal");
  });

  it("should transition to valid status", () => {
    const draft = PublishStatus.draft();
    const result = draft.transitionTo(PUBLISH_STATUS.SCHEDULED);
    assert.ok(result.ok, "Should transition to Scheduled");
    if (result.ok) {
      assert.ok(result.value.isScheduled());
    }
  });

  it("should identify editable statuses", () => {
    assert.ok(PublishStatus.draft().isEditable());
    assert.ok(PublishStatus.failed().isEditable());
    assert.ok(!PublishStatus.published().isEditable());
    assert.ok(!PublishStatus.publishing().isEditable());
  });
});

describe("Domain Value Objects - Content", () => {
  it("should create content with valid body", () => {
    const result = Content.create({ body: "Hello world" });
    assert.ok(result.ok, "Should create content");
    if (result.ok) {
      assert.equal(result.value.body, "Hello world");
      assert.equal(result.value.locale, "en");
    }
  });

  it("should reject empty body", () => {
    const result = Content.create({ body: "" });
    assert.ok(!result.ok, "Should reject empty body");
  });

  it("should create content with all properties", () => {
    const result = Content.create({
      body: "Hello world",
      title: "My Title",
      summary: "A summary",
      tags: ["tag1", "tag2"],
      locale: "en",
    });
    assert.ok(result.ok, "Should create content");
    if (result.ok) {
      assert.equal(result.value.title, "My Title");
      assert.equal(result.value.summary, "A summary");
      assert.deepEqual([...result.value.tags], ["tag1", "tag2"]);
      assert.equal(result.value.locale, "en");
    }
  });

  it("should deduplicate tags", () => {
    const result = Content.create({
      body: "Hello",
      tags: ["tag1", "tag1", "tag2"],
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual([...result.value.tags], ["tag1", "tag2"]);
    }
  });

  it("should be immutable - withBody returns new instance", () => {
    const content1 = Content.create({ body: "Original" });
    assert.ok(content1.ok);
    if (content1.ok) {
      const result = content1.value.withBody("Updated");
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(content1.value.body, "Original");
        assert.equal(result.value.body, "Updated");
      }
    }
  });

  it("should calculate character count", () => {
    const result = Content.create({ body: "Hello", title: "World" });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.characterCount, 10);
    }
  });

  it("should calculate word count", () => {
    const result = Content.create({ body: "Hello world from test" });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.wordCount, 4);
    }
  });

  it("should reject whitespace-only body", () => {
    const result = Content.create({ body: "   " });
    assert.ok(!result.ok, "Should reject whitespace-only body");
  });

  it("should filter empty and whitespace-only tags", () => {
    const result = Content.create({ body: "Hello", tags: ["", " ", "tag1"] });
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual([...result.value.tags], ["tag1"]);
    }
  });

  it("should compute word count for single word", () => {
    const result = Content.create({ body: "Hello" });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.wordCount, 1);
    }
  });

  it("should compute word count with multiple spaces", () => {
    const result = Content.create({ body: "Hello  world" });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.wordCount, 2);
    }
  });

  it("should have hasMedia false when no mediaIds", () => {
    const result = Content.create({ body: "Hello" });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.hasMedia, false);
    }
  });

  it("should have hasMedia true after withMedia", () => {
    const result = Content.create({ body: "Hello" });
    assert.ok(result.ok);
    if (result.ok) {
      const mediaId = MediaId.generate();
      const withMedia = result.value.withMedia([mediaId]);
      assert.equal(withMedia.hasMedia, true);
    }
  });

  it("should accept body of exactly 280 chars for X platform", () => {
    const body = "x".repeat(280);
    const result = Content.create({ body });
    assert.ok(result.ok);
    if (result.ok) {
      const fitResult = result.value.fitsInPlatform("X");
      assert.ok(fitResult.ok, "Exactly 280 chars should fit in X");
    }
  });

  it("should reject body of 281 chars for X platform", () => {
    const body = "x".repeat(281);
    const result = Content.create({ body });
    assert.ok(result.ok);
    if (result.ok) {
      const fitResult = result.value.fitsInPlatform("X");
      assert.ok(!fitResult.ok, "281 chars should not fit in X");
    }
  });

  it("should preserve original title after withTitle", () => {
    const result = Content.create({ body: "Body", title: "Original" });
    assert.ok(result.ok);
    if (result.ok) {
      const updated = result.value.withTitle("New Title");
      assert.equal(result.value.title, "Original", "Original title should be unchanged");
      assert.equal(updated.title, "New Title");
    }
  });

  it("should preserve original tags after withTags", () => {
    const result = Content.create({ body: "Body", tags: ["old"] });
    assert.ok(result.ok);
    if (result.ok) {
      const updated = result.value.withTags(["new"]);
      assert.deepEqual([...result.value.tags], ["old"], "Original tags should be unchanged");
      assert.deepEqual([...updated.tags], ["new"]);
    }
  });

  it("should be equal when body, title, tags, locale are identical", () => {
    const r1 = Content.create({ body: "Same body", tags: ["tag1"], locale: "en" });
    const r2 = Content.create({ body: "Same body", tags: ["tag1"], locale: "en" });
    assert.ok(r1.ok && r2.ok);
    if (r1.ok && r2.ok) {
      assert.ok(r1.value.equals(r2.value), "Identical contents should be equal");
    }
  });

  it("should not be equal when bodies differ", () => {
    const r1 = Content.create({ body: "Body A" });
    const r2 = Content.create({ body: "Body B" });
    assert.ok(r1.ok && r2.ok);
    if (r1.ok && r2.ok) {
      assert.ok(!r1.value.equals(r2.value), "Different bodies should not be equal");
    }
  });

  it("should include 'body' in empty body error message", () => {
    const result = Content.create({ body: "" });
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.ok(
        result.error.message.toLowerCase().includes("body"),
        `Error message should reference 'body', got: "${result.error.message}"`
      );
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
    assert.equal(content.body, "Reconstituted body");
    assert.equal(content.title, "Title");
    assert.deepEqual([...content.tags], ["tag1"]);
    assert.equal(content.locale, "en");
  });

  it("reconstitute should deduplicate and filter tags", () => {
    const content = Content.reconstitute({
      body: "Body",
      tags: ["tag1", "tag1", " ", "tag2"],
      locale: "en",
    });
    assert.deepEqual([...content.tags], ["tag1", "tag2"]);
  });

  it("Content.create should trim leading/trailing whitespace from body", () => {
    const result = Content.create({ body: "  Hello world  " });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.body, "Hello world");
    }
  });

  it("Content.withMedia should return new instance without mutating original", () => {
    const r = Content.create({ body: "Body" });
    assert.ok(r.ok);
    if (r.ok) {
      const original = r.value;
      assert.equal(original.hasMedia, false);

      const mediaId = MediaId.generate();
      const updated = original.withMedia([mediaId]);

      assert.equal(original.hasMedia, false, "Original should be unchanged");
      assert.equal(updated.hasMedia, true);
      assert.equal(updated.mediaIds.length, 1);
    }
  });
});
