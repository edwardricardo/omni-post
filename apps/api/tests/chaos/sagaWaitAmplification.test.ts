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
 *   The step now settles on the post's PUBLICATION RECORD rather than on queue
 *   state, so each scenario drives the record: a channel with no settled
 *   outcome is what the step waits on, a record it cannot read is what it
 *   fails on, and a channel that settled WITHOUT publishing is forwarded rather
 *   than waited on — which is the third scenario, and the case the old
 *   contract could only reach by failing the saga.
 *
 *   Zero timers and no services: `createChaosHarness` drives the real engine
 *   over in-memory doubles, so the arithmetic is arithmetic rather than timing
 *   and reproduces identically on every machine.
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPostPublishingSagaDefinition,
  type PublicationChannelView,
} from "@shared/types/saga.js";
import { ok, err } from "@shared/types";
import type { Command } from "@shared/types/cqrs.js";
import { createChaosHarness, type ChaosHarness } from "./chaos-helpers.js";

const CHANNEL_IDS = ["ch-1", "ch-2", "ch-3", "ch-4"] as const;

const flushDispatch = async (): Promise<void> => {
  // executeSagaAsync defers via setImmediate; one macrotask turn plus slack
  // drains the dispatch and its awaited persists against in-memory doubles.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 25));
};

/** A channel whose content went out on its provider. */
function publishedView(channelId: string): PublicationChannelView {
  return { channelId, outcome: "published", externalId: `ext-${channelId}`, redrivable: false };
}

/** A channel that settled without publishing, carrying the cause the record kept. */
function excludedView(channelId: string): PublicationChannelView {
  return {
    channelId,
    outcome: "excluded",
    reasonCode: "CONTENT_REJECTED",
    reasonDetail: "the provider rejected the content",
    redrivable: true,
  };
}

/** A channel the record holds with no settlement yet. */
function unresolvedView(channelId: string): PublicationChannelView {
  return { channelId, outcome: "unresolved", redrivable: true };
}

/**
 * The command executor every scenario installs: it opens the episode the pivot
 * asks for and accepts the promotion the post-pivot step forwards. Both answers
 * are unconditional, so a scenario's subject stays the WAIT step rather than
 * what a use case would have decided.
 */
const acceptsEveryCommand = async (command: Command): Promise<unknown> => {
  if (command.type === "post.open-publication-episode") {
    const data = command.data as { channelIds?: string[] };
    return {
      success: true,
      data: {
        opened: (data.channelIds ?? []).map((channelId) => ({ channelId, episode: 1 })),
      },
    };
  }
  return { success: true, data: { postId: command.aggregateId, version: 1 } };
};

/** The saga metadata a publish-now start carries. */
function publishNowMetadata(accountId: string, projectId: string): Record<string, unknown> {
  return {
    accountId,
    mode: "publish-now",
    projectId,
    // channelIds MUST live inside postData: readPostData reads
    // context.metadata.postData.channelIds. A root-level channelIds kills
    // the saga at its validation step and the probe proves nothing.
    postData: {
      locale: "en",
      body: "probe body",
      tags: [],
      mediaIds: [],
      channelIds: [...CHANNEL_IDS],
    },
  };
}

