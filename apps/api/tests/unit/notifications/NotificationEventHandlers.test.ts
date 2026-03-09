#!/usr/bin/env tsx
/**
 * @file NotificationEventHandlers.test.ts
 * @description Unit tests for NotificationEventHandlers — verifies that each
 *   domain event handler delegates correctly to CreateNotificationUseCase with
 *   the expected notification type, title, body, and context fields.
 * @layer application
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import {
  NotificationEventHandlers,
  type NotificationEventContext,
} from "../../../src/application/notifications/handlers/NotificationEventHandlers.js";
import type {
  CreateNotificationInput,
  CreateNotificationOutput,
} from "../../../src/application/notifications/CreateNotificationUseCase.js";

// ---------------------------------------------------------------------------
// Mock CreateNotificationUseCase
// ---------------------------------------------------------------------------

interface RecordedCall {
  input: CreateNotificationInput;
}

function createMockUseCase() {
  const calls: RecordedCall[] = [];

  const execute = async (
    input: CreateNotificationInput
  ): Promise<{ ok: true; value: CreateNotificationOutput }> => {
    calls.push({ input });
    return ok({ id: `notif-${calls.length}` });
  };

  return {
    // Cast to satisfy the constructor signature
    useCase: {
      execute,
    } as unknown as import("../../../src/application/notifications/CreateNotificationUseCase.js").CreateNotificationUseCase,
    calls,
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeContext(overrides?: Partial<NotificationEventContext>): NotificationEventContext {
  return {
    recipientId: "member-recipient-001",
    actorId: "member-actor-001",
    actorName: "Alice",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationEventHandlers", () => {
  let handlers: NotificationEventHandlers;
  let mock: ReturnType<typeof createMockUseCase>;

  beforeEach(() => {
    mock = createMockUseCase();
    handlers = new NotificationEventHandlers(mock.useCase);
  });

  // -----------------------------------------------------------------------
  // onPostSubmittedForReview
  // -----------------------------------------------------------------------

  describe("onPostSubmittedForReview", () => {
    it("creates an APPROVAL_REQUESTED notification with correct fields", async () => {
      const ctx = makeContext();
      await handlers.onPostSubmittedForReview("post-001", "project-001", ctx);

      assert.equal(mock.calls.length, 1);
      const input = mock.calls[0]!.input;
      assert.equal(input.recipientId, "member-recipient-001");
      assert.equal(input.type, "APPROVAL_REQUESTED");
      assert.equal(input.title, "Post submitted for review");
      assert.equal(input.body, "A post has been submitted for your review");
      assert.equal(input.resourceType, "post");
      assert.equal(input.resourceId, "post-001");
      assert.equal(input.actorId, "member-actor-001");
      assert.equal(input.actorName, "Alice");
    });

    it("omits actorId and actorName when not provided in context", async () => {
      const ctx = makeContext({ actorId: undefined, actorName: undefined });
      await handlers.onPostSubmittedForReview("post-002", "project-001", ctx);

      assert.equal(mock.calls.length, 1);
      const input = mock.calls[0]!.input;
      assert.equal(input.actorId, undefined);
      assert.equal(input.actorName, undefined);
    });

    it("passes the correct recipientId from context", async () => {
      const ctx = makeContext({ recipientId: "reviewer-999" });
      await handlers.onPostSubmittedForReview("post-003", "project-002", ctx);

      assert.equal(mock.calls[0]!.input.recipientId, "reviewer-999");
    });
  });

  // -----------------------------------------------------------------------
  // onPostApproved
  // -----------------------------------------------------------------------

  describe("onPostApproved", () => {
    it("creates a POST_APPROVED notification with scheduled date in body", async () => {
      const scheduledAt = new Date("2026-04-01T10:00:00.000Z");
      const ctx = makeContext();
      await handlers.onPostApproved("post-010", scheduledAt, ctx);

      assert.equal(mock.calls.length, 1);
      const input = mock.calls[0]!.input;
      assert.equal(input.type, "POST_APPROVED");
      assert.equal(input.title, "Post approved");
      assert.ok(input.body.includes("2026-04-01T10:00:00.000Z"));
      assert.equal(input.resourceType, "post");
      assert.equal(input.resourceId, "post-010");
    });

    it("includes actor context when provided", async () => {
      const ctx = makeContext({ actorId: "approver-001", actorName: "Bob" });
      await handlers.onPostApproved("post-011", new Date(), ctx);

      const input = mock.calls[0]!.input;
      assert.equal(input.actorId, "approver-001");
      assert.equal(input.actorName, "Bob");
    });
  });

  // -----------------------------------------------------------------------
  // onPostRejected
  // -----------------------------------------------------------------------

  describe("onPostRejected", () => {
    it("creates a POST_REJECTED notification with reason in body", async () => {
      const ctx = makeContext();
      await handlers.onPostRejected("post-020", "Needs more detail", ctx);

      assert.equal(mock.calls.length, 1);
      const input = mock.calls[0]!.input;
      assert.equal(input.type, "POST_REJECTED");
      assert.equal(input.title, "Post rejected");
      assert.equal(input.body, "Your post was rejected: Needs more detail");
      assert.equal(input.resourceId, "post-020");
    });

    it("creates a POST_REJECTED notification without reason when undefined", async () => {
      const ctx = makeContext();
      await handlers.onPostRejected("post-021", undefined, ctx);

      const input = mock.calls[0]!.input;
      assert.equal(input.body, "Your post was rejected");
    });
  });

  // -----------------------------------------------------------------------
  // onCommentAdded
  // -----------------------------------------------------------------------

  describe("onCommentAdded", () => {
    it("creates a COMMENT_ADDED notification for a top-level comment", async () => {
      const ctx = makeContext();
      await handlers.onCommentAdded("post-030", "comment-001", "author-001", undefined, [], ctx);

      assert.equal(mock.calls.length, 1);
      const input = mock.calls[0]!.input;
      assert.equal(input.type, "COMMENT_ADDED");
      assert.equal(input.title, "New comment on your post");
      assert.equal(input.body, "A new comment was added to your post");
      assert.equal(input.resourceType, "comment");
      assert.equal(input.resourceId, "comment-001");
    });

    it("creates a COMMENT_REPLY notification when parentId is present", async () => {
      const ctx = makeContext();
      await handlers.onCommentAdded(
        "post-030",
        "comment-002",
        "author-001",
        "comment-001",
        [],
        ctx
      );

      assert.equal(mock.calls.length, 1);
      const input = mock.calls[0]!.input;
      assert.equal(input.type, "COMMENT_REPLY");
      assert.equal(input.title, "New reply to your comment");
      assert.equal(input.body, "Someone replied to your comment");
    });

    it("creates MENTION notifications for each mentioned user", async () => {
      const ctx = makeContext({ recipientId: "post-owner-001" });
      const mentions = ["user-a", "user-b"];
      await handlers.onCommentAdded(
        "post-030",
        "comment-003",
        "author-001",
        undefined,
        mentions,
        ctx
      );

      // 1 COMMENT_ADDED + 2 MENTION = 3 calls
      assert.equal(mock.calls.length, 3);

      const mentionCalls = mock.calls.filter((c) => c.input.type === "MENTION");
      assert.equal(mentionCalls.length, 2);
      assert.equal(mentionCalls[0]!.input.recipientId, "user-a");
      assert.equal(mentionCalls[1]!.input.recipientId, "user-b");
      assert.equal(mentionCalls[0]!.input.title, "You were mentioned");
    });

    it("skips MENTION notification when mentioned user is the post owner", async () => {
      const ctx = makeContext({ recipientId: "post-owner-001" });
      const mentions = ["post-owner-001", "user-b"];
      await handlers.onCommentAdded(
        "post-030",
        "comment-004",
        "author-001",
        undefined,
        mentions,
        ctx
      );

      // 1 COMMENT_ADDED + 1 MENTION (skipped self) = 2 calls
      assert.equal(mock.calls.length, 2);

      const mentionCalls = mock.calls.filter((c) => c.input.type === "MENTION");
      assert.equal(mentionCalls.length, 1);
      assert.equal(mentionCalls[0]!.input.recipientId, "user-b");
    });
  });
});
