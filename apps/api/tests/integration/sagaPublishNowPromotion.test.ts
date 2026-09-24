/**
 * @file sagaPublishNowPromotion.test.ts
 * @description MERGE-BLOCKING proof that a publish-now saga whose every
 *   scheduled channel published leaves the Post aggregate in the persisted
 *   terminal state `PUBLISHED`, with `publishedAt` set and `PostPublished` in
 *   the outbox, written by the SAME transaction — and that anything short of
 *   that leaves the row exactly as it was.
 *
 *   Every assertion here reads the PERSISTED ROW and the OUTBOX, never which
 *   command a double received. That is the whole point: before this change the
 *   saga reported COMPLETED while the row stayed `DRAFT`, so a proof phrased
 *   over the saga's own report would have been green over the defect. The
 *   dangerous failure mode of this suite is a false SUCCESS, not a false alarm.
 *
 *   The composition it drives — real Postgres, the real `PrismaPostRepository`
 *   with the real outbox writer, the real `SagaIntegration` — and the two
 *   deliberate doubles live in `helpers/publishNowPromotionHarness.ts`, so this
 *   file holds one case per requirement and nothing else.
 *
 *   Requires Postgres + Redis up (`pnpm db:up`).
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import { createPostPublishingSagaDefinition } from "@shared/types/saga.js";
import {
  PublishNowPromotionHarness,
  type OutboxRow,
  type PostSnapshot,
} from "./helpers/publishNowPromotionHarness.js";

/**
 * The definition's own arithmetic, read once. The re-entry scenario's whole
 * premise is that the step it re-enters is the POST-PIVOT promotion, and a bare
 * index states that only in prose while the engine reads the definition. The
 * instance is consulted, never executed — its callbacks are inert.
 */
const REFERENCE_DEFINITION = createPostPublishingSagaDefinition(
  async () => ({ success: true }),
  async () => "the reference definition is consulted, never executed",
  async () => ok(undefined)
);
const PROMOTION_STEP_INDEX = REFERENCE_DEFINITION.steps.findIndex(
  (step) => step.id === "update-post-status"
);

