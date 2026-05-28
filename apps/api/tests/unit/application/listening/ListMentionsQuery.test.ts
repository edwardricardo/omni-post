/**
 * @file ListMentionsQuery.test.ts
 * @description Unit tests for ListMentionsQuery
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ListMentionsQuery } from "@core/listening/ListMentionsQuery.js";
import type {
  CursorPaginatedResult,
  MentionDTO,
} from "@core/domain/repositories/MentionQueryRepository.js";

function emptyPage(): CursorPaginatedResult<MentionDTO> {
  return { items: [], nextCursor: null, hasMore: false };
}

function makeRepo() {
  return {
    getShareOfVoice: vi.fn(),
    listMentions: vi.fn().mockResolvedValue(emptyPage()),
  };
}

describe("ListMentionsQuery", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: ListMentionsQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new ListMentionsQuery(repo);
  });

  it("delegates to the repository with the account-scoped filter", async () => {
    const result = await useCase.execute({ accountId: "acc-1", projectId: "proj-1" });

    assert.ok(result.ok);
    const [filter, pagination] = repo.listMentions.mock.calls[0] as [
      Record<string, unknown>,
      { limit: number },
    ];
    assert.strictEqual(filter.accountId, "acc-1");
    assert.strictEqual(filter.projectId, "proj-1");
    assert.strictEqual(pagination.limit, 20);
  });

  it("maps and validates provider/kind/sentiment filters", async () => {
    const since = new Date("2026-04-01T00:00:00Z");
    await useCase.execute({
      accountId: "acc-1",
      projectId: "proj-1",
      provider: "x",
      kind: "BRAND",
      sentiment: "POSITIVE",
      since,
      cursor: "cur",
      limit: 50,
    });

    const [filter, pagination] = repo.listMentions.mock.calls[0] as [
      Record<string, unknown>,
      { cursor?: string; limit: number },
    ];
    assert.strictEqual(filter.provider, "X"); // Provider.fromString uppercases
    assert.strictEqual(filter.kind, "BRAND");
    assert.strictEqual(filter.sentiment, "POSITIVE");
    assert.strictEqual(filter.since, since);
    assert.strictEqual(pagination.cursor, "cur");
    assert.strictEqual(pagination.limit, 50);
  });

  it("rejects an invalid provider", async () => {
    const result = await useCase.execute({ accountId: "acc-1", provider: "myspace" });
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    expect(repo.listMentions).not.toHaveBeenCalled();
  });

  it("rejects an invalid tracked-term kind", async () => {
    const result = await useCase.execute({ accountId: "acc-1", kind: "COMPETITOR" });
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("rejects an invalid sentiment label", async () => {
    const result = await useCase.execute({ accountId: "acc-1", sentiment: "ANGRY" });
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });
});
