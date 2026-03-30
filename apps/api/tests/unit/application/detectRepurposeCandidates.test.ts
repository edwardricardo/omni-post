/**
 * @file detectRepurposeCandidates.test.ts
 * @description Unit tests for DetectRepurposeCandidatesUseCase and related use cases.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { DetectRepurposeCandidatesUseCase } from "../../../src/application/ai/DetectRepurposeCandidatesUseCase.js";
import { ApproveRepurposeVariantUseCase } from "../../../src/application/ai/ApproveRepurposeVariantUseCase.js";
import { RejectRepurposeVariantUseCase } from "../../../src/application/ai/RejectRepurposeVariantUseCase.js";

function makeMockDetectionPort(
  avg = 3,
  candidates: Array<{
    postId: string;
    platform: string;
    engagementRate: number;
    content: string;
  }> = [{ postId: "post-1", platform: "LINKEDIN", engagementRate: 7.5, content: "Great post" }]
) {
  return {
    getAccountAvgEngagement: vi.fn().mockResolvedValue(avg),
    getHighPerformers: vi.fn().mockResolvedValue(candidates),
    proposalExistsForPost: vi.fn().mockResolvedValue(false),
    createProposal: vi.fn().mockResolvedValue("proposal-1"),
  };
}

function makeMockDispatcher() {
  return { dispatchGenerateVariants: vi.fn().mockResolvedValue(undefined) };
}

describe("DetectRepurposeCandidatesUseCase", () => {
  let port: ReturnType<typeof makeMockDetectionPort>;
  let dispatcher: ReturnType<typeof makeMockDispatcher>;
  let useCase: DetectRepurposeCandidatesUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    port = makeMockDetectionPort();
    dispatcher = makeMockDispatcher();
    useCase = new DetectRepurposeCandidatesUseCase(port, dispatcher);
  });

  it("detects post with 2x+ average engagement", async () => {
    const result = await useCase.execute({ accountId: "acc-1" });
    assert.ok(result.ok);
    assert.strictEqual(result.value.detected, 1);
    expect(port.createProposal).toHaveBeenCalledOnce();
  });

  it("does not detect when no candidates exceed threshold", async () => {
    port = makeMockDetectionPort(5, []);
    useCase = new DetectRepurposeCandidatesUseCase(port, dispatcher);

    const result = await useCase.execute({ accountId: "acc-1" });
    assert.ok(result.ok);
    assert.strictEqual(result.value.detected, 0);
  });

  it("skips posts already proposed", async () => {
    port.proposalExistsForPost.mockResolvedValue(true);

    const result = await useCase.execute({ accountId: "acc-1" });
    assert.ok(result.ok);
    assert.strictEqual(result.value.detected, 0);
    assert.strictEqual(result.value.alreadyProposed, 1);
  });

  it("dispatches GenerateRepurposeVariants job per new proposal", async () => {
    await useCase.execute({ accountId: "acc-1" });
    expect(dispatcher.dispatchGenerateVariants).toHaveBeenCalledWith("proposal-1");
  });

  it("returns 0 when account has no analytics data", async () => {
    port = makeMockDetectionPort(0);
    useCase = new DetectRepurposeCandidatesUseCase(port, dispatcher);

    const result = await useCase.execute({ accountId: "acc-empty" });
    assert.ok(result.ok);
    assert.strictEqual(result.value.detected, 0);
  });

  it("calculates correct engagement multiplier", async () => {
    await useCase.execute({ accountId: "acc-1" });
    const call = port.createProposal.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.ok(call);
    assert.strictEqual(call.engagementMultiplier, 2.5);
  });
});

describe("ApproveRepurposeVariantUseCase", () => {
  function makeMockApprovePort() {
    return {
      loadVariant: vi.fn().mockResolvedValue({
        id: "var-1",
        proposalId: "prop-1",
        platform: "X",
        content: "Great content",
        hashtags: ["#test"],
        status: "PENDING",
        proposal: { accountId: "acc-1", sourcePostId: "post-1" },
      }),
      setVariantApproved: vi.fn().mockResolvedValue(undefined),
      createDraftPost: vi.fn().mockResolvedValue("new-post-1"),
    };
  }

  it("creates a Draft post from variant", async () => {
    const port = makeMockApprovePort();
    const useCase = new ApproveRepurposeVariantUseCase(port);
    const result = await useCase.execute({ variantId: "var-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.postId, "new-post-1");
    expect(port.createDraftPost).toHaveBeenCalledOnce();
  });

  it("rejects approval for variant from another account", async () => {
    const port = makeMockApprovePort();
    const useCase = new ApproveRepurposeVariantUseCase(port);
    const result = await useCase.execute({ variantId: "var-1", accountId: "other-acc" });

    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("Access denied"));
  });

  it("rejects already-processed variant", async () => {
    const port = makeMockApprovePort();
    port.loadVariant.mockResolvedValue({
      id: "var-1",
      proposalId: "prop-1",
      platform: "X",
      content: "c",
      hashtags: [],
      status: "APPROVED",
      proposal: { accountId: "acc-1", sourcePostId: "post-1" },
    });
    const useCase = new ApproveRepurposeVariantUseCase(port);
    const result = await useCase.execute({ variantId: "var-1", accountId: "acc-1" });

    assert.ok(!result.ok);
  });
});

describe("RejectRepurposeVariantUseCase", () => {
  function makeMockRejectPort(allRejected = false) {
    return {
      loadVariant: vi.fn().mockResolvedValue({
        id: "var-1",
        proposalId: "prop-1",
        status: "PENDING",
        proposal: { accountId: "acc-1" },
      }),
      setVariantRejected: vi.fn().mockResolvedValue(undefined),
      allVariantsRejected: vi.fn().mockResolvedValue(allRejected),
      setProposalRejected: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("rejects a variant", async () => {
    const port = makeMockRejectPort();
    const useCase = new RejectRepurposeVariantUseCase(port);
    const result = await useCase.execute({ variantId: "var-1", accountId: "acc-1" });

    assert.ok(result.ok);
    expect(port.setVariantRejected).toHaveBeenCalledWith("var-1");
  });

  it("marks proposal rejected when all variants rejected", async () => {
    const port = makeMockRejectPort(true);
    const useCase = new RejectRepurposeVariantUseCase(port);
    await useCase.execute({ variantId: "var-1", accountId: "acc-1" });

    expect(port.setProposalRejected).toHaveBeenCalledWith("prop-1");
  });

  it("does NOT mark proposal rejected when some variants still pending", async () => {
    const port = makeMockRejectPort(false);
    const useCase = new RejectRepurposeVariantUseCase(port);
    await useCase.execute({ variantId: "var-1", accountId: "acc-1" });

    expect(port.setProposalRejected).not.toHaveBeenCalled();
  });
});
