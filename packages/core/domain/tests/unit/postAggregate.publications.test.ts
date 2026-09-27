/**
 * @file postAggregate.publications.test.ts
 * @description Unit tests for the Post root's publication facet — declaring targets,
 *   opening episodes, recording per-channel attempts, the word derived from the record
 *   at every hop, and the content lock that reads the live-content predicate instead of
 *   the status word.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { PostAggregate } from "@core/domain/aggregates/PostAggregate.js";
import { ChannelPublication } from "@core/domain/entities/ChannelPublication.js";
import { ContentLockedError } from "@core/domain/errors/ContentLockedError.js";
import { InvalidStateTransitionError } from "@core/domain/errors/index.js";
import { PostId, ProjectId, ChannelId, MediaId } from "@core/domain/value-objects/EntityId.js";
import { Content } from "@core/domain/value-objects/Content.js";
import { PublishStatus, PUBLISH_STATUS } from "@core/domain/value-objects/PublishStatus.js";
import { FragmentReference } from "@core/domain/value-objects/FragmentReference.js";
import { ContentFingerprint } from "@core/domain/value-objects/ContentFingerprint.js";
import { providedReference } from "@core/domain/value-objects/ProviderReference.js";
import { CHANNEL_FAILURE_CODES } from "@core/domain/value-objects/ExclusionReason.js";
import {
  ATTEMPT_CLASSIFICATIONS,
  PUBLICATION_OUTCOME_KINDS,
  type AttemptResult,
} from "@core/domain/value-objects/PublicationOutcome.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const POST_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const CHANNEL_A = ChannelId.fromStringUnsafe("aa000000-0000-4000-8000-00000000000a");
const CHANNEL_B = ChannelId.fromStringUnsafe("aa000000-0000-4000-8000-00000000000b");
const CHANNEL_C = ChannelId.fromStringUnsafe("aa000000-0000-4000-8000-00000000000c");
const NOW = new Date("2026-03-01T09:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function makeFragment(index: number): FragmentReference {
  const result = FragmentReference.create({ index, externalId: `frag-${index}` });
  assert.ok(result.ok);
  return result.value;
}

function fingerprint(body = "hello"): ContentFingerprint {
  return ContentFingerprint.ofContent({ body, mediaIds: [] });
}

function makePost(options?: {
  status?: PublishStatus;
  publications?: ChannelPublication[];
  publishedAt?: Date;
}): PostAggregate {
  return PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(POST_ID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    accountId: ACCOUNT_ID,
    content: Content.reconstitute({ body: "hello", tags: [], locale: "en" }),
    status: options?.status ?? PublishStatus.draft(),
    ...(options?.publishedAt !== undefined && { publishedAt: options.publishedAt }),
    media: [],
    contentVersions: [],
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    version: 3,
    ...(options?.publications !== undefined && { publications: options.publications }),
  });
}

function published(fragmentCount = 1): AttemptResult {
  const head = providedReference("frag-1");
  assert.ok(head.ok);
  return {
    kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
    head: head.value,
    fragments: Array.from({ length: fragmentCount }, (_, i) => makeFragment(i + 1)),
    publishedAt: NOW,
    contentHash: fingerprint(),
  };
}

function failed(publishedFragments: readonly FragmentReference[] = []): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
    code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
    publishedFragments,
  };
}

/** A failure inside the budget: the channel stays unresolved and settles nothing. */
function transientFailure(): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
    code: CHANNEL_FAILURE_CODES.RENDER_FAILED,
    publishedFragments: [],
  };
}

/** A post whose targets are declared and whose first episode is open. */
function makeOpenedPost(channels: readonly ChannelId[] = [CHANNEL_A, CHANNEL_B]): PostAggregate {
  const post = makePost({ status: PublishStatus.scheduled() });
  const declared = post.declarePublicationTargets(channels);
  assert.ok(declared.ok, "the fixture declares its targets");
  const opened = post.openPublicationEpisode({ enterPublishing: false });
  assert.ok(opened.ok, "the fixture opens its first episode");
  post.clearDomainEvents();
  return post;
}

function recordAttempt(
  post: PostAggregate,
  channelId: ChannelId,
  result: AttemptResult,
  options?: { planSize?: number; attemptNo?: number }
): void {
  const applied = post.recordChannelAttempt({
    channelId,
    episode: 1,
    attemptNo: options?.attemptNo ?? 1,
    planSize: options?.planSize ?? 1,
    result,
    // Pinned so the action window a stranded fragment opens is anchored to the
    // fixture's clock rather than the wall clock the suite happens to run on.
    now: NOW,
  });
  assert.ok(applied.ok, "the fixture records its attempt");
}

