/**
 * @file GetShareOfVoiceQuery.test.ts
 * @description Unit tests for GetShareOfVoiceQuery
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GetShareOfVoiceQuery } from "@core/application/listening/GetShareOfVoiceQuery.js";
import type { ShareOfVoiceDTO } from "../../../../src/domain/repositories/MentionQueryRepository.js";

function makeDTO(overrides: Partial<ShareOfVoiceDTO> = {}): ShareOfVoiceDTO {
  return {
    projectId: "proj-1",
    since: new Date("2026-04-01T00:00:00Z"),
    until: new Date("2026-05-01T00:00:00Z"),
    brandCount: 8,
    marketCount: 4,
    totalCount: 12,
    sov: 2,
    byProvider: [],
    bySentiment: { positive: 0, neutral: 0, negative: 0, unscored: 12 },
    ...overrides,
  };
}

function makeRepo() {
  return {
    getShareOfVoice: vi.fn().mockResolvedValue(makeDTO()),
    listMentions: vi.fn(),
  };
}

describe("GetShareOfVoiceQuery", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: GetShareOfVoiceQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new GetShareOfVoiceQuery(repo);
  });

  it("returns the SoV DTO from the repository", async () => {
    const result = await useCase.execute({ accountId: "acc-1", projectId: "proj-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.brandCount, 8);
    assert.strictEqual(result.value.sov, 2);
  });

  it("defaults to a trailing 30-day window when none is given", async () => {
    const before = Date.now();
    await useCase.execute({ accountId: "acc-1", projectId: "proj-1" });
    const after = Date.now();

    const call = repo.getShareOfVoice.mock.calls[0]?.[0] as { since: Date; until: Date };
    assert.ok(call);
    const windowMs = call.until.getTime() - call.since.getTime();
    assert.strictEqual(windowMs, 30 * 24 * 60 * 60 * 1000);
    assert.ok(call.until.getTime() >= before && call.until.getTime() <= after);
  });

  it("passes an explicit window through unchanged", async () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const until = new Date("2026-02-01T00:00:00Z");

    await useCase.execute({ accountId: "acc-1", projectId: "proj-1", since, until });

    expect(repo.getShareOfVoice).toHaveBeenCalledWith({
      accountId: "acc-1",
      projectId: "proj-1",
      since,
      until,
    });
  });

  it("rejects an inverted window (since >= until)", async () => {
    const since = new Date("2026-02-01T00:00:00Z");
    const until = new Date("2026-01-01T00:00:00Z");

    const result = await useCase.execute({ accountId: "acc-1", projectId: "proj-1", since, until });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    expect(repo.getShareOfVoice).not.toHaveBeenCalled();
  });
});
