/**
 * @file syncProviderComments.test.ts
 * @description Unit tests for SyncProviderCommentsUseCase with adapter wired.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { SyncProviderCommentsUseCase } from "../../../src/application/inbox/SyncProviderCommentsUseCase.js";
import { ok, err } from "@shared/types";

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: { value: "a0000000-0000-4000-a000-000000000001" },
    provider: { toString: () => "INSTAGRAM" },
    handle: "@test",
    credentials: { accessToken: "tok-123" },
    projectId: { value: "proj-001" },
    status: "CONNECTED",
    ...overrides,
  };
}

function makeMockChannelRepo(channel = makeChannel()) {
  return {
    findById: vi.fn().mockResolvedValue(ok(channel)),
    findByProjectId: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    hardDelete: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeMockIngestUseCase() {
  return {
    execute: vi.fn().mockResolvedValue(ok({ id: "msg-001", isNew: true })),
  };
}

function makeMockAdapter(
  comments = [
    {
      providerMessageId: "pm-1",
      authorName: "User1",
      authorProviderId: "ap-1",
      body: "Hello",
      createdAt: new Date(),
    },
    {
      providerMessageId: "pm-2",
      authorName: "User2",
      authorProviderId: "ap-2",
      body: "World",
      createdAt: new Date(),
    },
  ]
) {
  return {
    id: "instagram",
    limits: { maxTextLength: 2200 },
    capabilities: {
      publish: true,
      schedule: true,
      analytics: true,
      comments: true,
      replies: true,
      threading: false,
    },
    validateCredentials: vi.fn(),
    render: vi.fn(),
    publish: vi.fn(),
    getComments: vi.fn().mockResolvedValue(ok({ comments, nextCursor: undefined })),
  };
}

describe("SyncProviderCommentsUseCase — with adapter wired", () => {
  let channelRepo: ReturnType<typeof makeMockChannelRepo>;
  let ingestUseCase: ReturnType<typeof makeMockIngestUseCase>;
  let adapter: ReturnType<typeof makeMockAdapter>;
  let useCase: SyncProviderCommentsUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    channelRepo = makeMockChannelRepo();
    ingestUseCase = makeMockIngestUseCase();
    adapter = makeMockAdapter();
    useCase = new SyncProviderCommentsUseCase(
      channelRepo as never,
      ingestUseCase as never,
      undefined,
      (provider: string) => (provider === "instagram" ? (adapter as never) : undefined)
    );
  });

  it("fetches comments from provider adapter", async () => {
    const result = await useCase.execute({ channelId: "a0000000-0000-4000-a000-000000000001" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.synced, 2);
    assert.strictEqual(result.value.skipped, 0);
    expect(adapter.getComments).toHaveBeenCalledOnce();
    expect(ingestUseCase.execute).toHaveBeenCalledTimes(2);
  });

  it("deduplicates — counts skipped when message already exists", async () => {
    ingestUseCase.execute
      .mockResolvedValueOnce(ok({ id: "msg-1", isNew: true }))
      .mockResolvedValueOnce(ok({ id: "msg-2", isNew: false }));

    const result = await useCase.execute({ channelId: "a0000000-0000-4000-a000-000000000001" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.synced, 1);
    assert.strictEqual(result.value.skipped, 1);
  });

  it("handles provider 401 gracefully", async () => {
    adapter.getComments.mockResolvedValue(err("AUTH"));

    const result = await useCase.execute({ channelId: "a0000000-0000-4000-a000-000000000001" });

    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("Auth error"));
  });

  it("handles provider NETWORK error", async () => {
    adapter.getComments.mockResolvedValue(err("NETWORK"));

    const result = await useCase.execute({ channelId: "a0000000-0000-4000-a000-000000000001" });

    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("Network error"));
  });

  it("returns NOT_FOUND when channel does not exist", async () => {
    channelRepo.findById.mockResolvedValue(
      err({ name: "EntityNotFoundError", message: "Not found" })
    );

    const result = await useCase.execute({ channelId: "a0000000-0000-4000-a000-000000000099" });

    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("Channel not found"));
  });

  it("returns 0 synced when provider does not support comments", async () => {
    const useCaseNoComments = new SyncProviderCommentsUseCase(
      channelRepo as never,
      ingestUseCase as never,
      undefined,
      () => ({ id: "telegram", getComments: undefined }) as never
    );

    const result = await useCaseNoComments.execute({
      channelId: "a0000000-0000-4000-a000-000000000001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.synced, 0);
    assert.strictEqual(result.value.skipped, 0);
  });

  it("paginates through cursor-based results", async () => {
    const page1Comments = [
      {
        providerMessageId: "pm-1",
        authorName: "User1",
        authorProviderId: "ap-1",
        body: "Hi",
        createdAt: new Date(),
      },
    ];
    const page2Comments = [
      {
        providerMessageId: "pm-2",
        authorName: "User2",
        authorProviderId: "ap-2",
        body: "Bye",
        createdAt: new Date(),
      },
    ];

    adapter.getComments
      .mockResolvedValueOnce(ok({ comments: page1Comments, nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(ok({ comments: page2Comments, nextCursor: undefined }));

    const result = await useCase.execute({ channelId: "a0000000-0000-4000-a000-000000000001" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.synced, 2);
    expect(adapter.getComments).toHaveBeenCalledTimes(2);
  });
});