function eventTypes(post: PostAggregate): string[] {
  return post.domainEvents.map((event) => event.eventType);
}

// ---------------------------------------------------------------------------

describe("PostAggregate — publication targets", () => {
  it("returns one unresolved record per intended channel and leaves the word untouched", () => {
    const post = makePost({ status: PublishStatus.scheduled() });

    const result = post.declarePublicationTargets([CHANNEL_A, CHANNEL_B]);

    assert.ok(result.ok);
    assert.strictEqual(post.publications.size, 2);
    assert.strictEqual(post.publications.derive(), PUBLISH_STATUS.PUBLISHING);
    assert.strictEqual(post.status.value, PUBLISH_STATUS.SCHEDULED, "the word is untouched");
    assert.strictEqual(post.publications.find(CHANNEL_A)?.episode, 0);
  });

  it("returns the same recorded set when the same targets are declared again", () => {
    const post = makePost({ status: PublishStatus.scheduled() });
    assert.ok(post.declarePublicationTargets([CHANNEL_A, CHANNEL_B]).ok);

    const again = post.declarePublicationTargets([CHANNEL_B, CHANNEL_A]);

    assert.ok(again.ok);
    assert.strictEqual(post.publications.size, 2);
  });

  it("returns a replaced target set while nothing is live", () => {
    const post = makePost({ status: PublishStatus.scheduled() });
    assert.ok(post.declarePublicationTargets([CHANNEL_A, CHANNEL_B]).ok);

    const replaced = post.declarePublicationTargets([CHANNEL_C]);

    assert.ok(replaced.ok);
    assert.strictEqual(post.publications.size, 1);
    assert.ok(post.publications.has(CHANNEL_C));
  });

  it("returns an error when the target set is replaced over live content", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, published());

    const replaced = post.declarePublicationTargets([CHANNEL_C]);

    assert.ok(!replaced.ok);
    assert.ok(post.publications.has(CHANNEL_A), "the recorded set is not silently replaced");
  });
});

describe("PostAggregate — opening an episode", () => {
  it("returns every channel opened on episode one and enters PUBLISHING when asked", () => {
    const post = makePost({ status: PublishStatus.scheduled() });
    assert.ok(post.declarePublicationTargets([CHANNEL_A, CHANNEL_B]).ok);

    const opened = post.openPublicationEpisode({ enterPublishing: true });

    assert.ok(opened.ok);
    assert.strictEqual(opened.value.alreadyOpen, false);
    assert.deepStrictEqual(
      opened.value.opened.map((entry) => entry.episode),
      [1, 1]
    );
    assert.strictEqual(post.status.value, PUBLISH_STATUS.PUBLISHING);
    assert.ok(eventTypes(post).includes("PostPublishingStarted"));
  });

  it("returns alreadyOpen when the same episode is opened twice with no attempt between", () => {
    const post = makeOpenedPost();

    const again = post.openPublicationEpisode({ enterPublishing: false });

    assert.ok(again.ok);
    assert.strictEqual(again.value.alreadyOpen, true);
    assert.strictEqual(post.publications.find(CHANNEL_A)?.episode, 1);
  });

  it("returns only the channels that may be attempted again", () => {
    const post = makeOpenedPost();
    recordAttempt(post, CHANNEL_A, published());
    recordAttempt(post, CHANNEL_B, failed());

    const opened = post.openPublicationEpisode({ enterPublishing: true });

    assert.ok(opened.ok);
    assert.deepStrictEqual(
      opened.value.opened.map((entry) => entry.channelId.value),
      [CHANNEL_B.value]
    );
    assert.strictEqual(post.publications.find(CHANNEL_B)?.episode, 2);
    assert.strictEqual(
      post.publications.find(CHANNEL_A)?.episode,
      1,
      "a published channel is untouched"
    );
  });

  it("returns an error naming the live fragments when a named channel is pending retraction", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed([makeFragment(1), makeFragment(2)]), { planSize: 3 });

    const opened = post.openPublicationEpisode({
      channelIds: [CHANNEL_A],
      enterPublishing: true,
    });

    assert.ok(!opened.ok);
    assert.match(opened.error.message, /CHANNEL_HAS_LIVE_FRAGMENTS/);
    assert.match(opened.error.message, /frag-1/);
    assert.match(opened.error.message, /frag-2/);
  });

  it("returns an error when a named channel is outside the recorded set", () => {
    const post = makeOpenedPost([CHANNEL_A]);

    const opened = post.openPublicationEpisode({ channelIds: [CHANNEL_C], enterPublishing: true });

    assert.ok(!opened.ok);
    assert.match(opened.error.message, new RegExp(CHANNEL_C.value));
  });

  it("returns an error when nothing is redrivable", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, published());

    const opened = post.openPublicationEpisode({ enterPublishing: true });

    assert.ok(!opened.ok);
  });

  it("returns an error when an episode opens without publishing over a settled word", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed());
    assert.strictEqual(post.status.value, PUBLISH_STATUS.FAILED);

    const opened = post.openPublicationEpisode({ enterPublishing: false });

    assert.ok(!opened.ok);
    assert.ok(opened.error instanceof InvalidStateTransitionError);
  });
});

