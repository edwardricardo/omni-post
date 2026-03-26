/**
 * @file aggregates.social-message.test.ts
 * @description Mutation-killing tests for SocialMessageAggregate.
 * Covers creation, status transitions, assignment, archival, events.
 * @layer test
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  SocialMessageAggregate,
  SocialMessageReceived,
  SocialMessageRead,
  SocialMessageReplied,
  SocialMessageAssigned,
  SocialMessageArchived,
} from "../../../src/domain/aggregates/SocialMessageAggregate.js";
import { AccountId, ProjectId, ChannelId } from "../../../src/domain/value-objects/EntityId.js";
import { SocialConversationId } from "../../../src/domain/value-objects/index.js";
import { SocialMessageType } from "../../../src/domain/value-objects/SocialMessageType.js";

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: AccountId.generate(),
    projectId: ProjectId.generate(),
    channelId: ChannelId.generate(),
    provider: "X" as const,
    providerMessageId: "ext-msg-123",
    messageType: SocialMessageType.comment(),
    authorName: "Jane Doe",
    authorProviderId: "provider-user-1",
    body: "Great post! Love this content.",
    providerCreatedAt: new Date(),
    ...overrides,
  };
}

describe("SocialMessageAggregate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe("create", () => {
    it("creates with UNREAD status", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      assert.equal(r.value.isUnread, true);
    });

    it("emits SocialMessageReceived event", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      const events = r.value.domainEvents;
      assert.equal(events.length, 1);
      assert.ok(events[0] instanceof SocialMessageReceived);
    });

    it("sets correct properties", () => {
      const input = makeInput({ authorName: "Alice", body: "Hello!" });
      const r = SocialMessageAggregate.create(input);
      assert.ok(r.ok);
      assert.equal(r.value.authorName, "Alice");
      assert.equal(r.value.body, "Hello!");
      assert.equal(r.value.provider, "X");
      assert.equal(r.value.isArchived, false);
      assert.equal(r.value.isAssigned, false);
      assert.equal(r.value.conversationId, null);
    });

    it("trims providerMessageId", () => {
      const r = SocialMessageAggregate.create(makeInput({ providerMessageId: "  ext-123  " }));
      assert.ok(r.ok);
      assert.equal(r.value.providerMessageId, "ext-123");
    });

    it("trims authorName", () => {
      const r = SocialMessageAggregate.create(makeInput({ authorName: "  Alice  " }));
      assert.ok(r.ok);
      assert.equal(r.value.authorName, "Alice");
    });

    it("rejects empty providerMessageId", () => {
      assert.ok(!SocialMessageAggregate.create(makeInput({ providerMessageId: "" })).ok);
    });

    it("rejects whitespace-only providerMessageId", () => {
      assert.ok(!SocialMessageAggregate.create(makeInput({ providerMessageId: "   " })).ok);
    });

    it("rejects empty authorName", () => {
      assert.ok(!SocialMessageAggregate.create(makeInput({ authorName: "" })).ok);
    });

    it("rejects empty authorProviderId", () => {
      assert.ok(!SocialMessageAggregate.create(makeInput({ authorProviderId: "" })).ok);
    });

    it("rejects empty body", () => {
      assert.ok(!SocialMessageAggregate.create(makeInput({ body: "" })).ok);
    });

    it("sets optional fields when provided", () => {
      const r = SocialMessageAggregate.create(
        makeInput({
          authorHandle: "@alice",
          authorAvatarUrl: "https://img.com/avatar.jpg",
          providerParentId: "parent-123",
          mediaUrls: ["https://img.com/1.jpg"],
          webhookEventId: "wh-evt-1",
          relatedPostId: "post-1",
        })
      );
      assert.ok(r.ok);
      assert.equal(r.value.authorHandle, "@alice");
      assert.equal(r.value.authorAvatarUrl, "https://img.com/avatar.jpg");
      assert.equal(r.value.providerParentId, "parent-123");
      assert.equal(r.value.mediaUrls.length, 1);
      assert.equal(r.value.webhookEventId, "wh-evt-1");
      assert.equal(r.value.relatedPostId, "post-1");
    });

    it("defaults optional fields to null when not provided", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      assert.equal(r.value.authorHandle, null);
      assert.equal(r.value.authorAvatarUrl, null);
      assert.equal(r.value.providerParentId, null);
      assert.equal(r.value.webhookEventId, null);
      assert.equal(r.value.relatedPostId, null);
    });
  });

  // =========================================================================
  // markAsRead
  // =========================================================================

  describe("markAsRead", () => {
    it("transitions UNREAD to READ", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.domainEvents; // clear creation event

      const readResult = r.value.markAsRead();
      assert.ok(readResult.ok);
      assert.equal(r.value.isRead, true);
      assert.equal(r.value.isUnread, false);
    });

    it("emits SocialMessageRead event", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);

      r.value.markAsRead();
      const events = r.value.domainEvents;
      // Events include SocialMessageReceived (from create) + SocialMessageRead
      assert.ok(events.length >= 2);
      assert.ok(events.some((e) => e instanceof SocialMessageRead));
    });

    it("rejects transition from REPLIED", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.markAsRead();
      r.value.markAsReplied();

      const readAgain = r.value.markAsRead();
      assert.ok(!readAgain.ok);
    });
  });

  // =========================================================================
  // markAsReplied
  // =========================================================================

  describe("markAsReplied", () => {
    it("transitions READ to REPLIED", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.markAsRead();

      const repliedResult = r.value.markAsReplied();
      assert.ok(repliedResult.ok);
      assert.equal(r.value.isReplied, true);
    });

    it("emits SocialMessageReplied event", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.markAsRead();
      r.value.domainEvents;

      r.value.markAsReplied();
      const events = r.value.domainEvents;
      assert.ok(events.some((e) => e instanceof SocialMessageReplied));
    });

    it("rejects transition from UNREAD", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);

      const repliedResult = r.value.markAsReplied();
      assert.ok(!repliedResult.ok);
    });
  });

  // =========================================================================
  // archive
  // =========================================================================

  describe("archive", () => {
    it("archives from UNREAD", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);

      const archiveResult = r.value.archive();
      assert.ok(archiveResult.ok);
      assert.equal(r.value.isArchived, true);
    });

    it("archives from READ", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.markAsRead();

      assert.ok(r.value.archive().ok);
      assert.equal(r.value.isArchived, true);
    });

    it("archives from REPLIED", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.markAsRead();
      r.value.markAsReplied();

      assert.ok(r.value.archive().ok);
    });

    it("emits SocialMessageArchived event", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.domainEvents;

      r.value.archive();
      const events = r.value.domainEvents;
      assert.ok(events.some((e) => e instanceof SocialMessageArchived));
    });

    it("rejects double archive", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.archive();

      const secondArchive = r.value.archive();
      assert.ok(!secondArchive.ok);
    });
  });

  // =========================================================================
  // assign / unassign
  // =========================================================================

  describe("assign", () => {
    it("assigns to team member", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);

      const assignResult = r.value.assign("member-1");
      assert.ok(assignResult.ok);
      assert.equal(r.value.assigneeId, "member-1");
      assert.equal(r.value.isAssigned, true);
    });

    it("emits SocialMessageAssigned event", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.domainEvents;

      r.value.assign("member-1");
      const events = r.value.domainEvents;
      assert.ok(events.some((e) => e instanceof SocialMessageAssigned));
    });

    it("trims assignee ID", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.assign("  member-2  ");
      assert.equal(r.value.assigneeId, "member-2");
    });

    it("rejects empty assignee ID", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      assert.ok(!r.value.assign("").ok);
    });

    it("rejects whitespace-only assignee ID", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      assert.ok(!r.value.assign("   ").ok);
    });
  });

  describe("unassign", () => {
    it("clears assignment", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      r.value.assign("member-1");

      const unassignResult = r.value.unassign();
      assert.ok(unassignResult.ok);
      assert.equal(r.value.assigneeId, null);
      assert.equal(r.value.isAssigned, false);
    });
  });

  // =========================================================================
  // setConversationId
  // =========================================================================

  describe("setConversationId", () => {
    it("links to conversation", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      const convId = SocialConversationId.generate();

      const result = r.value.setConversationId(convId);
      assert.ok(result.ok);
      assert.equal(r.value.conversationId, convId);
    });
  });

  // =========================================================================
  // toJSON
  // =========================================================================

  describe("toJSON", () => {
    it("serializes aggregate state", () => {
      const r = SocialMessageAggregate.create(makeInput({ authorName: "Bob" }));
      assert.ok(r.ok);
      const json = r.value.toJSON();
      assert.equal(json.authorName, "Bob");
      assert.equal(json.status, "UNREAD");
      assert.equal(json.isArchived, false);
      assert.ok(json.id);
      assert.ok(json.createdAt);
    });

    it("omits null optional fields", () => {
      const r = SocialMessageAggregate.create(makeInput());
      assert.ok(r.ok);
      const json = r.value.toJSON();
      assert.equal(Object.prototype.hasOwnProperty.call(json, "conversationId"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(json, "assigneeId"), false);
    });

    it("includes optional fields when set", () => {
      const r = SocialMessageAggregate.create(makeInput({ authorHandle: "@test" }));
      assert.ok(r.ok);
      const json = r.value.toJSON();
      assert.equal(json.authorHandle, "@test");
    });
  });
});
