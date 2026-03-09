/**
 * @file notification.test.ts
 * @description Unit tests for NotificationId, NotificationType, and NotificationEntity domain objects.
 * @layer domain
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NotificationId } from "../../../src/domain/value-objects/NotificationId.js";
import {
  NotificationType,
  NOTIFICATION_TYPES,
} from "../../../src/domain/value-objects/NotificationType.js";
import { NotificationEntity } from "../../../src/domain/entities/Notification.js";

// --- Factories ---

const makeNotificationParams = (
  overrides?: Partial<Parameters<typeof NotificationEntity.create>[0]>
) => ({
  recipientId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  type: NOTIFICATION_TYPES.APPROVAL_REQUESTED as const,
  title: "Post needs approval",
  body: "A new post has been submitted for your review.",
  ...overrides,
});

// --- NotificationId ---

describe("NotificationId", () => {
  it("generates unique IDs on each call", () => {
    const id1 = NotificationId.generate();
    const id2 = NotificationId.generate();
    assert.ok(id1.value.length > 0, "Generated ID should have a value");
    assert.notEqual(id1.value, id2.value, "Two generated IDs should differ");
  });

  it("creates from valid UUID string", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const result = NotificationId.fromString(uuid);
    assert.ok(result.ok, "Should accept valid UUID");
    if (result.ok) {
      assert.equal(result.value.value, uuid);
    }
  });

  it("returns error for invalid UUID string", () => {
    const result = NotificationId.fromString("not-a-uuid");
    assert.ok(!result.ok, "Should reject invalid UUID");
  });

  it("returns error for empty string", () => {
    const result = NotificationId.fromString("");
    assert.ok(!result.ok, "Should reject empty string");
  });

  it("creates via fromStringUnsafe with valid UUID", () => {
    const uuid = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
    const id = NotificationId.fromStringUnsafe(uuid);
    assert.equal(id.value, uuid);
  });

  it("returns true for equals when IDs match", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const id1 = NotificationId.fromStringUnsafe(uuid);
    const id2 = NotificationId.fromStringUnsafe(uuid);
    assert.ok(id1.equals(id2), "Same UUID should be equal");
  });
});

// --- NotificationType ---

describe("NotificationType", () => {
  it("creates from valid type string APPROVAL_REQUESTED", () => {
    const result = NotificationType.create("APPROVAL_REQUESTED");
    assert.ok(result.ok, "Should accept valid type");
    if (result.ok) {
      assert.equal(result.value.value, "APPROVAL_REQUESTED");
    }
  });

  it("creates from lowercase type string", () => {
    const result = NotificationType.create("comment_added");
    assert.ok(result.ok, "Should accept lowercase input");
    if (result.ok) {
      assert.equal(result.value.value, "COMMENT_ADDED");
    }
  });

  it("returns error for invalid type string", () => {
    const result = NotificationType.create("INVALID_TYPE");
    assert.ok(!result.ok, "Should reject unknown type");
  });

  it("returns true for isApprovalRelated given APPROVAL_REQUESTED", () => {
    const result = NotificationType.create("APPROVAL_REQUESTED");
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.isApprovalRelated());
    }
  });

  it("returns true for isApprovalRelated given POST_APPROVED and POST_REJECTED", () => {
    for (const type of ["POST_APPROVED", "POST_REJECTED"]) {
      const result = NotificationType.create(type);
      assert.ok(result.ok, `Should accept ${type}`);
      if (result.ok) {
        assert.ok(result.value.isApprovalRelated(), `${type} should be approval-related`);
      }
    }
  });

  it("returns false for isApprovalRelated given COMMENT_ADDED", () => {
    const result = NotificationType.create("COMMENT_ADDED");
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(!result.value.isApprovalRelated(), "COMMENT_ADDED is not approval-related");
    }
  });

  it("returns true for isCommentRelated given COMMENT_ADDED and COMMENT_REPLY", () => {
    for (const type of ["COMMENT_ADDED", "COMMENT_REPLY"]) {
      const result = NotificationType.create(type);
      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.value.isCommentRelated(), `${type} should be comment-related`);
      }
    }
  });

  it("returns false for isCommentRelated given TEAM_INVITE", () => {
    const result = NotificationType.create("TEAM_INVITE");
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(!result.value.isCommentRelated(), "TEAM_INVITE is not comment-related");
    }
  });

  it("returns true for isTeamRelated given TEAM_INVITE", () => {
    const result = NotificationType.create("TEAM_INVITE");
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.isTeamRelated(), "TEAM_INVITE should be team-related");
    }
  });

  it("returns true for equals when types match", () => {
    const r1 = NotificationType.create("MENTION");
    const r2 = NotificationType.create("MENTION");
    assert.ok(r1.ok && r2.ok);
    if (r1.ok && r2.ok) {
      assert.ok(r1.value.equals(r2.value), "Same type should be equal");
    }
  });

  it("returns false for equals when types differ", () => {
    const r1 = NotificationType.create("MENTION");
    const r2 = NotificationType.create("TEAM_INVITE");
    assert.ok(r1.ok && r2.ok);
    if (r1.ok && r2.ok) {
      assert.ok(!r1.value.equals(r2.value), "Different types should not be equal");
    }
  });
});

// --- NotificationEntity ---

describe("NotificationEntity", () => {
  describe("create", () => {
    it("creates notification with valid params", () => {
      const result = NotificationEntity.create(makeNotificationParams());
      assert.ok(result.ok, "Should create successfully");
      if (result.ok) {
        const notification = result.value;
        assert.equal(notification.title, "Post needs approval");
        assert.equal(notification.body, "A new post has been submitted for your review.");
        assert.equal(notification.recipientId, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
        assert.equal(notification.type.value, "APPROVAL_REQUESTED");
        assert.equal(notification.isRead, false);
        assert.equal(notification.readAt, undefined);
        assert.ok(notification.id.value.length > 0);
      }
    });

    it("returns error for empty title", () => {
      const result = NotificationEntity.create(makeNotificationParams({ title: "" }));
      assert.ok(!result.ok, "Should reject empty title");
    });

    it("returns error for whitespace-only title", () => {
      const result = NotificationEntity.create(makeNotificationParams({ title: "   " }));
      assert.ok(!result.ok, "Should reject whitespace-only title");
    });

    it("returns error for empty body", () => {
      const result = NotificationEntity.create(makeNotificationParams({ body: "" }));
      assert.ok(!result.ok, "Should reject empty body");
    });

    it("returns error for empty recipientId", () => {
      const result = NotificationEntity.create(makeNotificationParams({ recipientId: "" }));
      assert.ok(!result.ok, "Should reject empty recipientId");
    });

    it("preserves optional props when provided", () => {
      const result = NotificationEntity.create(
        makeNotificationParams({
          resourceType: "post",
          resourceId: "post-456",
          actorId: "actor-789",
          actorName: "Jane Doe",
          metadata: { priority: "high" },
        })
      );
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.resourceType, "post");
        assert.equal(result.value.resourceId, "post-456");
        assert.equal(result.value.actorId, "actor-789");
        assert.equal(result.value.actorName, "Jane Doe");
        assert.deepEqual(result.value.metadata, { priority: "high" });
      }
    });

    it("omits optional props when not provided", () => {
      const result = NotificationEntity.create(makeNotificationParams());
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.resourceType, undefined);
        assert.equal(result.value.resourceId, undefined);
        assert.equal(result.value.actorId, undefined);
        assert.equal(result.value.actorName, undefined);
        assert.equal(result.value.metadata, undefined);
      }
    });
  });

  describe("reconstitute", () => {
    it("rebuilds entity from persisted props without validation", () => {
      const now = new Date();
      const typeResult = NotificationType.create("COMMENT_ADDED");
      assert.ok(typeResult.ok);
      if (!typeResult.ok) return;

      const notification = NotificationEntity.reconstitute({
        id: NotificationId.fromStringUnsafe("c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f"),
        recipientId: "recipient-001",
        type: typeResult.value,
        title: "Reconstituted",
        body: "From database",
        isRead: true,
        readAt: now,
        createdAt: now,
      });

      assert.equal(notification.title, "Reconstituted");
      assert.equal(notification.isRead, true);
      assert.equal(notification.readAt, now);
    });
  });

  describe("markAsRead", () => {
    it("sets isRead to true and records readAt timestamp", () => {
      const result = NotificationEntity.create(makeNotificationParams());
      assert.ok(result.ok);
      if (!result.ok) return;

      const notification = result.value;
      notification.markAsRead();

      assert.equal(notification.isRead, true);
      assert.ok(notification.readAt instanceof Date, "readAt should be a Date");
    });
  });

  describe("markAsUnread", () => {
    it("clears isRead and readAt after previously read", () => {
      const result = NotificationEntity.create(makeNotificationParams());
      assert.ok(result.ok);
      if (!result.ok) return;

      const notification = result.value;
      notification.markAsRead();
      assert.equal(notification.isRead, true);

      notification.markAsUnread();
      assert.equal(notification.isRead, false);
      assert.equal(notification.readAt, undefined);
    });
  });

  describe("isExpired", () => {
    it("returns true when notification is older than maxAgeDays", () => {
      const typeResult = NotificationType.create("MENTION");
      assert.ok(typeResult.ok);
      if (!typeResult.ok) return;

      const oldDate = new Date(Date.now() - 31 * 86_400_000); // 31 days ago
      const notification = NotificationEntity.reconstitute({
        id: NotificationId.generate(),
        recipientId: "recipient-001",
        type: typeResult.value,
        title: "Old notification",
        body: "This is old",
        isRead: false,
        createdAt: oldDate,
      });

      assert.ok(notification.isExpired(30), "31-day-old notification should be expired at 30 days");
    });

    it("returns false when notification is newer than maxAgeDays", () => {
      const typeResult = NotificationType.create("MENTION");
      assert.ok(typeResult.ok);
      if (!typeResult.ok) return;

      const recentDate = new Date(Date.now() - 5 * 86_400_000); // 5 days ago
      const notification = NotificationEntity.reconstitute({
        id: NotificationId.generate(),
        recipientId: "recipient-001",
        type: typeResult.value,
        title: "Recent notification",
        body: "This is recent",
        isRead: false,
        createdAt: recentDate,
      });

      assert.ok(
        !notification.isExpired(30),
        "5-day-old notification should not be expired at 30 days"
      );
    });
  });
});
