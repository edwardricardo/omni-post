/**
 * @file sagaDeterministicIds.test.ts
 * @description Verifies that saga steps emit deterministic command IDs
 *              keyed on (sagaId, stepId) so retries collapse to a single
 *              dedupeKey instead of fanning out per-attempt.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import {
  CreatePostStep,
  UpdatePostStatusStep,
  createSagaContext,
  type SagaContext,
} from "@shared/saga";
import type { Command } from "@shared/cqrs";

function makeContext(): SagaContext {
  return createSagaContext("saga-fixed-id", "corr-1", "user-1", {
    mode: "publish-now",
    postData: { body: "x", channelIds: ["c1"] },
  });
}

describe("Saga deterministic command IDs", () => {
  it("CreatePostStep emits identical command IDs across retries of the same saga", async () => {
    const ids: string[] = [];
    const step = new CreatePostStep(async (cmd: Command) => {
      ids.push(cmd.id);
      return { success: true, data: { id: cmd.aggregateId, version: 1 } };
    });

    const ctx = makeContext();
    await step.execute(ctx);
    await step.execute(ctx);
    await step.execute(ctx);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("cmd-saga-fixed-id-create-post");
  });

  it("CreatePostStep compensate emits a distinct deterministic ID with -compensate suffix", async () => {
    let forwardId = "";
    let compensateId = "";
    const step = new CreatePostStep(async (cmd: Command) => {
      if (cmd.type === "post.create") forwardId = cmd.id;
      if (cmd.type === "post.delete") compensateId = cmd.id;
      return { success: true, data: { id: cmd.aggregateId, version: 1 } };
    });

    const ctx = makeContext();
    await step.execute(ctx);
    await step.compensate?.(ctx, { postId: "post-1" });

    expect(forwardId).toBe("cmd-saga-fixed-id-create-post");
    expect(compensateId).toBe("cmd-saga-fixed-id-create-post-compensate");
    expect(forwardId).not.toBe(compensateId);
  });

  it("UpdatePostStatusStep reads previousStatus from CreatePostStep stepData (not hardcoded)", async () => {
    let revertCommand: Command | null = null;
    const step = new UpdatePostStatusStep(async (cmd: Command) => {
      if (cmd.type === "post.update" && cmd.metadata.source?.includes("Compensation")) {
        revertCommand = cmd;
      }
      return { success: true, data: {} };
    });

    const ctx = makeContext();
    ctx.stepData["create-post"] = {
      postId: "post-1",
      version: 1,
      createdAt: new Date(),
      initialStatus: "DRAFT",
    };
    ctx.stepData["wait-publishing-completion"] = {
      publishingComplete: true,
    };

    const fwd = await step.execute(ctx);
    expect(fwd.success).toBeTruthy();

    const compensationData = (fwd as { compensationData?: unknown }).compensationData as {
      previousStatus: string;
    };
    expect(compensationData.previousStatus).toBe("DRAFT");

    await step.compensate?.(ctx, compensationData);

    expect(revertCommand).toBeTruthy();
    expect(revertCommand!.id).toBe("cmd-saga-fixed-id-update-post-status-compensate");
    expect((revertCommand!.data as { status: string }).status).toBe("DRAFT");
  });

  it("UpdatePostStatusStep falls back to DRAFT only when CreatePostStep stepData is absent", async () => {
    let revertCommand: Command | null = null;
    const step = new UpdatePostStatusStep(async (cmd: Command) => {
      if (cmd.type === "post.update" && cmd.metadata.source?.includes("Compensation")) {
        revertCommand = cmd;
      }
      return { success: true, data: {} };
    });

    const ctx = makeContext();
    ctx.stepData["create-post"] = { postId: "post-1" };
    ctx.stepData["wait-publishing-completion"] = { publishingComplete: true };

    const fwd = await step.execute(ctx);
    const compensationData = (fwd as { compensationData?: unknown }).compensationData as {
      previousStatus: string;
    };
    expect(compensationData.previousStatus).toBe("DRAFT");

    await step.compensate?.(ctx, compensationData);
    expect((revertCommand!.data as { status: string }).status).toBe("DRAFT");
  });
});
