/**
 * @file sagaDedupeKeys.property.test.ts
 * @description Property suite for the saga dedupe keys, read through the commands the steps
 *   emit (`CreatePostStep` forward and compensation, `UpdatePostStatusStep`): each command id is
 *   `cmd-<sagaId>-<stepId>`, a compensation appends `-compensate`, the same saga emits the same
 *   ids on every attempt, and no two (sagaId, stepId, compensation) keys share an id. Saga ids
 *   are UUIDs, whose fixed length keeps the concatenation unambiguous; that is the domain the
 *   injectivity property states. Every run is pinned to one seed, so a failure replays as
 *   fast-check prints it (`fc.assert(property, { seed, path })`).
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  CreatePostStep,
  UpdatePostStatusStep,
  createSagaContext,
  type SagaContext,
} from "@shared/types/saga.js";
import type { Command } from "@shared/types/cqrs.js";

/**
 * One fixed seed for every property of this file, so CI reproduces a failure byte for byte; 100
 * runs is fast-check's own default, and one saga's three steps run in microseconds.
 */
const PROPERTY_RUN = { seed: 20_261_018, numRuns: 100 } as const;

const POST_ID = "post-1";
const CREATE_STEP_ID = new CreatePostStep(async () => ({})).id;
const PROMOTE_STEP_ID = new UpdatePostStatusStep(async () => ({})).id;

/** A publish-now context for one scheduled and published channel, under the given saga id. */
const makeContext = (sagaId: string): SagaContext => {
  const ctx = createSagaContext({
    sagaId,
    correlationId: "corr-1",
    userId: "user-1",
    metadata: {
      mode: "publish-now",
      postData: { body: "x", channelIds: ["c1"] },
      accountId: "acc-1",
    },
  });
  ctx.stepData["schedule-publishing-jobs"] = {
    jobIds: ["job-c1"],
    channelIds: ["c1"],
    channelCount: 1,
  };
  ctx.stepData["wait-publishing-completion"] = {
    totalJobs: 1,
    completed: 1,
    failed: 0,
    publishingComplete: true,
  };
  return ctx;
};

/**
 * Runs the create step, its compensation and the promotion step for one saga, answering every
 * command with success, and returns the command ids in emission order.
 */
const emitCommandIds = async (sagaId: string): Promise<string[]> => {
  const commands: Command[] = [];
  const execute = async (command: Command): Promise<unknown> => {
    commands.push(command);
    return { success: true, data: { postId: POST_ID, version: 1 } };
  };
  const ctx = makeContext(sagaId);
  const create = new CreatePostStep(execute);

  assert.strictEqual((await create.execute(ctx)).outcome, "succeeded");
  assert.strictEqual((await create.compensate(ctx, { postId: POST_ID })).outcome, "succeeded");
  assert.strictEqual((await new UpdatePostStatusStep(execute).execute(ctx)).outcome, "succeeded");
  return commands.map((command) => command.id);
};

describe("saga dedupe keys (property)", () => {
  it("names each command cmd-<sagaId>-<stepId> and suffixes a compensation", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (sagaId) => {
        assert.deepStrictEqual(await emitCommandIds(sagaId), [
          `cmd-${sagaId}-${CREATE_STEP_ID}`,
          `cmd-${sagaId}-${CREATE_STEP_ID}-compensate`,
          `cmd-${sagaId}-${PROMOTE_STEP_ID}`,
        ]);
      }),
      PROPERTY_RUN
    );
  });

  it("emits the same ids on every attempt of the same saga", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (sagaId) => {
        assert.deepStrictEqual(await emitCommandIds(sagaId), await emitCommandIds(sagaId));
      }),
      PROPERTY_RUN
    );
  });

  it("gives every (sagaId, stepId, compensation) key its own id", async () => {
    const sagaIds = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 6 });
    await fc.assert(
      fc.asyncProperty(sagaIds, async (ids) => {
        const emitted = (await Promise.all(ids.map(emitCommandIds))).flat();

        assert.strictEqual(emitted.length, 3 * ids.length);
        assert.strictEqual(new Set(emitted).size, emitted.length);
      }),
      PROPERTY_RUN
    );
  });
});
