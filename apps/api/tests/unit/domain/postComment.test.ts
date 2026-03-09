/**
 * @file postComment.test.ts
 * @description Unit tests for CommentId value object and PostCommentAggregate.
 * @layer domain
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { CommentId } from "../../../src/domain/value-objects/CommentId.js";
import {
  PostCommentAggregate,
  type CreateCommentProps,
} from "../../../src/domain/aggregates/PostCommentAggregate.js";

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
  assert.ok(result.ok, "Setup: comment creation should succeed");
  return result.value;
};

// ---------------------------------------------------------------------------
// CommentId
// ---------------------------------------------------------------------------

describe("CommentId", () => {
  it("generates unique IDs on each call", () => {
    const id1 = CommentId.generate();
    const id2 = CommentId.generate();
    assert.ok(id1.value.length > 0, "Generated ID should have a value");
    assert.notEqual(id1.value, id2.value, "Two generated IDs should differ");
  });

  it("creates from valid UUID string", () => {
    const result = CommentId.fromString(VALID_UUID);
    assert.ok(result.ok, "Should accept valid UUID");
    if (result.ok) {
      assert.equal(result.value.value, VALID_UUID);
    }
  });

  it("returns error for invalid UUID", () => {
    const result = CommentId.fromString("not-a-uuid");
    assert.ok(!result.ok, "Should reject invalid UUID");
  });

  it("equals returns true for same value and false for different", () => {
    const id1 = CommentId.fromStringUnsafe(VALID_UUID);
    const id2 = CommentId.fromStringUnsafe(VALID_UUID);
    const id3 = CommentId.generate();
    assert.ok(id1.equals(id2), "Same UUID should be equal");
    assert.ok(!id1.equals(id3), "Different UUIDs should not be equal");
  });
});

// ---------------------------------------------------------------------------
// PostCommentAggregate — create
// ---------------------------------------------------------------------------

describe("PostCommentAggregate create", () => {
  it("creates aggregate with valid props", () => {
    const result = PostCommentAggregate.create(makeProps());
    assert.ok(result.ok, "Should create successfully");
    if (result.ok) {
      const comment = result.value;
      assert.equal(comment.postId, "post-uuid-001");
      assert.equal(comment.authorId, AUTHOR_ID);
      assert.equal(comment.body, "This is a valid comment body");
      assert.equal(comment.isEdited, false);
      assert.equal(comment.isDeleted(), false);
      assert.equal(comment.isReply(), false);
      assert.ok(comment.id.value.length > 0);
    }
  });

  it("rejects empty body", () => {
    const result = PostCommentAggregate.create(makeProps({ body: "" }));
    assert.ok(!result.ok, "Should reject empty body");
  });

  it("rejects empty postId", () => {
    const result = PostCommentAggregate.create(makeProps({ postId: "" }));
    assert.ok(!result.ok, "Should reject empty postId");
  });

  it("rejects empty authorId", () => {
    const result = PostCommentAggregate.create(makeProps({ authorId: "" }));
    assert.ok(!result.ok, "Should reject empty authorId");
  });

  it("extracts @mentions from body", () => {
    const result = PostCommentAggregate.create(makeProps({ body: "Hey @john check this @jane!" }));
    assert.ok(result.ok);
    if (result.ok) {
      const mentions = result.value.mentions;
      assert.equal(mentions.length, 2);
      assert.ok(mentions.includes("john"), "Should extract john");
      assert.ok(mentions.includes("jane"), "Should extract jane");
    }
  });

  it("creates reply with parentId", () => {
    const parentCommentId = "parent-uuid-001";
    const result = PostCommentAggregate.create(makeProps({ parentId: parentCommentId }));
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.parentId, parentCommentId);
      assert.ok(result.value.isReply(), "Should be marked as reply");
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
    assert.ok(result.ok, "Author should be able to edit");
    assert.equal(comment.body, "Updated body text");
  });

  it("rejects edit from non-author", () => {
    const result = comment.editBody("Hacked body", OTHER_USER);
    assert.ok(!result.ok, "Non-author should be rejected");
  });

  it("rejects edit on deleted comment", () => {
    comment.softDelete(AUTHOR_ID, false);
    const result = comment.editBody("Should fail", AUTHOR_ID);
    assert.ok(!result.ok, "Deleted comment should not be editable");
  });

  it("sets isEdited flag and editedAt after editing", () => {
    assert.equal(comment.isEdited, false, "Should not be edited initially");
    assert.equal(comment.editedAt, undefined, "editedAt should be undefined initially");

    const result = comment.editBody("New body", AUTHOR_ID);
    assert.ok(result.ok);
    assert.equal(comment.isEdited, true, "isEdited should be true after edit");
    assert.ok(comment.editedAt instanceof Date, "editedAt should be a Date after edit");
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
    assert.ok(result.ok, "Author should be able to delete");
    assert.ok(comment.isDeleted(), "Comment should be deleted");
    assert.ok(comment.deletedAt instanceof Date);
  });

  it("soft deletes when deleter is admin", () => {
    const result = comment.softDelete(OTHER_USER, true);
    assert.ok(result.ok, "Admin should be able to delete");
    assert.ok(comment.isDeleted());
  });

  it("rejects delete from non-author non-admin", () => {
    const result = comment.softDelete(OTHER_USER, false);
    assert.ok(!result.ok, "Non-author non-admin should be rejected");
  });

  it("returns error when deleting already deleted comment", () => {
    comment.softDelete(AUTHOR_ID, false);
    const result = comment.softDelete(AUTHOR_ID, false);
    assert.ok(!result.ok, "Should reject double deletion");
  });
});

// ---------------------------------------------------------------------------
// PostCommentAggregate — predicates
// ---------------------------------------------------------------------------

describe("PostCommentAggregate predicates", () => {
  it("isDeleted returns true after soft delete", () => {
    const comment = createComment();
    assert.equal(comment.isDeleted(), false);
    comment.softDelete(AUTHOR_ID, false);
    assert.equal(comment.isDeleted(), true);
  });

  it("isReply returns true when parentId exists", () => {
    const comment = createComment({ parentId: "parent-uuid-001" });
    assert.equal(comment.isReply(), true);
  });

  it("isReply returns false when no parentId", () => {
    const comment = createComment();
    assert.equal(comment.isReply(), false);
  });
});