describe("a four-channel publish whose channels all succeed", () => {
  let harness: ChaosHarness;
  /** How many of the four channels have settled so far. */
  let settled = 0;
  let recordReads = 0;
  before(async () => {
    harness = await createChaosHarness();
    const definition = createPostPublishingSagaDefinition(
      acceptsEveryCommand,
      async (job) => `probe-${String(job.channelId)}`,
      async () => {
        recordReads += 1;
        // An OBSERVED record: the reader answers with what it really holds. A
        // reader that could not read at all answers an error, and the step
        // treats that as a failure — never as "nothing has settled".
        return ok({
          channels: CHANNEL_IDS.map((channelId, index) =>
            index < settled ? publishedView(channelId) : unresolvedView(channelId)
          ),
        });
      }
    );
    harness.manager.registerSaga(definition);
  });
  after(async () => harness.teardown());

  it("reaches COMPLETED with no retry spent on a sibling's completion event", async () => {
    const instance = await harness.manager.startSaga("post-publishing-saga", {
      accountId: harness.accountId,
      metadata: publishNowMetadata(harness.accountId, "proj-p1"),
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

    // Each sibling settlement re-dispatches the wait step, which still finds
    // channels outstanding. Before the outcome contract this cost one retry per
    // event and the budget was gone by the third.
    for (const _job of ["J1", "J2", "J3"]) {
      settled += 1;
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

    // The last channel settles: the wait step finds nothing outstanding, the
    // saga finishes the post-pivot step and settles.
    settled = CHANNEL_IDS.length;
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
    assert.equal(settled, CHANNEL_IDS.length, "all four channels published");
    assert.ok(
      recordReads >= 4,
      `the wait step was really re-entered by the events (reads: ${recordReads})`
    );
  });
});

describe("a four-channel publish whose publication record stops being readable", () => {
  let harness: ChaosHarness;
  /** Flipped once the saga is parked on its wait step, to model an outage that starts there. */
  let readable = true;
  before(async () => {
    harness = await createChaosHarness();
    const definition = createPostPublishingSagaDefinition(
      acceptsEveryCommand,
      async (job) => `probe-unreadable-${String(job.channelId)}`,
      async () => {
        // Not "nothing has settled yet": the step could not observe at all,
        // which is the one shape that must stay distinguishable from healthy
        // in-flight work — a waiting outcome spends no budget, so an outage
        // would surface half an hour later as a timeout instead of as a
        // bounded step failure.
        //
        // It starts READABLE because the pivot's own reread consults the same
        // reader before the jobs are enqueued: an outage that was already there
        // fails the pivot instead, which is a different scenario and would never
        // exercise the wait step at all.
        return readable
          ? ok({ channels: CHANNEL_IDS.map((channelId) => unresolvedView(channelId)) })
          : err("publication record unreadable: connection refused");
      }
    );
    harness.manager.registerSaga(definition);
  });
  after(async () => harness.teardown());

  it("consumes budget per failure and ends FAILED carrying the real cause", async () => {
    const instance = await harness.manager.startSaga("post-publishing-saga", {
      accountId: harness.accountId,
      metadata: publishNowMetadata(harness.accountId, "proj-p2"),
    });
    await flushDispatch();
    let saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.currentStep, 3, "the saga is parked on its wait step");
    assert.equal(saga?.retryCount, 0, "and nothing has failed yet");

    readable = false;
    await harness.manager.handleEvent({
      type: "publish.job.completed",
      metadata: { sagaId: instance.id },
    } as never);
    await flushDispatch();
    saga = await harness.manager.getSaga(instance.id);
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
      /connection refused/i,
      "and it fails for the record it could not read, not for one that had not settled"
    );
  });
});

describe("a four-channel publish in which one channel settles without publishing", () => {
  let harness: ChaosHarness;
  const promoted: Command[] = [];
  /** Flipped once the saga is parked on its wait step: nothing has settled before the pivot. */
  let settled = false;
  before(async () => {
    harness = await createChaosHarness();
    const definition = createPostPublishingSagaDefinition(
      async (command: Command) => {
        if (command.type === "post.complete-publishing") {
          promoted.push(command);
        }
        return acceptsEveryCommand(command);
      },
      async (job) => `probe-partial-${String(job.channelId)}`,
      async () =>
        ok({
          channels: CHANNEL_IDS.map((channelId, index) => {
            if (!settled) return unresolvedView(channelId);
            return index === 3 ? excludedView(channelId) : publishedView(channelId);
          }),
        })
    );
    harness.manager.registerSaga(definition);
  });
  after(async () => harness.teardown());

  it("forwards the whole outcome instead of parking on the channel that failed", async () => {
    // An EXCLUDED channel is SETTLED. Under the queue-state contract this was a
    // failed job, so the saga burned its budget and reported FAILED while three
    // channels held live content nobody was told about.
    const instance = await harness.manager.startSaga("post-publishing-saga", {
      accountId: harness.accountId,
      metadata: publishNowMetadata(harness.accountId, "proj-p3"),
    });
    await flushDispatch();
    let saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.currentStep, 3, "the saga is parked on its wait step");

    settled = true;
    await harness.manager.handleEvent({
      type: "publish.job.completed",
      metadata: { sagaId: instance.id },
    } as never);
    await flushDispatch();

    saga = await harness.manager.getSaga(instance.id);
    assert.equal(saga?.status, "COMPLETED", "the saga settles rather than waiting on the horizon");
    assert.equal(saga?.retryCount, 0, "and a settled not-published channel spends no retry");

    assert.equal(promoted.length, 1, "exactly one promotion was emitted");
    const outcome = promoted[0]?.data as {
      outcome: { channels: { channelId: string; success: boolean; reasonCode?: string }[] };
    };
    assert.equal(outcome.outcome.channels.length, 4, "every scheduled channel is accounted for");
    assert.deepEqual(
      outcome.outcome.channels.map((channel) => channel.success),
      [true, true, true, false],
      "and the channel that did not publish travels as a failure rather than being dropped"
    );
    assert.equal(
      outcome.outcome.channels[3]?.reasonCode,
      "CONTENT_REJECTED",
      "carrying the code a reader branches on, not only a message"
    );
  });
});