describe("Publish-now promotion (MERGE-BLOCKING)", { concurrency: 1 }, () => {
  const harness = new PublishNowPromotionHarness();

  before(async () => {
    await harness.setUp();
  });

  after(async () => {
    await harness.tearDown();
  });

  describe("a publish-now whose channels all succeed", () => {
    let postId: string;
    let sagaStatus: string;
    let snapshot: PostSnapshot;
    let rows: OutboxRow[];
    let contentBefore: unknown;
    let contentAfter: unknown;

    before(async () => {
      const { manager } = await harness.boot();
      postId = await harness.seedDraftPost("total-success");
      contentBefore = await harness.contentSnapshot(postId);

      const sagaId = await harness.startSaga(manager, "publish-now", {
        projectId: harness.projectId,
        postId,
        channelIds: [harness.channelId, harness.secondChannelId],
        tags: [],
        mediaIds: [],
      });
      sagaStatus = await harness.waitForTerminal(sagaId);
      snapshot = await harness.postSnapshot(postId);
      rows = await harness.outboxFor(postId);
      contentAfter = await harness.contentSnapshot(postId);
    });

    it("lands the post in PUBLISHED with a publication timestamp, and the saga COMPLETED", () => {
      assert.strictEqual(sagaStatus, "COMPLETED");
      assert.strictEqual(snapshot.status, "PUBLISHED");
      assert.notStrictEqual(snapshot.publishedAt, null);
      // Three saves, each one a step of the flow: the episode opened over the
      // declared targets, then one recorded attempt per channel. The promotion
      // adds NONE — it reconciles, and the record already agrees with the word,
      // so `applied: false` and nothing is written.
      assert.strictEqual(
        snapshot.version,
        3,
        "the episode and the two attempts each saved once, and the promotion saved nothing"
      );
    });

    it("commits both transition events to the outbox, keyed by the channels that published", () => {
      assert.deepStrictEqual(
        rows.map((row) => row.eventType),
        ["PostPublishingStarted", "PostChannelPublished", "PostChannelPublished", "PostPublished"],
        "both hops are recorded, in the order the state machine requires, with the " +
          "per-channel event each attempt emits between them"
      );
      const published = rows.find((row) => row.eventType === "PostPublished");
      const payload = published?.payload as { providerResults?: Record<string, unknown> };
      assert.deepStrictEqual(
        Object.keys(payload.providerResults ?? {}).sort(),
        [harness.channelId, harness.secondChannelId].sort(),
        "the outcome reaching the event names the channels, not a count"
      );
    });

    it("writes no field beyond the status, the timestamp and its own bookkeeping", () => {
      assert.deepStrictEqual(
        contentAfter,
        contentBefore,
        "content and media are byte-identical after the promotion: a promotion that also " +
          "rewrote content would be indistinguishable from one that did not, without this"
      );
    });
  });

  describe("a promotion whose transaction fails after the row was already updated", () => {
    let postId: string;
    let failed = false;
    let refusal = "";
    let before_: PostSnapshot;
    let eventsBefore: string[] = [];

    before(async () => {
      // The record must be SETTLED and the word must LAG it, or this scenario proves
      // nothing: with no record the reconciliation refuses before it opens a
      // transaction, and with a word that already agrees it returns without writing.
      // Either way the injected outbox failure is never reached and the case passes
      // over a transaction that never ran.
      postId = await harness.seedRecordedPost("all-or-nothing");
      await harness.clobberPublicationWord(postId);
      before_ = await harness.postSnapshot(postId);
      eventsBefore = (await harness.outboxFor(postId)).map((row) => row.eventType);
      const useCase = harness.buildFailingPromotion();
      const result = await harness.runScoped(() =>
        useCase.execute({
          postId,
          outcome: { channels: [{ channelId: harness.channelId, success: true }] },
        })
      );
      failed = !result.ok;
      refusal = result.ok ? "" : result.error.code;
    });

    it("returns an error Result rather than reporting a publication it did not commit", () => {
      assert.strictEqual(failed, true);
      // Pinned because the two failures are indistinguishable from `!result.ok`: an
      // INTERNAL_ERROR is the injected outbox write blowing up inside the
      // transaction, which is this scenario; a VALIDATION_FAILED would be the
      // reconciliation refusing the fixture before opening one, which would make
      // every assertion below vacuously true.
      assert.strictEqual(refusal, "INTERNAL_ERROR");
    });

    it("leaves the row exactly as it was, with no outbox row of either kind", async () => {
      const snapshot = await harness.postSnapshot(postId);
      assert.deepStrictEqual(
        snapshot,
        before_,
        "status, publishedAt and version are the pre-promotion row: no update committed"
      );
      assert.strictEqual(snapshot.publishedAt, null, "and no publication moment was minted");
      assert.deepStrictEqual(
        (await harness.outboxFor(postId)).map((row) => row.eventType),
        eventsBefore,
        "and neither transition event survived: the whole transaction rolled back, leaving " +
          "exactly the rows the record's own writers had already committed"
      );
    });
  });

  describe("a promotion applied twice", () => {
    let postId: string;
    let firstPublishedAt: Date | null;
    let secondAttemptStartedAt: Date;
    let secondApplied = true;
    let snapshotAfterFirst: PostSnapshot;
    let eventsAfterFirst: string[] = [];

    before(async () => {
      // A post whose record is SETTLED, which is the only state a completed publish
      // reaches: the worker's write derives the word in the same transaction that
      // records the attempt, so by the time the promotion runs the two already agree
      // and the FIRST application legitimately applies nothing either. That is the
      // requirement rather than a weakening of it — re-application must write nothing,
      // and "nothing" is measured against the row the record's own writers left.
      postId = await harness.seedRecordedPost("idempotent");
      const outcome = { channels: [{ channelId: harness.channelId, success: true }] };
      const first = await harness.runScoped(() =>
        harness.promotionUseCase.execute({ postId, outcome })
      );
      assert.ok(first.ok, "the first promotion must succeed or the retry proves nothing");
      snapshotAfterFirst = await harness.postSnapshot(postId);
      eventsAfterFirst = (await harness.outboxFor(postId)).map((row) => row.eventType);
      firstPublishedAt = snapshotAfterFirst.publishedAt;

      // The second attempt starts strictly AFTER the first timestamp, so an
      // overwrite would write a LATER value and be observable. Two identical
      // values cannot tell "preserved" from "overwritten with the same thing".
      await new Promise((resolve) => setTimeout(resolve, 25));
      secondAttemptStartedAt = new Date();
      const second = await harness.runScoped(() =>
        // The stale token is deliberate: a completed publish has advanced the
        // version past whatever the saga was holding. Ordering the version
        // comparison first would fail a saga that in fact completed, so the
        // nothing-to-do answer resolves first.
        harness.promotionUseCase.execute({ postId, outcome, expectedVersion: 0 })
      );
      assert.ok(
        second.ok,
        "a re-application of a completed publication is a success, not an error"
      );
      secondApplied = second.value.applied;
    });

    it("answers the terminal state without applying anything a second time", () => {
      assert.strictEqual(secondApplied, false);
    });

    it("preserves the original publication timestamp, measurably", async () => {
      const snapshot = await harness.postSnapshot(postId);
      assert.ok(firstPublishedAt !== null);
      assert.strictEqual(snapshot.publishedAt?.getTime(), firstPublishedAt.getTime());
      assert.ok(
        firstPublishedAt.getTime() < secondAttemptStartedAt.getTime(),
        "the second attempt began after the recorded timestamp, so an overwrite would show"
      );
      assert.strictEqual(
        snapshot.version,
        snapshotAfterFirst.version,
        "and no second save advanced the version"
      );
    });

    it("writes no second event for the second application", async () => {
      const rows = await harness.outboxFor(postId);
      assert.deepStrictEqual(
        rows.map((row) => row.eventType),
        eventsAfterFirst,
        "exactly the rows that existed before the retry: the retry emitted nothing"
      );
      assert.strictEqual(
        rows.filter((row) => row.eventType === "PostPublished").length,
        1,
        "and the publication is announced once, not once per application"
      );
    });
  });

  describe("a completed saga whose promotion step is re-entered by a redelivered completion", () => {
    let postId: string;
    let afterFirstRun: PostSnapshot;
    let eventsAfterFirstRun: string[] = [];
    let terminal = "";

    before(async () => {
      assert.ok(
        PROMOTION_STEP_INDEX > REFERENCE_DEFINITION.pivotStepIndex,
        "the step re-entered below must be POST-pivot, or this scenario is the replay one"
      );

      const { manager } = await harness.boot();
      postId = await harness.seedDraftPost("redelivered-completion");
      const sagaId = await harness.startSaga(manager, "publish-now", {
        projectId: harness.projectId,
        postId,
        channelIds: [harness.channelId],
        tags: [],
        mediaIds: [],
      });
      assert.strictEqual(
        await harness.waitForTerminal(sagaId),
        "COMPLETED",
        "the premise: the promotion must have COMMITTED, or the re-entry proves nothing"
      );
      afterFirstRun = await harness.postSnapshot(postId);
      assert.notStrictEqual(afterFirstRun.publishedAt, null, "P1 was recorded by the first run");
      eventsAfterFirstRun = (await harness.outboxFor(postId)).map((row) => row.eventType);

      // ONLY the saga row is rewound: the post stays PUBLISHED with P1, which is
      // exactly what a redelivered completion event finds. That is what separates
      // this from the two crash-replay scenarios in sagaCrashRecovery.test.ts —
      // one rewinds to the PIVOT (refused by its reread countermeasure, saga
      // FAILED) and the other also rewinds the POST to DRAFT (so the promotion
      // applies fresh). Neither exercises an idempotent re-entry, and the first
      // ends in the OPPOSITE terminal state, which is why this needs pinning.
      await harness.rewindToStep(sagaId, PROMOTION_STEP_INDEX);
      await manager.continueSaga(sagaId);
      terminal = await harness.waitForTerminal(sagaId);
    });

    it("reaches COMPLETED: a promotion that already committed is answered, not refused", () => {
      assert.strictEqual(
        terminal,
        "COMPLETED",
        "COMPLETED carries the 'never FAILED' half of the scenario on its own: a refused " +
          "promotion reports a failed step, and a post-pivot step that exhausts its retries " +
          "terminalizes the saga FAILED"
      );
    });

    it("publishes nothing a second time: timestamp, version and outbox are the first run's", async () => {
      const snapshot = await harness.postSnapshot(postId);
      assert.strictEqual(snapshot.status, "PUBLISHED");
      assert.strictEqual(
        snapshot.publishedAt?.getTime(),
        afterFirstRun.publishedAt?.getTime(),
        "P1 is the publication's record and is immutable thereafter"
      );
      assert.strictEqual(
        snapshot.version,
        afterFirstRun.version,
        "and no second save advanced the version"
      );
      assert.deepStrictEqual(
        (await harness.outboxFor(postId)).map((row) => row.eventType),
        eventsAfterFirstRun,
        "exactly the first run's rows: the re-entered step wrote no second PostPublished"
      );
    });
  });

  describe("a saga in a mode that publishes nothing", () => {
    it("promotes no post and emits no PostPublished for schedule or draft mode", async () => {
      const { manager } = await harness.boot();

      const scheduledPostId = await harness.seedDraftPost("scheduled");
      const scheduledSaga = await harness.startSaga(manager, "schedule", {
        projectId: harness.projectId,
        postId: scheduledPostId,
        channelIds: [harness.channelId],
        scheduledAt: new Date(Date.now() + 3_600_000),
        tags: [],
        mediaIds: [],
      });
      const draftSaga = await harness.startSaga(manager, "draft", {
        projectId: harness.projectId,
        locale: "en",
        body: `${harness.tag} draft-mode body`,
        channelIds: [harness.channelId],
        tags: [],
        mediaIds: [],
      });

      assert.strictEqual(await harness.waitForTerminal(scheduledSaga), "COMPLETED");
      assert.strictEqual(await harness.waitForTerminal(draftSaga), "COMPLETED");

      const draftPostId = await harness.createdPostId(draftSaga);
      for (const id of [scheduledPostId, draftPostId]) {
        const snapshot = await harness.postSnapshot(id);
        assert.notStrictEqual(snapshot.status, "PUBLISHED", `post ${id} must not be published`);
        assert.strictEqual(snapshot.publishedAt, null, `post ${id} must carry no publishedAt`);
        const rows = await harness.outboxFor(id);
        assert.strictEqual(
          rows.filter((row) => row.eventType === "PostPublished").length,
          0,
          `post ${id} must have no PostPublished row`
        );
      }
    });
  });

  describe("a promotion executed with no tenant scope", () => {
    it("refuses and writes nothing, rather than running unscoped", async () => {
      const postId = await harness.seedDraftPost("unscoped");

      const result = await harness.promotionUseCase.execute({
        postId,
        outcome: { channels: [{ channelId: harness.channelId, success: true }] },
      });

      assert.strictEqual(result.ok, false, "an unscoped promotion is refused");
      const snapshot = await harness.postSnapshot(postId);
      assert.strictEqual(snapshot.status, "DRAFT");
      assert.strictEqual(snapshot.publishedAt, null);
      assert.deepStrictEqual(await harness.outboxFor(postId), []);
    });
  });

  describe("a promotion running under one tenant, with a second tenant's post alongside it", () => {
    // R8's second clause. What this asserts is unreachability for WRITE: the
    // promoting transaction runs under account A's scope and the foreign row is
    // compared before and after. It does not attempt a cross-tenant READ inside
    // that transaction — the guard that refuses one is the Prisma `$extends`
    // tenant guard plus RLS, neither of which this suite composes differently,
    // and a read attempted from outside the transaction would prove something
    // else. Stated here rather than implied by a stronger-sounding name.
    it("leaves the foreign tenant's row and outbox exactly as they were", async () => {
      const foreignPostId = await harness.seedForeignTenantPost();
      const foreignBefore = await harness.postSnapshot(foreignPostId);
      assert.deepStrictEqual(
        await harness.outboxFor(foreignPostId),
        [],
        "the premise: the foreign post starts with no events of its own"
      );

      const postId = await harness.seedRecordedPost("cross-tenant");
      await harness.clobberPublicationWord(postId);
      const promoted = await harness.runScoped(() =>
        harness.promotionUseCase.execute({
          postId,
          outcome: { channels: [{ channelId: harness.channelId, success: true }] },
        })
      );
      assert.ok(promoted.ok, "the in-tenant promotion must succeed or the negative proves nothing");
      assert.strictEqual(
        promoted.value.applied,
        true,
        "and it must have WRITTEN, or 'the foreign row is untouched' is true of a transaction " +
          "that never opened"
      );

      assert.deepStrictEqual(
        await harness.postSnapshot(foreignPostId),
        foreignBefore,
        "status, version and publishedAt are byte-identical: the promoting transaction reached " +
          "no row outside its own tenant"
      );
      assert.deepStrictEqual(
        await harness.outboxFor(foreignPostId),
        [],
        "and it wrote no event against the foreign aggregate"
      );
    });
  });

  describe("a second publish-now for a post the first one published", () => {
    it("is rejected as a client error naming the status, and enqueues no new job", async () => {
      const { fastify } = await harness.boot();
      const postId = await harness.seedDraftPost("republish-guard");

      const start = async () =>
        await fastify.inject({
          method: "POST",
          url: "/sagas/post-publishing/start",
          headers: { authorization: `Bearer ${harness.accessToken}` },
          payload: {
            mode: "publish-now",
            projectId: harness.projectId,
            postId,
            channelIds: [harness.channelId],
          },
        });

      const first = await start();
      assert.strictEqual(first.statusCode, 200, `the first start must be accepted: ${first.body}`);
      harness.trackSaga((first.json() as { data: { sagaId: string } }).data.sagaId);
      assert.strictEqual(
        await harness.waitForTerminal((first.json() as { data: { sagaId: string } }).data.sagaId),
        "COMPLETED"
      );
      assert.strictEqual((await harness.postSnapshot(postId)).status, "PUBLISHED");

      const jobsAfterFirst = harness.queue.countFor(postId);
      assert.strictEqual(jobsAfterFirst, 1, "the first start enqueued exactly one publish job");

      const second = await start();

      assert.ok(
        second.statusCode >= 400 && second.statusCode < 500,
        `the second start must be a client error, got ${second.statusCode}: ${second.body}`
      );
      assert.match(
        second.body,
        /PUBLISHED/,
        "and the rejection names the status that makes the post ineligible"
      );
      // The harm this closes is a duplicate send to a provider, so the job
      // count is the assertion — a status code alone would not notice a
      // rejection that had already enqueued.
      assert.strictEqual(
        harness.queue.countFor(postId),
        jobsAfterFirst,
        "no publish job was enqueued by the rejected start"
      );
    });
  });
});
