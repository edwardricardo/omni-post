#!/usr/bin/env tsx
/**
 * @file NotificationEventHandlers.test.ts
 * @description Unit tests for NotificationEventHandlers — verifies that each
 *   domain event handler delegates correctly to CreateNotificationUseCase with
 *   the expected notification type, title, body, and context fields.
 * @layer application
 */

import { describe, it, beforeEach, expect } from "vitest";
import { ok } from "@shared/types";
import {
  NotificationEventHandlers,
  type NotificationEventContext,
} from "@core/notifications/handlers/NotificationEventHandlers.js";
import type {
  CreateNotificationInput,
  CreateNotificationOutput,
} from "@core/notifications/CreateNotificationUseCase.js";

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
    } as unknown as import("@core/notifications/CreateNotificationUseCase.js").CreateNotificationUseCase,
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

      expect(mock.calls.length).toBe(1);
      const input = mock.calls[0]!.input;
      expect(input.recipientId).toBe("member-recipient-001");
      expect(input.type).toBe("APPROVAL_REQUESTED");
      expect(input.title).toBe("Post submitted for review");
      expect(input.body).toBe("A post has been submitted for your review");
      expect(input.resourceType).toBe("post");
      expect(input.resourceId).toBe("post-001");
      expect(input.actorId).toBe("member-actor-001");
      expect(input.actorName).toBe("Alice");
    });

    it("omits actorId and actorName when not provided in context", async () => {
      const ctx = makeContext({ actorId: undefined, actorName: undefined });
      await handlers.onPostSubmittedForReview("post-002", "project-001", ctx);

      expect(mock.calls.length).toBe(1);
      const input = mock.calls[0]!.input;
      expect(input.actorId).toBe(undefined);
      expect(input.actorName).toBe(undefined);
    });

    it("passes the correct recipientId from context", async () => {
      const ctx = makeContext({ recipientId: "reviewer-999" });
      await handlers.onPostSubmittedForReview("post-003", "project-002", ctx);

      expect(mock.calls[0]!.input.recipientId).toBe("reviewer-999");
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

      expect(mock.calls.length).toBe(1);
      const input = mock.calls[0]!.input;
      expect(input.type).toBe("POST_APPROVED");
      expect(input.title).toBe("Post approved");
      expect(input.body.includes("2026-04-01T10:00:00.000Z")).toBeTruthy();
      expect(input.resourceType).toBe("post");
      expect(input.resourceId).toBe("post-010");
    });

    it("includes actor context when provided", async () => {
      const ctx = makeContext({ actorId: "approver-001", actorName: "Bob" });
      await handlers.onPostApproved("post-011", new Date(), ctx);

      const input = mock.calls[0]!.input;
      expect(input.actorId).toBe("approver-001");
      expect(input.actorName).toBe("Bob");
    });
  });

  // -----------------------------------------------------------------------
  // onPostRejected
  // -----------------------------------------------------------------------

  describe("onPostRejected", () => {
    it("creates a POST_REJECTED notification with reason in body", async () => {
      const ctx = makeContext();
      await handlers.onPostRejected("post-020", "Needs more detail", ctx);

      expect(mock.calls.length).toBe(1);
      const input = mock.calls[0]!.input;
      expect(input.type).toBe("POST_REJECTED");
      expect(input.title).toBe("Post rejected");
      expect(input.body).toBe("Your post was rejected: Needs more detail");
      expect(input.resourceId).toBe("post-020");
    });

    it("creates a POST_REJECTED notification without reason when undefined", async () => {
      const ctx = makeContext();
      await handlers.onPostRejected("post-021", undefined, ctx);

      const input = mock.calls[0]!.input;
      expect(input.body).toBe("Your post was rejected");
    });
  });

  // -----------------------------------------------------------------------
  // onCommentAdded
  // -----------------------------------------------------------------------

  describe("onCommentAdded", () => {
    it("creates a COMMENT_ADDED notification for a top-level comment", async () => {
      const ctx = makeContext();
      await handlers.onCommentAdded("post-030", "comment-001", "author-001", undefined, [], ctx);

      expect(mock.calls.length).toBe(1);
      const input = mock.calls[0]!.input;
      expect(input.type).toBe("COMMENT_ADDED");
      expect(input.title).toBe("New comment on your post");
      expect(input.body).toBe("A new comment was added to your post");
      expect(input.resourceType).toBe("comment");
      expect(input.resourceId).toBe("comment-001");
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

      expect(mock.calls.length).toBe(1);
      const input = mock.calls[0]!.input;
      expect(input.type).toBe("COMMENT_REPLY");
      expect(input.title).toBe("New reply to your comment");
      expect(input.body).toBe("Someone replied to your comment");
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
      expect(mock.calls.length).toBe(3);

      const mentionCalls = mock.calls.filter((c) => c.input.type === "MENTION");
      expect(mentionCalls.length).toBe(2);
      expect(mentionCalls[0]!.input.recipientId).toBe("user-a");
      expect(mentionCalls[1]!.input.recipientId).toBe("user-b");
      expect(mentionCalls[0]!.input.title).toBe("You were mentioned");
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
      expect(mock.calls.length).toBe(2);

      const mentionCalls = mock.calls.filter((c) => c.input.type === "MENTION");
      expect(mentionCalls.length).toBe(1);
      expect(mentionCalls[0]!.input.recipientId).toBe("user-b");
    });
  });
});