describe("PostAggregate — the word follows the record", () => {
  it("returns PUBLISHING on the first recorded attempt of a scheduled post", () => {
    const post = makeOpenedPost();

    recordAttempt(post, CHANNEL_A, published());

    assert.strictEqual(post.status.value, PUBLISH_STATUS.PUBLISHING);
    assert.ok(eventTypes(post).includes("PostPublishingStarted"));
  });

  it("returns PUBLISHED with publishedAt set once every channel published", () => {
    const post = makeOpenedPost();

    recordAttempt(post, CHANNEL_A, published());
    recordAttempt(post, CHANNEL_B, published());

    assert.strictEqual(post.status.value, PUBLISH_STATUS.PUBLISHED);
    assert.ok(post.publishedAt !== undefined);
    assert.strictEqual(eventTypes(post).filter((type) => type === "PostPublished").length, 1);
  });

  it("returns PARTIALLY_PUBLISHED with a null publishedAt and no published event", () => {
    const post = makeOpenedPost();

    recordAttempt(post, CHANNEL_A, published());
    recordAttempt(post, CHANNEL_B, failed());

    assert.strictEqual(post.status.value, PUBLISH_STATUS.PARTIALLY_PUBLISHED);
    assert.strictEqual(post.publishedAt, undefined);
    assert.ok(!eventTypes(post).includes("PostPublished"));
  });

  it("returns FAILED with the v1 failure event when no channel published", () => {
    const post = makeOpenedPost();

    recordAttempt(post, CHANNEL_A, failed());
    recordAttempt(post, CHANNEL_B, failed());

    assert.strictEqual(post.status.value, PUBLISH_STATUS.FAILED);
    const failure = post.domainEvents.find((event) => event.eventType === "PostPublishingFailed");
    assert.ok(failure !== undefined);
    assert.deepStrictEqual(Object.keys(failure.toPayload()).sort(), [
      "error",
      "failedProviders",
      "postId",
      "retryable",
    ]);
    assert.strictEqual(
      (failure.toPayload() as { error: string }).error,
      CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED
    );
    assert.strictEqual((failure.toPayload() as { retryable: boolean }).retryable, true);
  });

  it("returns the v1 published payload keyed by channel and built from the record", () => {
    const post = makeOpenedPost([CHANNEL_A]);

    recordAttempt(post, CHANNEL_A, published());

    const event = post.domainEvents.find((each) => each.eventType === "PostPublished");
    assert.ok(event !== undefined);
    assert.deepStrictEqual(event.toPayload(), {
      postId: POST_ID,
      publishedAt: post.publishedAt?.toISOString(),
      providerResults: { [CHANNEL_A.value]: { success: true, externalId: "frag-1" } },
    });
  });

  it("returns a channel-keyed event for each recorded outcome", () => {
    const post = makeOpenedPost();

    recordAttempt(post, CHANNEL_A, published());
    recordAttempt(post, CHANNEL_B, failed());

    assert.ok(eventTypes(post).includes("PostChannelPublished"));
    assert.ok(eventTypes(post).includes("PostChannelExcluded"));
  });

  it("returns no channel outcome event when the attempt left the channel unresolved", () => {
    const post = makeOpenedPost([CHANNEL_A]);

    recordAttempt(post, CHANNEL_A, transientFailure());

    assert.ok(
      !eventTypes(post).includes("PostChannelExcluded"),
      "an unresolved channel has no outcome to announce and must not be reported as excluded"
    );
    assert.ok(!eventTypes(post).includes("PostChannelPublished"));
  });

  it("returns no exclusion event for a channel whose earlier exclusion was superseded", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed());
    post.clearDomainEvents();

    recordAttempt(post, CHANNEL_A, transientFailure(), { attemptNo: 2 });

    assert.ok(
      !eventTypes(post).includes("PostChannelExcluded"),
      "the channel is unresolved again, so the stale reason must not be re-announced"
    );
  });

  it("returns an error and emits nothing when an attempt lands on a channel with live content", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, published());
    const wordAfterPublish = post.status.value;
    post.clearDomainEvents();

    const second = post.recordChannelAttempt({
      channelId: CHANNEL_A,
      episode: 1,
      attemptNo: 2,
      planSize: 1,
      result: transientFailure(),
      now: NOW,
    });

    assert.ok(!second.ok, "the record refuses it and the refusal reaches the root");
    assert.strictEqual(post.status.value, wordAfterPublish, "the word does not move");
    assert.deepStrictEqual(eventTypes(post), [], "nothing is announced for an attempt not taken");
  });

  it("returns the recorded publication moment on the channel event, never the current time", () => {
    const post = makeOpenedPost([CHANNEL_A]);

    recordAttempt(post, CHANNEL_A, published());

    const event = post.domainEvents.find((each) => each.eventType === "PostChannelPublished");
    assert.ok(event !== undefined);
    const payload = event.toPayload() as { publishedAt: string; contentHash: string };
    assert.strictEqual(payload.publishedAt, NOW.toISOString());
    assert.strictEqual(payload.contentHash, fingerprint().value);
  });

  it("returns an alert event naming the fragments when a thread strands content", () => {
    const post = makeOpenedPost([CHANNEL_A]);

    recordAttempt(post, CHANNEL_A, failed([makeFragment(1)]), { planSize: 2 });

    const alert = post.domainEvents.find(
      (event) => event.eventType === "PostChannelRetractionAlertRaised"
    );
    assert.ok(alert !== undefined);
    const payload = alert.toPayload() as {
      channelId: string;
      liveFragments: { externalId: string }[];
      alertKey: string;
    };
    assert.strictEqual(payload.channelId, CHANNEL_A.value);
    assert.deepStrictEqual(
      payload.liveFragments.map((fragment) => fragment.externalId),
      ["frag-1"]
    );
    assert.ok(payload.alertKey.startsWith(`${POST_ID}:${CHANNEL_A.value}:`));
  });

  it("returns an error when the attempt names a channel outside the recorded set", () => {
    const post = makeOpenedPost([CHANNEL_A]);

    const result = post.recordChannelAttempt({
      channelId: CHANNEL_C,
      episode: 1,
      attemptNo: 1,
      planSize: 1,
      result: published(),
    });

    assert.ok(!result.ok);
  });

  it("returns applied false on a replayed attempt and emits nothing", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed(), { attemptNo: 1 });
    post.clearDomainEvents();

    const replay = post.recordChannelAttempt({
      channelId: CHANNEL_A,
      episode: 1,
      attemptNo: 1,
      planSize: 1,
      result: published(),
    });

    assert.ok(replay.ok);
    assert.strictEqual(replay.value.applied, false);
    assert.deepStrictEqual(eventTypes(post), []);
  });

  it("returns changed false when the word already matches the record", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, published());

    const reconciled = post.reconcilePublicationProjection();

    assert.ok(reconciled.ok);
    assert.strictEqual(reconciled.value.changed, false);
  });

  it("returns changed true and repairs a word that was clobbered under the record", () => {
    const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
    recordAttempt(post, CHANNEL_A, published());
    recordAttempt(post, CHANNEL_B, failed());
    const clobbered = makePost({
      status: PublishStatus.published(),
      publications: [...post.publications.all],
    });

    const reconciled = clobbered.reconcilePublicationProjection();

    assert.ok(reconciled.ok);
    assert.strictEqual(reconciled.value.changed, true);
    assert.strictEqual(clobbered.status.value, PUBLISH_STATUS.PARTIALLY_PUBLISHED);
  });
});

