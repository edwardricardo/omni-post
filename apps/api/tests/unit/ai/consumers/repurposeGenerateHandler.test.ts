/**
 * @file repurposeGenerateHandler.test.ts
 * @description Unit tests for the GENERATE_REPURPOSE job handler: agent
 *              graph drives variant generation per target platform,
 *              human-approval interrupt persists a pending draft without
 *              publishing, idempotent re-processing, and retry signalling
 *              on per-platform failure. Agent + variant ports are faked
 *              (deterministic, no LLM).
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { type Result, ok, err } from "@shared/types";
import type { AgentOrchestrationPort, AgentRunOutcome, AgentOrchestrationError } from "@ports/core";
import { processRepurposeGenerateJob } from "../../../../src/ai/consumers/repurposeGenerateHandler.js";

const TRAJ = { steps: [], totalSteps: 0, totalTokenCost: 0 } as const;

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

interface CreatedVariant {
  proposalId: string;
  platform: string;
  content: string;
  hashtags: string[];
}

function makeVariantPort(overrides?: {
  proposal?: unknown;
  content?: string | null;
  connected?: string[];
  existing?: string[];
}) {
  const created: CreatedVariant[] = [];
  const port = {
    loadProposal: async () =>
      overrides?.proposal !== undefined
        ? (overrides.proposal as null)
        : { id: "prop-1", accountId: "acc-1", sourcePostId: "post-1", sourcePlatform: "x" },
    getPostContent: async () =>
      overrides?.content !== undefined ? overrides.content : "Source post body",
    getConnectedPlatforms: async () => overrides?.connected ?? ["x", "instagram", "facebook"],
    existingVariantPlatforms: async () => overrides?.existing ?? [],
    createVariant: async (p: CreatedVariant) => {
      created.push(p);
    },
  };
  return { port, created };
}

/** Agent fake: per-targetPlatform scripted outcomes. */
function makeAgent(
  script: Record<string, Result<AgentRunOutcome<{ draft?: string }>, AgentOrchestrationError>>
): AgentOrchestrationPort {
  return {
    run: async (_graphId, initialState) => {
      const tp = (initialState as { targetPlatform: string }).targetPlatform;
      return (script[tp] ?? err("GRAPH_NOT_FOUND")) as never;
    },
    resume: async () => err("RESUME_TOKEN_INVALID") as never,
  };
}

describe("processRepurposeGenerateJob", () => {
  let logger: ReturnType<typeof silentLogger>;
  beforeEach(() => {
    logger = silentLogger();
  });

  it("persists a PENDING variant per target platform when the graph completes", async () => {
    const { port, created } = makeVariantPort();
    const agent = makeAgent({
      instagram: ok({ kind: "completed", state: { draft: "IG draft" }, trajectory: TRAJ }),
      facebook: ok({ kind: "completed", state: { draft: "FB draft" }, trajectory: TRAJ }),
    });

    await processRepurposeGenerateJob({ agent, variants: port, logger }, { proposalId: "prop-1" });

    assert.strictEqual(created.length, 2);
    assert.deepStrictEqual(created.map((c) => [c.platform, c.content]).sort(), [
      ["facebook", "FB draft"],
      ["instagram", "IG draft"],
    ]);
  });

  it("persists the pre-approval draft on a human-approval interrupt (never publishes)", async () => {
    const { port, created } = makeVariantPort({ connected: ["x", "instagram"] });
    const agent = makeAgent({
      instagram: ok({
        kind: "interrupted",
        interrupt: {
          resumeToken: "rt-1",
          atNode: "approve",
          pending: { draft: "IG pending draft" },
          reason: "approval required",
        },
        trajectory: TRAJ,
      }),
    });

    await processRepurposeGenerateJob({ agent, variants: port, logger }, { proposalId: "prop-1" });

    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0]?.platform, "instagram");
    assert.strictEqual(created[0]?.content, "IG pending draft");
  });

  it("is idempotent: already-generated platforms are skipped", async () => {
    const { port, created } = makeVariantPort({ existing: ["instagram"] });
    const agent = makeAgent({
      facebook: ok({ kind: "completed", state: { draft: "FB draft" }, trajectory: TRAJ }),
    });

    await processRepurposeGenerateJob({ agent, variants: port, logger }, { proposalId: "prop-1" });

    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0]?.platform, "facebook");
  });

  it("is a no-op when every target platform already has a variant", async () => {
    const { port, created } = makeVariantPort({ existing: ["instagram", "facebook"] });
    const agent = makeAgent({});

    await processRepurposeGenerateJob({ agent, variants: port, logger }, { proposalId: "prop-1" });

    assert.strictEqual(created.length, 0);
  });

  it("persists succeeded platforms and throws to retry the failed ones", async () => {
    const { port, created } = makeVariantPort();
    const agent = makeAgent({
      instagram: err("NODE_FAILED"),
      facebook: ok({ kind: "completed", state: { draft: "FB draft" }, trajectory: TRAJ }),
    });

    await expect(
      processRepurposeGenerateJob({ agent, variants: port, logger }, { proposalId: "prop-1" })
    ).rejects.toThrow(/incomplete for proposal prop-1/);

    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0]?.platform, "facebook");
  });

  it("skips when the proposal is not found", async () => {
    const { port, created } = makeVariantPort({ proposal: null });
    const agent = makeAgent({});

    await processRepurposeGenerateJob({ agent, variants: port, logger }, { proposalId: "missing" });

    assert.strictEqual(created.length, 0);
  });

  it("skips when the source post has no content", async () => {
    const { port, created } = makeVariantPort({ content: null });
    const agent = makeAgent({});

    await processRepurposeGenerateJob({ agent, variants: port, logger }, { proposalId: "prop-1" });

    assert.strictEqual(created.length, 0);
  });
});
