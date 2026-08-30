/**
 * @file postComment.test.ts
 * @description Unit tests for CommentId value object and PostCommentAggregate.
 * @layer domain
 */

import { describe, it, beforeEach, expect } from "vitest";
import { CommentId } from "@core/domain/value-objects/CommentId.js";
import {
  PostCommentAggregate,
  type CreateCommentProps,
} from "@core/domain/aggregates/PostCommentAggregate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const AUTHOR_ID = "author-a1b2c3d4-e5f6-4a7b-8c9d-000000000001";
const OTHER_USER = "other-a1b2c3d4-e5f6-4a7b-8c9d-000000000002";

const makeProps = (overrides?: Partial<CreateCommentProps>): CreateCommentProps => ({
  postId: "post-uuid-001",
  authorId: AUTHOR_ID,
  body: "This is a valid comment body",
  ...overrides,
});

const createComment = (overrides?: Partial<CreateCommentProps>): PostCommentAggregate => {
  const result = PostCommentAggregate.create(makeProps(overrides));
  expect(result.ok).toBeTruthy();
  return result.value;
};

// ---------------------------------------------------------------------------
// CommentId
// ---------------------------------------------------------------------------

describe("CommentId", () => {
  it("generates unique IDs on each call", () => {
    const id1 = CommentId.generate();
    const id2 = CommentId.generate();
    expect(id1.value.length > 0).toBeTruthy();
    expect(id1.value).not.toBe(id2.value);
  });

  it("creates from valid UUID string", () => {
    const result = CommentId.fromString(VALID_UUID);
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.value).toBe(VALID_UUID);
    }
  });

  it("returns error for invalid UUID", () => {
    const result = CommentId.fromString("not-a-uuid");
    expect(result.ok).toBeFalsy();
  });

  it("equals returns true for same value and false for different", () => {
    const id1 = CommentId.fromStringUnsafe(VALID_UUID);
    const id2 = CommentId.fromStringUnsafe(VALID_UUID);
    const id3 = CommentId.generate();
    expect(id1.equals(id2)).toBeTruthy();
    expect(id1.equals(id3)).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// PostCommentAggregate — create
// ---------------------------------------------------------------------------

describe("PostCommentAggregate create", () => {
  it("creates aggregate with valid props", () => {
    const result = PostCommentAggregate.create(makeProps());
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      const comment = result.value;
      expect(comment.postId).toBe("post-uuid-001");
      expect(comment.authorId).toBe(AUTHOR_ID);
      expect(comment.body).toBe("This is a valid comment body");
      expect(comment.isEdited).toBe(false);
      expect(comment.isDeleted()).toBe(false);
      expect(comment.isReply()).toBe(false);
      expect(comment.id.value.length > 0).toBeTruthy();
    }
  });

  it("rejects empty body", () => {
    const result = PostCommentAggregate.create(makeProps({ body: "" }));
    expect(result.ok).toBeFalsy();
  });

  it("rejects empty postId", () => {
    const result = PostCommentAggregate.create(makeProps({ postId: "" }));
    expect(result.ok).toBeFalsy();
  });

  it("rejects empty authorId", () => {
    const result = PostCommentAggregate.create(makeProps({ authorId: "" }));
    expect(result.ok).toBeFalsy();
  });

  it("extracts @mentions from body", () => {
    const result = PostCommentAggregate.create(makeProps({ body: "Hey @john check this @jane!" }));
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      const mentions = result.value.mentions;
      expect(mentions.length).toBe(2);
      expect(mentions.includes("john")).toBeTruthy();
      expect(mentions.includes("jane")).toBeTruthy();
    }
  });

  it("creates reply with parentId", () => {
    const parentCommentId = "parent-uuid-001";
    const result = PostCommentAggregate.create(makeProps({ parentId: parentCommentId }));
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.parentId).toBe(parentCommentId);
      expect(result.value.isReply()).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// PostCommentAggregate — editBody
// ---------------------------------------------------------------------------

describe("PostCommentAggregate editBody", () => {
  let comment: PostCommentAggregate;

  beforeEach(() => {
    comment = createComment();
  });

  it("edits body when editor is the author", () => {
    const result = comment.editBody("Updated body text", AUTHOR_ID);
    expect(result.ok).toBeTruthy();
    expect(comment.body).toBe("Updated body text");
  });

  it("rejects edit from non-author", () => {
    const result = comment.editBody("Hacked body", OTHER_USER);
    expect(result.ok).toBeFalsy();
  });

  it("rejects edit on deleted comment", () => {
    comment.softDelete(AUTHOR_ID, false);
    const result = comment.editBody("Should fail", AUTHOR_ID);
    expect(result.ok).toBeFalsy();
  });

  it("sets isEdited flag and editedAt after editing", () => {
    expect(comment.isEdited).toBe(false);
    expect(comment.editedAt).toBe(undefined);

    const result = comment.editBody("New body", AUTHOR_ID);
    expect(result.ok).toBeTruthy();
    expect(comment.isEdited).toBe(true);
    expect(comment.editedAt instanceof Date).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PostCommentAggregate — softDelete
// ---------------------------------------------------------------------------

describe("PostCommentAggregate softDelete", () => {
  let comment: PostCommentAggregate;

  beforeEach(() => {
    comment = createComment();
  });

  it("soft deletes when deleter is the author", () => {
    const result = comment.softDelete(AUTHOR_ID, false);
    expect(result.ok).toBeTruthy();
    expect(comment.isDeleted()).toBeTruthy();
    expect(comment.deletedAt instanceof Date).toBeTruthy();
  });

  it("soft deletes when deleter is admin", () => {
    const result = comment.softDelete(OTHER_USER, true);
    expect(result.ok).toBeTruthy();
    expect(comment.isDeleted()).toBeTruthy();
  });

  it("rejects delete from non-author non-admin", () => {
    const result = comment.softDelete(OTHER_USER, false);
    expect(result.ok).toBeFalsy();
  });

  it("returns error when deleting already deleted comment", () => {
    comment.softDelete(AUTHOR_ID, false);
    const result = comment.softDelete(AUTHOR_ID, false);
    expect(result.ok).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// PostCommentAggregate — predicates
// ---------------------------------------------------------------------------

describe("PostCommentAggregate predicates", () => {
  it("isDeleted returns true after soft delete", () => {
    const comment = createComment();
    expect(comment.isDeleted()).toBe(false);
    comment.softDelete(AUTHOR_ID, false);
    expect(comment.isDeleted()).toBe(true);
  });

  it("isReply returns true when parentId exists", () => {
    const comment = createComment({ parentId: "parent-uuid-001" });
    expect(comment.isReply()).toBe(true);
  });

  it("isReply returns false when no parentId", () => {
    const comment = createComment();
    expect(comment.isReply()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PostCommentAggregate — comment whose author was erased
// ---------------------------------------------------------------------------

describe("PostCommentAggregate with an erased author", () => {
  // `PostComment.authorId` is nullable + SET NULL: hard-deleting a customer
  // user leaves the comment standing as thread history with no author. The
  // aggregate has to be able to REPRESENT that — a comment that cannot be
  // loaded is a comment silently missing from every thread.
  const orphaned = (): PostCommentAggregate =>
    PostCommentAggregate.reconstitute({
      id: CommentId.fromStringUnsafe(VALID_UUID),
      postId: "post-uuid-001",
      authorId: null,
      body: "Written by someone who no longer exists",
      mentions: [],
      isEdited: false,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      version: 1,
    });

  it("reconstitutes with a null author instead of inventing one", () => {
    expect(orphaned().authorId).toBe(null);
  });

  it("refuses every edit, because nobody is the author any more", () => {
    const comment = orphaned();
    const result = comment.editBody("Rewritten body", OTHER_USER);
    expect(result.ok).toBeFalsy();
    expect(comment.body).toBe("Written by someone who no longer exists");
  });

  it("refuses a non-admin delete but still allows moderation", () => {
    expect(orphaned().softDelete(OTHER_USER, false).ok).toBeFalsy();
    expect(orphaned().softDelete(OTHER_USER, true).ok).toBeTruthy();
  });
});
