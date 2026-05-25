/**
 * @file listRepurposeProposalsQuery.test.ts
 * @description Unit tests for ListRepurposeProposalsQuery: passes the
 *              account/status/pagination through to the query port, echoes
 *              limit/offset, and wraps a thrown port error as a UseCaseError
 *              instead of letting it cross the layer boundary.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import type {
  RepurposeProposalQueryRepository,
  RepurposeProposalDto,
  RepurposeProposalQueryOptions,
} from "../../../src/domain/repositories/RepurposeProposalQueryRepository.js";
import { ListRepurposeProposalsQuery } from "@core/application/ai/ListRepurposeProposalsQuery.js";

const makeDto = (overrides?: Partial<RepurposeProposalDto>): RepurposeProposalDto => ({
  id: "prop-1",
  sourcePostId: "post-1",
  sourcePlatform: "X",
  status: "PENDING",
  engagementRate: 0.12,
  engagementMultiplier: 2.4,
  detectedAt: "2026-05-19T00:00:00.000Z",
  reviewedAt: null,
  variantCount: 0,
  ...overrides,
});

function makeRepo(result: { proposals: RepurposeProposalDto[]; total: number } | Error): {
  repo: RepurposeProposalQueryRepository;
  calls: Array<[string, RepurposeProposalQueryOptions]>;
} {
  const calls: Array<[string, RepurposeProposalQueryOptions]> = [];
  const repo: RepurposeProposalQueryRepository = {
    findByAccountId: async (accountId, options) => {
      calls.push([accountId, options]);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { repo, calls };
}

describe("ListRepurposeProposalsQuery", () => {
  it("returns the proposals page and echoes pagination when given valid input", async () => {
    const dto = makeDto();
    const { repo, calls } = makeRepo({ proposals: [dto], total: 1 });
    const query = new ListRepurposeProposalsQuery(repo);

    const result = await query.execute({
      accountId: "acc-1",
      status: "PENDING",
      limit: 20,
      offset: 0,
    });

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value, {
      proposals: [dto],
      total: 1,
      limit: 20,
      offset: 0,
    });
    assert.deepStrictEqual(calls[0], ["acc-1", { status: "PENDING", limit: 20, offset: 0 }]);
  });

  it("omits the status filter when no status is given", async () => {
    const { repo, calls } = makeRepo({ proposals: [], total: 0 });
    const query = new ListRepurposeProposalsQuery(repo);

    const result = await query.execute({ accountId: "acc-2", limit: 50, offset: 10 });

    assert.ok(result.ok);
    assert.deepStrictEqual(calls[0], ["acc-2", { limit: 50, offset: 10 }]);
  });

  it("returns a UseCaseError when the query port throws", async () => {
    const { repo } = makeRepo(new Error("db down"));
    const query = new ListRepurposeProposalsQuery(repo);

    const result = await query.execute({ accountId: "acc-3", limit: 20, offset: 0 });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
    expect(result.error.message).toMatch(/list repurpose proposals/i);
  });
});
