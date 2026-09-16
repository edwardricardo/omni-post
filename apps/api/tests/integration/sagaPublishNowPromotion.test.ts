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
import {
  PublishNowPromotionHarness,
  type OutboxRow,
  type PostSnapshot,
} from "./helpers/publishNowPromotionHarness.js";

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
      assert.strictEqual(
        snapshot.version,
        1,
        "the seeded version advanced exactly once: one aggregate save, not two"
      );
    });

    it("commits both transition events to the outbox, keyed by the channels that published", () => {
      assert.deepStrictEqual(
        rows.map((row) => row.eventType),
        ["PostPublishingStarted", "PostPublished"],
        "both hops are recorded, in the order the state machine requires"
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

    before(async () => {
      postId = await harness.seedDraftPost("all-or-nothing");
      const useCase = harness.buildFailingPromotion();
      const result = await harness.runScoped(() =>
        useCase.execute({
          postId,
          outcome: { channels: [{ channelId: harness.channelId, success: true }] },
        })
      );
      failed = !result.ok;
    });

    it("returns an error Result rather than reporting a publication it did not commit", () => {
      assert.strictEqual(failed, true);
    });

    it("leaves the row exactly as it was, with no outbox row of either kind", async () => {
      const snapshot = await harness.postSnapshot(postId);
      assert.strictEqual(snapshot.status, "DRAFT");
      assert.strictEqual(snapshot.publishedAt, null);
      assert.strictEqual(snapshot.version, 0, "the version never advanced, so no update committed");
      assert.deepStrictEqual(
        await harness.outboxFor(postId),
        [],
        "and neither transition event survived: the whole transaction rolled back"
      );
    });
  });

  describe("a promotion applied twice", () => {
    let postId: string;
    let firstPublishedAt: Date | null;
    let secondAttemptStartedAt: Date;
    let secondApplied = true;

    before(async () => {
      postId = await harness.seedDraftPost("idempotent");
      const outcome = { channels: [{ channelId: harness.channelId, success: true }] };
      const first = await harness.runScoped(() =>
        harness.promotionUseCase.execute({ postId, outcome })
      );
      assert.ok(first.ok, "the first promotion must succeed or the retry proves nothing");
      firstPublishedAt = (await harness.postSnapshot(postId)).publishedAt;

      // The second attempt starts strictly AFTER the first timestamp, so an
      // overwrite would write a LATER value and be observable. Two identical
      // values cannot tell "preserved" from "overwritten with the same thing".
      await new Promise((resolve) => setTimeout(resolve, 25));
      secondAttemptStartedAt = new Date();
      const second = await harness.runScoped(() =>
        // The stale token is deliberate: the promotion advances the version
        // itself, so every retry presents one the first promotion outdated.
        // Ordering the version comparison first would fail a saga that in fact
        // completed, so the already-published answer resolves first.
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
      assert.strictEqual(snapshot.version, 1, "and no second save advanced the version");
    });

    it("writes no second event for the second application", async () => {
      const rows = await harness.outboxFor(postId);
      assert.deepStrictEqual(
        rows.map((row) => row.eventType),
        ["PostPublishingStarted", "PostPublished"],
        "exactly the first promotion's two rows: the retry emitted nothing"
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
