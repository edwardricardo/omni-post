/**
 * @file sagaWaitAmplification.test.ts
 * @description The customer-facing invariant of a fan-out publish: a post whose
 *   channels all publish successfully reaches a terminal SUCCESS, whatever the
 *   number of channels and however their completion events are spaced.
 *
 *   It exists because the opposite was measured. With the wait step reporting
 *   "still pending" through the same value it uses for a failure, every sibling
 *   completion event spent one retry, and a four-channel publish exhausted the
 *   budget on its own siblings:
 *
 *     B0  rc=1 step=3 RUNNING   nextRetryAt +5009ms   (initial, pending=4)
 *     J1  rc=2 step=3 RUNNING   nextRetryAt +10035ms  (pending 3)
 *     J2  rc=3 step=3 RUNNING   nextRetryAt +20060ms  (pending 2)
 *     J3  FAILED rc=3           error "Publishing jobs still in progress"
 *     J4  FAILED                (all four channels had published)
 *     waitCallsSeq = [4,3,2,1]
 *
 *   1 + (N-1) burns, so N >= 4 reached FAILED deterministically with every
 *   channel published and the customer told their post failed. The assertions
 *   below are that same fixture with the outcome the publish always had.
 *
 *   Zero timers and no services: `createChaosHarness` drives the real engine
 *   over in-memory doubles, so the arithmetic is arithmetic rather than timing
 *   and reproduces identically on every machine.
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPostPublishingSagaDefinition } from "@shared/types/saga.js";
import { ok } from "@shared/types";
import { createChaosHarness, type ChaosHarness } from "./chaos-helpers.js";

const flushDispatch = async (): Promise<void> => {
  // executeSagaAsync defers via setImmediate; one macrotask turn plus slack
  // drains the dispatch and its awaited persists against in-memory doubles.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 25));
};

describe("a four-channel publish whose channels all succeed", () => {
  let harness: ChaosHarness;
  let pending = 4; // 4-channel publish: J1..J4
  let waitCalls = 0;
  before(async () => {
    harness = await createChaosHarness();
    const definition = createPostPublishingSagaDefinition(
      async () => ({ success: true, data: { postId: "post-p1", version: 1 } }),
      async (job) => `probe-${String(job.channelId)}`,
      async () => {
        waitCalls += 1;
        // An OBSERVED state: the reader answers with what it really saw. A
        // reader that could not read at all answers an error, and the step
        // treats that as a failure — never as "nothing has finished".
        return ok({ completed: 4 - pending, failed: 0, pending });
      }
    );
    harness.manager.registerSaga(definition);
  });
  after(async () => harness.teardown());

  it("reaches COMPLETED with no retry spent on a sibling's completion event", async () => {
    const instance = await harness.manager.startSaga("post-publishing-saga", {
      accountId: harness.accountId,
      metadata: {
        accountId: harness.accountId,
        mode: "publish-now",
        projectId: "proj-p1",
        // channelIds MUST live inside postData: readPostData reads
        // context.metadata.postData.channelIds. A root-level channelIds kills
        // the saga at its validation step and the probe proves nothing.
        postData: {
          locale: "en",
          body: "probe body",
          tags: [],
          mediaIds: [],
          channelIds: ["ch-1", "ch-2", "ch-3", "ch-4"],
        },
      },
    });
    await flushDispatch();
    let saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.currentStep, 3, "the saga is parked on its wait step");
    assert.equal(
      saga?.retryCount,
      0,
      "waiting for the channels is not an attempt: the initial wait spends no retry"
    );
    assert.equal(saga?.error, undefined, "and records no error while it waits");

    // Each sibling completion re-dispatches the wait step, which still finds
    // channels outstanding. Before the outcome contract this cost one retry per
    // event and the budget was gone by the third.
    for (const _job of ["J1", "J2", "J3"]) {
      pending -= 1;
      await harness.manager.handleEvent({
        type: "publish.job.completed",
        metadata: { sagaId: instance.id },
      } as never);
      await flushDispatch();
      saga = await harness.manager.getSaga(instance.id);
      assert.equal(saga?.retryCount, 0, "a sibling's completion event consumes no retry budget");
      assert.equal(saga?.status, "RUNNING", "and leaves the saga non-terminal");
      assert.equal(saga?.currentStep, 3, "and does not advance it past the step it waits on");
    }

    // The last channel lands: the wait step finds nothing outstanding, the
    // saga finishes the post-pivot step and settles.
    pending = 0;
    await harness.manager.handleEvent({
      type: "publish.job.completed",
      metadata: { sagaId: instance.id },
    } as never);
    await flushDispatch();

    saga = await harness.manager.getSaga(instance.id);
    assert.equal(
      saga?.status,
      "COMPLETED",
      "every channel published, so the publish reports the outcome it actually had"
    );
    assert.equal(saga?.retryCount, 0, "and it spent no retry doing so");
    assert.equal(saga?.error, undefined, "with no failure text on the row");
    assert.equal(pending, 0, "all four channels published");
    assert.ok(
      waitCalls >= 4,
      `the wait step was really re-entered by the events (calls: ${waitCalls})`
    );
  });
});

describe("a four-channel publish in which one channel genuinely errors", () => {
  let harness: ChaosHarness;
  before(async () => {
    harness = await createChaosHarness();
    const definition = createPostPublishingSagaDefinition(
      async () => ({ success: true, data: { postId: "post-p2", version: 1 } }),
      async (job) => `probe-fail-${String(job.channelId)}`,
      // Nothing outstanding, one job ended in error: a real failure, not a
      // step that has not finished.
      async () => ok({ completed: 3, failed: 1, pending: 0 })
    );
    harness.manager.registerSaga(definition);
  });
  after(async () => harness.teardown());

  it("still consumes budget per failure and ends FAILED carrying the real cause", async () => {
    const instance = await harness.manager.startSaga("post-publishing-saga", {
      accountId: harness.accountId,
      metadata: {
        accountId: harness.accountId,
        mode: "publish-now",
        projectId: "proj-p2",
        postData: {
          locale: "en",
          body: "probe body",
          tags: [],
          mediaIds: [],
          channelIds: ["ch-1", "ch-2", "ch-3", "ch-4"],
        },
      },
    });
    await flushDispatch();
    let saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.retryCount, 1, "a real failure spends exactly one retry");

    for (const expected of [2, 3]) {
      await harness.manager.handleEvent({
        type: "publish.job.completed",
        metadata: { sagaId: instance.id },
      } as never);
      await flushDispatch();
      saga = await harness.manager.getSaga(instance.id);
      assert.equal(saga?.retryCount, expected, "each further failure spends one more");
    }

    await harness.manager.handleEvent({
      type: "publish.job.completed",
      metadata: { sagaId: instance.id },
    } as never);
    await flushDispatch();

    saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.status, "FAILED", "the exhausted budget still ends the saga");
    assert.match(
      String(saga?.error),
      /publishing jobs failed/i,
      "and it fails for the job that errored, not for one that had not finished"
    );
  });
});
