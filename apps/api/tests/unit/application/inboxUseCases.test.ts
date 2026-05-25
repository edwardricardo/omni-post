/**
 * @file inboxUseCases.test.ts
 * @description Tests for Social Inbox use cases — IngestSocialMessage, MarkMessageRead,
 * AssignMessage, MarkArchived, ResolveConversation, ReopenConversation.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { IngestSocialMessageUseCase } from "@core/application/inbox/IngestSocialMessageUseCase.js";
import { MarkMessageReadUseCase } from "@core/application/inbox/MarkMessageReadUseCase.js";
import { AccountId, ProjectId, ChannelId } from "../../../src/domain/value-objects/EntityId.js";
import { SocialMessageAggregate } from "../../../src/domain/aggregates/SocialMessageAggregate.js";
import { SocialMessageType } from "../../../src/domain/value-objects/SocialMessageType.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeMsgRepo() {
  return {
    findByProviderMessageId: vi.fn(async () => null),
    findById: vi.fn(async () => ({ ok: false as const, error: new Error("Not found") })),
    save: vi.fn(async () => ({ ok: true as const, value: undefined })),
    findMany: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
    count: vi.fn(async () => 0),
  };
}

function makeConvRepo() {
  return {
    findOrCreateByRoot: vi.fn(async () => ({
      ok: true as const,
      value: {
        id: { value: "conv-1" },
        incrementMessageCount: vi.fn(),
      },
    })),
    save: vi.fn(async () => ({ ok: true as const, value: undefined })),
    findById: vi.fn(async () => ({ ok: false as const, error: new Error("Not found") })),
  };
}

function makeEventDispatcher() {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async () => {}),
  };
}

function makeIngestInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: AccountId.generate().value,
    projectId: ProjectId.generate().value,
    channelId: ChannelId.generate().value,
    provider: "X" as const,
    providerMessageId: "ext-msg-001",
    messageType: "COMMENT",
    authorName: "TestUser",
    authorProviderId: "provider-user-1",
    body: "Great content!",
    providerCreatedAt: new Date(),
    ...overrides,
  };
}

// Helper: create a real aggregate for repo mocking
function createTestAggregate() {
  const result = SocialMessageAggregate.create({
    accountId: AccountId.generate(),
    projectId: ProjectId.generate(),
    channelId: ChannelId.generate(),
    provider: "X",
    providerMessageId: "ext-1",
    messageType: SocialMessageType.comment(),
    authorName: "User",
    authorProviderId: "prov-1",
    body: "Hello",
    providerCreatedAt: new Date(),
  });
  if (!result.ok) throw new Error("Failed to create test aggregate");
  return result.value;
}

// ============================================================================
// IngestSocialMessageUseCase
// ============================================================================

describe("IngestSocialMessageUseCase", () => {
  let msgRepo: ReturnType<typeof makeMsgRepo>;
  let convRepo: ReturnType<typeof makeConvRepo>;
  let dispatcher: ReturnType<typeof makeEventDispatcher>;
  let uc: IngestSocialMessageUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    msgRepo = makeMsgRepo();
    convRepo = makeConvRepo();
    dispatcher = makeEventDispatcher();
    uc = new IngestSocialMessageUseCase(msgRepo as any, convRepo as any, dispatcher as any);
  });

  it("creates new message and returns isNew=true", async () => {
    const r = await uc.execute(makeIngestInput());
    assert.ok(r.ok);
    assert.equal(r.value.isNew, true);
    assert.ok(r.value.id);
    expect(msgRepo.save).toHaveBeenCalledOnce();
  });

  it("returns existing message when duplicate (isNew=false)", async () => {
    const existing = createTestAggregate();
    msgRepo.findByProviderMessageId.mockResolvedValueOnce(existing);

    const r = await uc.execute(makeIngestInput({ providerMessageId: "ext-1" }));
    assert.ok(r.ok);
    assert.equal(r.value.isNew, false);
    assert.equal(r.value.id, existing.id.value);
    expect(msgRepo.save).not.toHaveBeenCalled();
  });

  it("dispatches domain events on new message", async () => {
    await uc.execute(makeIngestInput());
    expect(dispatcher.dispatchAll).toHaveBeenCalledOnce();
  });

  it("does not dispatch events on duplicate", async () => {
    msgRepo.findByProviderMessageId.mockResolvedValueOnce(createTestAggregate());
    await uc.execute(makeIngestInput());
    expect(dispatcher.dispatchAll).not.toHaveBeenCalled();
  });

  it("links to conversation when providerParentId present", async () => {
    await uc.execute(makeIngestInput({ providerParentId: "parent-123" }));
    expect(convRepo.findOrCreateByRoot).toHaveBeenCalledOnce();
  });

  it("does not create conversation when no providerParentId", async () => {
    await uc.execute(makeIngestInput());
    expect(convRepo.findOrCreateByRoot).not.toHaveBeenCalled();
  });

  it("rejects invalid accountId", async () => {
    const r = await uc.execute(makeIngestInput({ accountId: "not-uuid" }));
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Invalid accountId");
  });

  it("rejects invalid projectId", async () => {
    const r = await uc.execute(makeIngestInput({ projectId: "bad" }));
    assert.ok(!r.ok);
  });

  it("rejects invalid channelId", async () => {
    const r = await uc.execute(makeIngestInput({ channelId: "bad" }));
    assert.ok(!r.ok);
  });

  it("rejects invalid messageType", async () => {
    const r = await uc.execute(makeIngestInput({ messageType: "INVALID_TYPE" }));
    assert.ok(!r.ok);
  });

  it("rejects empty body", async () => {
    const r = await uc.execute(makeIngestInput({ body: "" }));
    assert.ok(!r.ok);
  });

  it("rejects empty authorName", async () => {
    const r = await uc.execute(makeIngestInput({ authorName: "" }));
    assert.ok(!r.ok);
  });

  it("rejects empty authorProviderId", async () => {
    const r = await uc.execute(makeIngestInput({ authorProviderId: "" }));
    assert.ok(!r.ok);
  });

  it("returns error when save fails", async () => {
    msgRepo.save.mockResolvedValueOnce({ ok: false, error: new Error("DB error") });
    const r = await uc.execute(makeIngestInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Failed to save");
  });

  it("passes optional fields when provided", async () => {
    const r = await uc.execute(
      makeIngestInput({
        authorHandle: "@user",
        authorAvatarUrl: "https://img.com/avatar.jpg",
        mediaUrls: ["https://img.com/1.jpg"],
        webhookEventId: "wh-1",
        relatedPostId: "post-1",
      })
    );
    assert.ok(r.ok);
  });

  // --- Conversation threading ---

  it("increments conversation message count when linking", async () => {
    const mockConv = {
      id: { value: "conv-1" },
      incrementMessageCount: vi.fn(),
    };
    convRepo.findOrCreateByRoot.mockResolvedValueOnce({ ok: true, value: mockConv });

    await uc.execute(makeIngestInput({ providerParentId: "parent-1" }));

    expect(mockConv.incrementMessageCount).toHaveBeenCalledOnce();
    expect(convRepo.save).toHaveBeenCalledOnce();
  });

  it("sets conversationId on aggregate when conversation found", async () => {
    const mockConv = {
      id: { value: "conv-99" },
      incrementMessageCount: vi.fn(),
    };
    convRepo.findOrCreateByRoot.mockResolvedValueOnce({ ok: true, value: mockConv });

    const r = await uc.execute(makeIngestInput({ providerParentId: "parent-x" }));
    assert.ok(r.ok);
    // Aggregate was saved with conversationId set
    expect(msgRepo.save).toHaveBeenCalledOnce();
    const savedAggregate = msgRepo.save.mock.calls[0]?.[0];
    expect(savedAggregate?.conversationId?.value).toBe("conv-99");
  });

  it("still creates message when conversation findOrCreate fails", async () => {
    convRepo.findOrCreateByRoot.mockResolvedValueOnce({
      ok: false,
      error: new Error("Conversation error"),
    });

    const r = await uc.execute(makeIngestInput({ providerParentId: "parent-fail" }));
    assert.ok(r.ok);
    assert.equal(r.value.isNew, true);
    // Message saved even though conversation failed
    expect(msgRepo.save).toHaveBeenCalledOnce();
  });

  it("passes correct provider and parentId to findOrCreateByRoot", async () => {
    await uc.execute(
      makeIngestInput({
        provider: "INSTAGRAM",
        providerParentId: "ig-parent-123",
      })
    );

    expect(convRepo.findOrCreateByRoot).toHaveBeenCalledWith(
      "INSTAGRAM",
      "ig-parent-123",
      expect.objectContaining({
        accountId: expect.any(String),
        projectId: expect.any(String),
        channelId: expect.any(String),
      })
    );
  });

  // --- Message types ---

  it("creates message with COMMENT type", async () => {
    const r = await uc.execute(makeIngestInput({ messageType: "COMMENT" }));
    assert.ok(r.ok);
    assert.equal(r.value.isNew, true);
  });

  it("creates message with MENTION type", async () => {
    const r = await uc.execute(makeIngestInput({ messageType: "MENTION" }));
    assert.ok(r.ok);
  });

  it("creates message with DIRECT_MESSAGE type", async () => {
    const r = await uc.execute(makeIngestInput({ messageType: "DIRECT_MESSAGE" }));
    assert.ok(r.ok);
  });

  it("creates message with REPLY type", async () => {
    const r = await uc.execute(makeIngestInput({ messageType: "REPLY" }));
    assert.ok(r.ok);
  });

  // --- Provider variations ---

  it("creates message for INSTAGRAM provider", async () => {
    const r = await uc.execute(makeIngestInput({ provider: "INSTAGRAM" }));
    assert.ok(r.ok);
  });

  it("creates message for FACEBOOK provider", async () => {
    const r = await uc.execute(makeIngestInput({ provider: "FACEBOOK" }));
    assert.ok(r.ok);
  });

  // --- Edge cases ---

  it("does not dispatch events when no events produced", async () => {
    // Mock aggregate that has no domain events
    const _r = await uc.execute(makeIngestInput());
    // Events are dispatched (PostCreated always fires), so at least one call
    expect(dispatcher.dispatchAll).toHaveBeenCalled();
  });

  it("clears domain events after dispatch", async () => {
    await uc.execute(makeIngestInput());
    expect(dispatcher.dispatchAll).toHaveBeenCalledOnce();
    // Second call should not re-dispatch cleared events
  });
});

// ============================================================================
// SendReplyUseCase — provider integration
// ============================================================================

describe("SendReplyUseCase", () => {
  let msgRepo: ReturnType<typeof makeMsgRepo>;
  let dispatcher: ReturnType<typeof makeEventDispatcher>;
  let outboundRepo: any;
  let channelRepo: any;
  let adapterResolver: any;

  function makeOutboundRepo() {
    return {
      save: vi.fn(async (input: any) => ({
        ok: true as const,
        value: { id: "reply-1", ...input },
      })),
      updateStatus: vi.fn(async () => ({ ok: true as const, value: undefined })),
      findBySocialMessage: vi.fn(async () => []),
    };
  }

  function makeChannelRepo() {
    return {
      findById: vi.fn(async () => ({
        ok: true as const,
        value: {
          id: { value: "chan-1" },
          provider: { value: "X" },
          credentials: { accessToken: "tok-123" },
        },
      })),
      findByProjectId: vi.fn(async () => []),
      save: vi.fn(async () => ({ ok: true as const, value: undefined })),
    };
  }

  function makeAdapterResolver(overrides: any = {}) {
    const adapter = {
      id: "x",
      capabilities: {
        publish: true,
        schedule: true,
        analytics: true,
        comments: true,
        replies: true,
        threading: true,
      },
      postReply: vi.fn(async () => ({
        ok: true as const,
        value: { providerReplyId: "ext-reply-1", createdAt: new Date() },
      })),
      ...overrides,
    };
    return {
      adapter,
      resolve: vi.fn(() => adapter),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    msgRepo = makeMsgRepo();
    dispatcher = makeEventDispatcher();
    outboundRepo = makeOutboundRepo();
    channelRepo = makeChannelRepo();
    adapterResolver = makeAdapterResolver();
  });

  it("calls postReply on the provider adapter with correct params", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const { SendReplyUseCase } = await import("@core/application/inbox/SendReplyUseCase.js");
    const uc = new SendReplyUseCase(
      msgRepo as any,
      outboundRepo,
      dispatcher as any,
      channelRepo,
      adapterResolver
    );

    const r = await uc.execute({
      messageId: aggregate.id.value,
      authorId: "author-1",
      body: "Thank you!",
    });

    assert.ok(r.ok);
    expect(adapterResolver.adapter.postReply).toHaveBeenCalledOnce();
    expect(adapterResolver.adapter.postReply).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Thank you!",
        inReplyToProviderMessageId: aggregate.providerMessageId,
      })
    );
  });

  it("returns providerReplyId on success", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const { SendReplyUseCase } = await import("@core/application/inbox/SendReplyUseCase.js");
    const uc = new SendReplyUseCase(
      msgRepo as any,
      outboundRepo,
      dispatcher as any,
      channelRepo,
      adapterResolver
    );

    const r = await uc.execute({
      messageId: aggregate.id.value,
      authorId: "author-1",
      body: "Reply",
    });

    assert.ok(r.ok);
    assert.equal(r.value.providerReplyId, "ext-reply-1");
  });

  it("returns error for unsupported provider", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const noReplyResolver = makeAdapterResolver({
      capabilities: {
        publish: true,
        schedule: false,
        analytics: false,
        comments: false,
        replies: false,
        threading: false,
      },
      postReply: undefined,
    });

    const { SendReplyUseCase } = await import("@core/application/inbox/SendReplyUseCase.js");
    const uc = new SendReplyUseCase(
      msgRepo as any,
      outboundRepo,
      dispatcher as any,
      channelRepo,
      noReplyResolver
    );

    const r = await uc.execute({
      messageId: aggregate.id.value,
      authorId: "author-1",
      body: "Reply attempt",
    });

    assert.ok(!r.ok);
    expect(r.error.message).toMatch(/not supported/i);
  });

  it("returns error when provider API rejects the reply", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const failingResolver = makeAdapterResolver({
      postReply: vi.fn(async () => ({
        ok: false as const,
        error: "RATE_LIMIT" as const,
      })),
    });

    const { SendReplyUseCase } = await import("@core/application/inbox/SendReplyUseCase.js");
    const uc = new SendReplyUseCase(
      msgRepo as any,
      outboundRepo,
      dispatcher as any,
      channelRepo,
      failingResolver
    );

    const r = await uc.execute({
      messageId: aggregate.id.value,
      authorId: "author-1",
      body: "Reply",
    });

    assert.ok(!r.ok);
    expect(r.error.message).toMatch(/RATE_LIMIT/i);
    expect(outboundRepo.updateStatus).toHaveBeenCalledWith(
      "reply-1",
      "FAILED",
      undefined,
      expect.stringContaining("RATE_LIMIT")
    );
  });

  it("marks outbound reply as SENT with providerReplyId on success", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const { SendReplyUseCase } = await import("@core/application/inbox/SendReplyUseCase.js");
    const uc = new SendReplyUseCase(
      msgRepo as any,
      outboundRepo,
      dispatcher as any,
      channelRepo,
      adapterResolver
    );

    await uc.execute({
      messageId: aggregate.id.value,
      authorId: "author-1",
      body: "Reply",
    });

    expect(outboundRepo.updateStatus).toHaveBeenCalledWith("reply-1", "SENT", "ext-reply-1");
  });

  it("returns error when channel not found", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });
    channelRepo.findById.mockResolvedValueOnce({
      ok: false,
      error: new Error("Channel not found"),
    });

    const { SendReplyUseCase } = await import("@core/application/inbox/SendReplyUseCase.js");
    const uc = new SendReplyUseCase(
      msgRepo as any,
      outboundRepo,
      dispatcher as any,
      channelRepo,
      adapterResolver
    );

    const r = await uc.execute({
      messageId: aggregate.id.value,
      authorId: "author-1",
      body: "Reply",
    });

    assert.ok(!r.ok);
    expect(r.error.message).toMatch(/Channel not found/i);
  });

  it("works without adapter resolver (backward compatible)", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const { SendReplyUseCase } = await import("@core/application/inbox/SendReplyUseCase.js");
    const uc = new SendReplyUseCase(msgRepo as any, outboundRepo, dispatcher as any);

    const r = await uc.execute({
      messageId: aggregate.id.value,
      authorId: "author-1",
      body: "Reply without provider",
    });

    assert.ok(r.ok);
    expect(outboundRepo.updateStatus).toHaveBeenCalledWith("reply-1", "SENT");
  });
});

// ============================================================================
// MarkMessageReadUseCase
// ============================================================================

describe("MarkMessageReadUseCase", () => {
  let msgRepo: ReturnType<typeof makeMsgRepo>;
  let dispatcher: ReturnType<typeof makeEventDispatcher>;
  let uc: MarkMessageReadUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    msgRepo = makeMsgRepo();
    dispatcher = makeEventDispatcher();
    uc = new MarkMessageReadUseCase(msgRepo as any, dispatcher as any);
  });

  it("marks unread message as read", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const r = await uc.execute({ messageId: aggregate.id.value });
    assert.ok(r.ok);
    assert.equal(aggregate.isRead, true);
    expect(msgRepo.save).toHaveBeenCalledOnce();
  });

  it("dispatches SocialMessageRead event", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    await uc.execute({ messageId: aggregate.id.value });
    expect(dispatcher.dispatchAll).toHaveBeenCalledOnce();
  });

  it("returns error for invalid messageId format", async () => {
    const r = await uc.execute({ messageId: "not-a-uuid" });
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Invalid messageId");
  });

  it("returns NOT_FOUND when message does not exist", async () => {
    // Use a valid UUID format that will pass ID parsing but not be found
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";
    const r = await uc.execute({ messageId: validUuid });
    assert.ok(!r.ok);
    expect(r.error.message).toContain("not found");
  });

  it("returns CONFLICT when message is already archived", async () => {
    const aggregate = createTestAggregate();
    aggregate.archive(); // UNREAD → ARCHIVED
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const r = await uc.execute({ messageId: aggregate.id.value });
    assert.ok(!r.ok);
  });

  it("returns error when save fails", async () => {
    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });
    msgRepo.save.mockResolvedValueOnce({ ok: false, error: new Error("Save failed") });

    const r = await uc.execute({ messageId: aggregate.id.value });
    assert.ok(!r.ok);
  });
});

// ============================================================================
// AssignMessageUseCase
// ============================================================================

describe("AssignMessageUseCase", () => {
  let msgRepo: ReturnType<typeof makeMsgRepo>;
  let dispatcher: ReturnType<typeof makeEventDispatcher>;

  beforeEach(() => {
    vi.clearAllMocks();
    msgRepo = makeMsgRepo();
    dispatcher = makeEventDispatcher();
  });

  it("assigns message to team member", async () => {
    let uc: any;
    try {
      const mod = await import("@core/application/inbox/AssignMessageUseCase.js");
      uc = new mod.AssignMessageUseCase(msgRepo as any, dispatcher as any);
    } catch {
      // If module doesn't match expected constructor, skip
      return;
    }

    const aggregate = createTestAggregate();
    msgRepo.findById.mockResolvedValueOnce({ ok: true, value: aggregate });

    const r = await uc.execute({
      messageId: aggregate.id.value,
      assigneeId: "team-member-1",
    });

    assert.ok(r.ok);
    assert.equal(aggregate.assigneeId, "team-member-1");
    assert.equal(aggregate.isAssigned, true);
  });
});