describe("PostAggregate — the content lock", () => {
  it("returns an editable post while its targets are only declared", () => {
    const post = makePost({ status: PublishStatus.draft() });
    assert.ok(post.declarePublicationTargets([CHANNEL_A, CHANNEL_B]).ok);

    const updated = post.updateContent({ body: "rewritten" });

    assert.ok(updated.ok);
    assert.ok(post.isEditable);
  });

  it("returns an editable post when every channel failed with nothing live", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed());
    assert.strictEqual(post.status.value, PUBLISH_STATUS.FAILED);

    const updated = post.updateContent({ body: "rewritten" });

    assert.ok(updated.ok);
  });

  it("returns a lifecycle refusal while publishing is in flight", () => {
    const post = makeOpenedPost();
    recordAttempt(post, CHANNEL_A, published());
    assert.strictEqual(post.status.value, PUBLISH_STATUS.PUBLISHING);

    const updated = post.updateContent({ body: "rewritten" });

    assert.ok(!updated.ok);
    assert.ok(
      updated.error instanceof ContentLockedError,
      "a published channel locks the content whatever the word says"
    );
  });

  it("returns a LOCK refusal, not a lifecycle refusal, for a FAILED post with live fragments", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed([makeFragment(1)]), { planSize: 2 });
    assert.strictEqual(post.status.value, PUBLISH_STATUS.FAILED);
    assert.ok(post.status.isEditable(), "the WORD says editable — the record does not");

    const updated = post.updateContent({ body: "rewritten" });

    assert.ok(!updated.ok);
    assert.ok(updated.error instanceof ContentLockedError);
    assert.ok(!(updated.error instanceof InvalidStateTransitionError));
    const locked = updated.error;
    assert.strictEqual(locked.channelId, CHANNEL_A.value);
    assert.deepStrictEqual(
      locked.fragments.map((fragment) => fragment.externalId),
      ["frag-1"]
    );
  });

  it("returns a LOCK refusal even after the action window expired", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed([makeFragment(1)]), { planSize: 2 });
    const expired = post.expireRetractionActionWindow({
      channelId: CHANNEL_A,
      now: new Date(NOW.getTime() + 100 * HOUR_MS),
      window: 72 * HOUR_MS,
    });
    assert.ok(expired.ok);
    assert.strictEqual(expired.value.applied, true);

    const updated = post.updateContent({ body: "rewritten" });

    assert.ok(!updated.ok);
    assert.ok(updated.error instanceof ContentLockedError);
    assert.ok(!post.isEditable);
  });

  it("returns a refusal from EVERY content-write door", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, published());

    const updated = post.updateContent({ body: "rewritten" });
    const added = post.addMedia({
      id: MediaId.generate(),
      type: "image",
      url: "https://example.com/i.jpg",
    });
    const removed = post.removeMedia(MediaId.generate());

    assert.ok(!updated.ok && updated.error instanceof ContentLockedError);
    assert.ok(!added.ok && added.error instanceof ContentLockedError);
    assert.ok(!removed.ok && removed.error instanceof ContentLockedError);
  });

  it("returns a refusal for the lifecycle exits while content is live", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed([makeFragment(1)]), { planSize: 2 });

    const cancelled = post.cancel("no longer wanted");
    const unscheduled = post.unschedule();

    assert.ok(!cancelled.ok && cancelled.error instanceof ContentLockedError);
    assert.ok(!unscheduled.ok && unscheduled.error instanceof ContentLockedError);
  });

  it("returns an editable post again once the customer confirms the removal", () => {
    const post = makeOpenedPost([CHANNEL_A]);
    recordAttempt(post, CHANNEL_A, failed([makeFragment(1)]), { planSize: 2 });

    const cleared = post.clearPendingRetraction({
      channelId: CHANNEL_A,
      cause: "manually-removed",
    });

    assert.ok(cleared.ok);
    assert.strictEqual(cleared.value.applied, true);
    assert.ok(post.isEditable);
    assert.ok(post.updateContent({ body: "rewritten" }).ok);
    assert.ok(
      eventTypes(post).includes("PostChannelRetractionAlertResolved"),
      "the alert that named those fragments is resolved in the same act"
    );
  });
});

describe("PostAggregate — the content fingerprint", () => {
  it("returns the same fingerprint on two channels published from the same locked content", () => {
    const post = makeOpenedPost();

    recordAttempt(post, CHANNEL_A, published());
    recordAttempt(post, CHANNEL_B, published());

    const a = post.publications.find(CHANNEL_A)?.contentHash;
    const b = post.publications.find(CHANNEL_B)?.contentHash;
    assert.ok(a !== undefined && b !== undefined);
    assert.ok(a.equals(b));
    assert.strictEqual(a.value, fingerprint().value);
  });

  it("returns a redrive decision that depends on the outcome and never on the fingerprint", () => {
    const post = makeOpenedPost();
    recordAttempt(post, CHANNEL_A, published());
    recordAttempt(post, CHANNEL_B, failed());

    const redrivable = post.publications.redrivable().map((record) => record.channelId.value);

    assert.deepStrictEqual(redrivable, [CHANNEL_B.value]);
    assert.strictEqual(
      post.publications.find(CHANNEL_B)?.contentHash,
      undefined,
      "an unpublished channel carries no fingerprint, and the decision did not need one"
    );
  });
});
