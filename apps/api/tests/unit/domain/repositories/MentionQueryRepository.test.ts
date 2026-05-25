/**
 * @file MentionQueryRepository.test.ts
 * @description Contract tests for the MentionQueryRepository read-model port.
 *   Pins the MentionDTO / ShareOfVoiceDTO / MentionFilter shapes the SoV feature
 *   depends on, and that a conforming implementation satisfies the interface.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import type {
  MentionQueryRepository,
  MentionDTO,
  MentionFilter,
  ShareOfVoiceDTO,
  CursorPaginatedResult,
} from "@core/domain/repositories/MentionQueryRepository.js";

const SOV: ShareOfVoiceDTO = {
  projectId: "proj-1",
  since: new Date("2026-04-01T00:00:00Z"),
  until: new Date("2026-05-01T00:00:00Z"),
  brandCount: 8,
  marketCount: 4,
  totalCount: 12,
  sov: 2,
  byProvider: [{ provider: "X", brandCount: 5, marketCount: 2, totalCount: 7, sov: 2.5 }],
  bySentiment: { positive: 0, neutral: 0, negative: 0, unscored: 12 },
};

describe("MentionQueryRepository contract", () => {
  it("ShareOfVoiceDTO exposes raw counts so consumers can derive any ratio", () => {
    assert.strictEqual(SOV.brandCount + SOV.marketCount <= SOV.totalCount, true);
    assert.strictEqual(SOV.sov, SOV.brandCount / SOV.marketCount);
    assert.ok(Array.isArray(SOV.byProvider));
    assert.deepStrictEqual(Object.keys(SOV.bySentiment).sort(), [
      "negative",
      "neutral",
      "positive",
      "unscored",
    ]);
  });

  it("MentionFilter is account-scoped with optional listening filters", () => {
    const filter: MentionFilter = {
      accountId: "acc-1",
      projectId: "proj-1",
      provider: "X",
      kind: "BRAND",
      sentiment: "POSITIVE",
    };
    assert.strictEqual(filter.accountId, "acc-1");
    assert.strictEqual(filter.kind, "BRAND");
  });

  it("is satisfiable by a conforming implementation", async () => {
    const page: CursorPaginatedResult<MentionDTO> = { items: [], nextCursor: null, hasMore: false };
    const fake: MentionQueryRepository = {
      getShareOfVoice: vi.fn(async () => SOV),
      listMentions: vi.fn(async () => page),
    };

    const sov = await fake.getShareOfVoice({
      accountId: "acc-1",
      projectId: "proj-1",
      since: SOV.since,
      until: SOV.until,
    });
    assert.strictEqual(sov.sov, 2);

    const result = await fake.listMentions({ accountId: "acc-1" }, { limit: 20 });
    assert.deepStrictEqual(result.items, []);
    expect(fake.listMentions).toHaveBeenCalledOnce();
  });
});
