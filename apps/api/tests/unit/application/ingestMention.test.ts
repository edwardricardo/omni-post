/**
 * @file ingestMention.test.ts
 * @description Unit tests for IngestMentionUseCase: dedup by (provider, externalId),
 *   create-new, and validation of typed IDs / required fields.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { IngestMentionUseCase } from "@core/application/listening/IngestMentionUseCase.js";
import { MentionAggregate } from "@core/domain/aggregates/MentionAggregate.js";
import { AccountId, ProjectId } from "@core/domain/value-objects/EntityId.js";
import type { ProviderType } from "@core/domain/value-objects/Provider.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CHANNEL_ID = "33333333-3333-4333-8333-333333333333";

function makeRepo() {
  return {
    findByProviderExternalId: vi.fn(async () => null),
    save: vi.fn(async () => ({ ok: true as const, value: undefined })),
  };
}

function makeInput(overrides?: Record<string, unknown>) {
  return {
    accountId: ACCOUNT_ID,
    projectId: PROJECT_ID,
    channelId: CHANNEL_ID,
    provider: "X" as ProviderType,
    externalId: "ext-mention-1",
    source: "SEARCH" as const,
    authorName: "Jane Doe",
    authorProviderId: "provider-user-1",
    body: "Loving Acme today!",
    providerCreatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

function makeExisting() {
  const r = MentionAggregate.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    provider: "X" as ProviderType,
    externalId: "ext-mention-1",
    source: "SEARCH",
    authorName: "Jane",
    authorProviderId: "provider-user-1",
    body: "existing",
    providerCreatedAt: new Date("2026-05-01T00:00:00Z"),
  });
  if (!r.ok) throw r.error;
  return r.value;
}

describe("IngestMentionUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: IngestMentionUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new IngestMentionUseCase(repo as never);
  });

  it("creates a new mention and returns isNew=true", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok, `Expected ok, got: ${!r.ok ? r.error.message : ""}`);
    expect(r.value.isNew).toBe(true);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("returns the existing mention when duplicate (isNew=false), without saving", async () => {
    repo.findByProviderExternalId.mockResolvedValueOnce(makeExisting() as never);
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    expect(r.value.isNew).toBe(false);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("ingests without an optional channelId", async () => {
    const r = await uc.execute(makeInput({ channelId: undefined }));
    assert.ok(r.ok);
    expect(r.value.isNew).toBe(true);
  });

  it("rejects an invalid accountId", async () => {
    const r = await uc.execute(makeInput({ accountId: "not-a-uuid" }));
    assert.ok(!r.ok);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("rejects an invalid projectId", async () => {
    const r = await uc.execute(makeInput({ projectId: "not-a-uuid" }));
    assert.ok(!r.ok);
  });

  it("rejects an invalid channelId when provided", async () => {
    const r = await uc.execute(makeInput({ channelId: "not-a-uuid" }));
    assert.ok(!r.ok);
  });

  it("rejects an empty body", async () => {
    const r = await uc.execute(makeInput({ body: "" }));
    assert.ok(!r.ok);
  });

  it("rejects an empty authorName", async () => {
    const r = await uc.execute(makeInput({ authorName: "" }));
    assert.ok(!r.ok);
  });

  it("rejects an empty externalId", async () => {
    const r = await uc.execute(makeInput({ externalId: "" }));
    assert.ok(!r.ok);
  });

  it("returns an error when save fails", async () => {
    repo.save.mockResolvedValueOnce({ ok: false as never, error: new Error("DB error") as never });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
  });
});
