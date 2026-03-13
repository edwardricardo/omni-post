/**
 * @file notification.test.ts
 * @description Unit tests for NotificationId, NotificationType, and NotificationEntity domain objects.
 * @layer domain
 */

import { describe, it, expect } from "vitest";
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
    expect(id1.value.length > 0).toBeTruthy();
    expect(id1.value).not.toBe(id2.value);
  });

  it("creates from valid UUID string", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const result = NotificationId.fromString(uuid);
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.value).toBe(uuid);
    }
  });

  it("returns error for invalid UUID string", () => {
    const result = NotificationId.fromString("not-a-uuid");
    expect(result.ok).toBeFalsy();
  });

  it("returns error for empty string", () => {
    const result = NotificationId.fromString("");
    expect(result.ok).toBeFalsy();
  });

  it("creates via fromStringUnsafe with valid UUID", () => {
    const uuid = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
    const id = NotificationId.fromStringUnsafe(uuid);
    expect(id.value).toBe(uuid);
  });

  it("returns true for equals when IDs match", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const id1 = NotificationId.fromStringUnsafe(uuid);
    const id2 = NotificationId.fromStringUnsafe(uuid);
    expect(id1.equals(id2)).toBeTruthy();
  });
});

// --- NotificationType ---

describe("NotificationType", () => {
  it("creates from valid type string APPROVAL_REQUESTED", () => {
    const result = NotificationType.create("APPROVAL_REQUESTED");
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.value).toBe("APPROVAL_REQUESTED");
    }
  });

  it("creates from lowercase type string", () => {
    const result = NotificationType.create("comment_added");
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.value).toBe("COMMENT_ADDED");
    }
  });

  it("returns error for invalid type string", () => {
    const result = NotificationType.create("INVALID_TYPE");
    expect(result.ok).toBeFalsy();
  });

  it("returns true for isApprovalRelated given APPROVAL_REQUESTED", () => {
    const result = NotificationType.create("APPROVAL_REQUESTED");
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isApprovalRelated()).toBeTruthy();
    }
  });

  it("returns true for isApprovalRelated given POST_APPROVED and POST_REJECTED", () => {
    for (const type of ["POST_APPROVED", "POST_REJECTED"]) {
      const result = NotificationType.create(type);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.isApprovalRelated()).toBeTruthy();
      }
    }
  });

  it("returns false for isApprovalRelated given COMMENT_ADDED", () => {
    const result = NotificationType.create("COMMENT_ADDED");
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isApprovalRelated()).toBeFalsy();
    }
  });

  it("returns true for isCommentRelated given COMMENT_ADDED and COMMENT_REPLY", () => {
    for (const type of ["COMMENT_ADDED", "COMMENT_REPLY"]) {
      const result = NotificationType.create(type);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.isCommentRelated()).toBeTruthy();
      }
    }
  });

  it("returns false for isCommentRelated given TEAM_INVITE", () => {
    const result = NotificationType.create("TEAM_INVITE");
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isCommentRelated()).toBeFalsy();
    }
  });

  it("returns true for isTeamRelated given TEAM_INVITE", () => {
    const result = NotificationType.create("TEAM_INVITE");
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isTeamRelated()).toBeTruthy();
    }
  });

  it("returns true for equals when types match", () => {
    const r1 = NotificationType.create("MENTION");
    const r2 = NotificationType.create("MENTION");
    expect(r1.ok && r2.ok).toBeTruthy();
    if (r1.ok && r2.ok) {
      expect(r1.value.equals(r2.value)).toBeTruthy();
    }
  });

  it("returns false for equals when types differ", () => {
    const r1 = NotificationType.create("MENTION");
    const r2 = NotificationType.create("TEAM_INVITE");
    expect(r1.ok && r2.ok).toBeTruthy();
    if (r1.ok && r2.ok) {
      expect(r1.value.equals(r2.value)).toBeFalsy();
    }
  });
});

// --- NotificationEntity ---

describe("NotificationEntity", () => {
  describe("create", () => {
    it("creates notification with valid params", () => {
      const result = NotificationEntity.create(makeNotificationParams());
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const notification = result.value;
        expect(notification.title).toBe("Post needs approval");
        expect(notification.body).toBe("A new post has been submitted for your review.");
        expect(notification.recipientId).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
        expect(notification.type.value).toBe("APPROVAL_REQUESTED");
        expect(notification.isRead).toBe(false);
        expect(notification.readAt).toBe(undefined);
        expect(notification.id.value.length > 0).toBeTruthy();
      }
    });

    it("returns error for empty title", () => {
      const result = NotificationEntity.create(makeNotificationParams({ title: "" }));
      expect(result.ok).toBeFalsy();
    });

    it("returns error for whitespace-only title", () => {
      const result = NotificationEntity.create(makeNotificationParams({ title: "   " }));
      expect(result.ok).toBeFalsy();
    });

    it("returns error for empty body", () => {
      const result = NotificationEntity.create(makeNotificationParams({ body: "" }));
      expect(result.ok).toBeFalsy();
    });

    it("returns error for empty recipientId", () => {
      const result = NotificationEntity.create(makeNotificationParams({ recipientId: "" }));
      expect(result.ok).toBeFalsy();
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
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.resourceType).toBe("post");
        expect(result.value.resourceId).toBe("post-456");
        expect(result.value.actorId).toBe("actor-789");
        expect(result.value.actorName).toBe("Jane Doe");
        expect(result.value.metadata).toEqual({ priority: "high" });
      }
    });

    it("omits optional props when not provided", () => {
      const result = NotificationEntity.create(makeNotificationParams());
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.resourceType).toBe(undefined);
        expect(result.value.resourceId).toBe(undefined);
        expect(result.value.actorId).toBe(undefined);
        expect(result.value.actorName).toBe(undefined);
        expect(result.value.metadata).toBe(undefined);
      }
    });
  });

  describe("reconstitute", () => {
    it("rebuilds entity from persisted props without validation", () => {
      const now = new Date();
      const typeResult = NotificationType.create("COMMENT_ADDED");
      expect(typeResult.ok).toBeTruthy();
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

      expect(notification.title).toBe("Reconstituted");
      expect(notification.isRead).toBe(true);
      expect(notification.readAt).toBe(now);
    });
  });

  describe("markAsRead", () => {
    it("sets isRead to true and records readAt timestamp", () => {
      const result = NotificationEntity.create(makeNotificationParams());
      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      const notification = result.value;
      notification.markAsRead();

      expect(notification.isRead).toBe(true);
      expect(notification.readAt instanceof Date).toBeTruthy();
    });
  });

  describe("markAsUnread", () => {
    it("clears isRead and readAt after previously read", () => {
      const result = NotificationEntity.create(makeNotificationParams());
      expect(result.ok).toBeTruthy();
      if (!result.ok) return;

      const notification = result.value;
      notification.markAsRead();
      expect(notification.isRead).toBe(true);

      notification.markAsUnread();
      expect(notification.isRead).toBe(false);
      expect(notification.readAt).toBe(undefined);
    });
  });

  describe("isExpired", () => {
    it("returns true when notification is older than maxAgeDays", () => {
      const typeResult = NotificationType.create("MENTION");
      expect(typeResult.ok).toBeTruthy();
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

      expect(notification.isExpired(30)).toBeTruthy();
    });

    it("returns false when notification is newer than maxAgeDays", () => {
      const typeResult = NotificationType.create("MENTION");
      expect(typeResult.ok).toBeTruthy();
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

      expect(notification.isExpired(30)).toBeFalsy();
    });
  });
});
