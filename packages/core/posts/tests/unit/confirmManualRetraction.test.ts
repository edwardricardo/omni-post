/**
 * @file confirmManualRetraction.test.ts
 * @description Unit tests for the customer's exit from a stranded channel: the act that
 *              records "I removed those fragments myself". It is the only exit while no
 *              provider can retract, so its refusals matter as much as its success — a
 *              channel that was never pending must not read as a successful confirmation,
 *              a redelivered submit must not spend a row version, and the act must still
 *              work after the action window closed, because expiry fixes the OUTCOME and
 *              never the content. Doubles are of the PORTS, never of the use case.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err, type Result } from "@shared/types";
import {
  PostAggregate,
  PostId,
  ProjectId,
  ChannelId,
  Content,
  PublishStatus,
  ChannelPublication,
  FragmentReference,
  InvariantViolationError,
  VersionConflictError,
  EntityNotFoundError,
  ContentFingerprint,
  providedReference,
  CHANNEL_FAILURE_CODES,
  CHANNEL_RETRACTION_CLEARANCES,
  ATTEMPT_CLASSIFICATIONS,
  PUBLICATION_OUTCOME_KINDS,
  type AttemptResult,
  type PostRepository,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ConfirmManualRetractionUseCase } from "../../src/ConfirmManualRetractionUseCase.js";
import {
  RETRACTION_REFUSALS,
  RetractionRefusalError,
  refusalOf,
} from "../../src/retractionRefusals.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POST_UUID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_UUID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_UUID = "a0000000-0000-4000-8000-000000000001";
const CHANNEL_A = "aa000000-0000-4000-8000-00000000000a";
const CHANNEL_UNKNOWN = "aa000000-0000-4000-8000-00000000000f";
const STRANDED_AT = new Date("2026-03-01T09:00:00.000Z");
const CONFIRMED_AT = new Date("2026-03-01T11:00:00.000Z");
const ONE_HOUR_MS = 60 * 60 * 1000;

function channelId(value: string): ChannelId {
  return ChannelId.fromStringUnsafe(value);
}

function makeFragment(index: number): FragmentReference {
  const result = FragmentReference.create({ index, externalId: `frag-${index}` });
  assert.ok(result.ok, "the fixture fragment must build");
  return result.value;
}

function makePost(options?: { publications?: ChannelPublication[] }): PostAggregate {
  return PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(POST_UUID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_UUID),
    accountId: ACCOUNT_UUID,
    content: Content.reconstitute({ body: "hello", tags: [], locale: "en" }),
    status: PublishStatus.scheduled(),
    media: [],
    contentVersions: [],
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    version: 3,
    ...(options?.publications !== undefined && { publications: options.publications }),
  });
}

/** An interrupted thread: one fragment went out, the attempt then failed. */
function strandingFailure(): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
    code: CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED,
    publishedFragments: [makeFragment(1)],
  };
}

/** A post whose only channel holds one live fragment and is pending retraction. */
function makeStrandedPost(): PostAggregate {
  const post = makePost();
  const declared = post.declarePublicationTargets([channelId(CHANNEL_A)]);
  assert.ok(declared.ok, "the fixture declares its target");
  const opened = post.openPublicationEpisode({ enterPublishing: false });
  assert.ok(opened.ok, "the fixture opens its first episode");
  const recorded = post.recordChannelAttempt({
    channelId: channelId(CHANNEL_A),
    episode: 1,
    attemptNo: 1,
    planSize: 2,
    result: strandingFailure(),
    now: STRANDED_AT,
  });
  assert.ok(recorded.ok, "the fixture strands its channel");
  const record = post.publications.find(channelId(CHANNEL_A));
  assert.ok(record?.pendingRetraction, "the fixture leaves the channel pending retraction");
  post.clearDomainEvents();
  return post;
}

/** A post whose only channel is declared and open, with no attempt recorded yet. */
function makeUnresolvedPost(): PostAggregate {
  const post = makePost();
  const declared = post.declarePublicationTargets([channelId(CHANNEL_A)]);
  assert.ok(declared.ok, "the fixture declares its target");
  const opened = post.openPublicationEpisode({ enterPublishing: false });
  assert.ok(opened.ok, "the fixture opens its first episode");
  post.clearDomainEvents();
  return post;
}

/** A post whose only channel published cleanly, through a real recorded attempt. */
function makePublishedPost(): PostAggregate {
  const post = makeUnresolvedPost();
  const head = providedReference("frag-1");
  assert.ok(head.ok, "the fixture head reference must build");
  const recorded = post.recordChannelAttempt({
    channelId: channelId(CHANNEL_A),
    episode: 1,
    attemptNo: 1,
    planSize: 1,
    result: {
      kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
      head: head.value,
      fragments: [makeFragment(1)],
      publishedAt: STRANDED_AT,
      contentHash: ContentFingerprint.ofContent({ body: "hello", mediaIds: [] }),
    },
    now: STRANDED_AT,
  });
  assert.ok(recorded.ok, "the fixture publishes its channel");
  assert.strictEqual(
    post.publications.find(channelId(CHANNEL_A))?.isPublished(),
    true,
    "the fixture is PUBLISHED, not merely unresolved"
  );
  post.clearDomainEvents();
  return post;
}

// ---------------------------------------------------------------------------
// Port doubles
// ---------------------------------------------------------------------------

/**
 * The edit events the production narrow save refuses to carry
 * (`PUBLICATION_TRIPWIRE_EVENTS`, `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`).
 * Named here rather than imported because `@core/posts` does not depend on the adapter
 * package; the relocation that would let both sides share one definition is owned by
 * the unit that next touches that set.
 */
const TRIPWIRE_EVENTS = ["PostContentUpdated", "PostMediaAdded", "PostMediaRemoved"];

interface MockPostRepo {
  port: PostRepository;
  findById: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  savePublication: ReturnType<typeof vi.fn>;
}

function makePostRepo(options?: {
  post?: PostAggregate;
  findByIdResult?: Result<PostAggregate, EntityNotFoundError>;
  saveResult?: Result<void, Error>;
}): MockPostRepo {
  const findById = vi.fn(async () => options?.findByIdResult ?? ok(options?.post ?? makePost()));
  const save = vi.fn(async () => options?.saveResult ?? ok(undefined));
  const savePublication = vi.fn(async (aggregate: PostAggregate) => {
    const pendingEdit = aggregate.domainEvents.find((event) =>
      TRIPWIRE_EVENTS.includes(event.eventType)
    );
    if (pendingEdit !== undefined) {
      return err(
        new InvariantViolationError(
          `post ${aggregate.id.value} carries a pending ${pendingEdit.eventType} event: a publication save writes no content, so the edit would be lost`
        )
      );
    }
    const result = options?.saveResult ?? ok(undefined);
    if (result.ok) {
      aggregate.incrementVersion();
    }
    return result;
  });
  const port = {
    findById,
    save,
    savePublication,
    delete: vi.fn(),
    exists: vi.fn(),
  } as unknown as PostRepository;
  return { port, findById, save, savePublication };
}

interface RecordingUow extends UnitOfWork {
  calls: number;
  resultErrors: unknown[];
}

function makeRecordingUow(): RecordingUow {
  return {
    calls: 0,
    resultErrors: [],
    async executeInTransaction<T>(fn: () => Promise<T>): Promise<T> {
      this.calls++;
      return fn();
    },
    async executeResultInTransaction<T, E>(fn: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
      this.calls++;
      const result = await fn();
      if (!result.ok) {
        this.resultErrors.push(result.error);
      }
      return result;
    },
  };
}

function confirmInput(overrides?: { postId?: string; channelId?: string }): {
  postId: string;
  channelId: string;
  now: Date;
} {
  return {
    postId: overrides?.postId ?? POST_UUID,
    channelId: overrides?.channelId ?? CHANNEL_A,
    now: CONFIRMED_AT,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("refusalOf", () => {
  // Iterates the DECLARED set instead of naming a member. A case that named
  // `NOTHING_PENDING` would pass forever while a second member added to
  // `RETRACTION_REFUSALS` came back `undefined` — the silent miss the discriminator
  // exists to prevent, one level up.
  for (const refusal of Object.values(RETRACTION_REFUSALS)) {
    it(`recognises the declared refusal ${refusal}`, () => {
      const error = new RetractionRefusalError("any message", refusal);

      assert.strictEqual(refusalOf(error), refusal);
    });
  }

  it("answers undefined for an error carrying no discriminator", () => {
    assert.strictEqual(refusalOf(new Error("plain")), undefined);
  });

  it("answers undefined for an error carrying an unknown discriminator", () => {
    const impostor = Object.assign(new Error("forged"), { refusal: "NOT_A_REFUSAL" });

    assert.strictEqual(refusalOf(impostor), undefined);
  });
});

describe("ConfirmManualRetractionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pure refusals — decided before any I/O", () => {
    it("returns VALIDATION_FAILED for an invalid post id without loading anything", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();
      const useCase = new ConfirmManualRetractionUseCase(repo.port, uow);

      const result = await useCase.execute(confirmInput({ postId: "not-a-uuid" }));

      assert.ok(!result.ok, "an invalid id is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
      assert.strictEqual(
        uow.calls,
        0,
        "no transaction is opened for a refusal that needs no state"
      );
    });

    it("returns VALIDATION_FAILED for an invalid channel id without loading anything", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();
      const useCase = new ConfirmManualRetractionUseCase(repo.port, uow);

      const result = await useCase.execute(confirmInput({ channelId: "not-a-uuid" }));

      assert.ok(!result.ok, "an invalid channel id is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(uow.calls, 0);
    });
  });

  describe("the confirmation", () => {
    it("clears the pending retraction and records the cause the customer's act carries", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(confirmInput());

      assert.ok(result.ok, "the confirmation is recorded");
      assert.strictEqual(result.value.applied, true);
      const record = post.publications.find(channelId(CHANNEL_A));
      assert.ok(record, "the record survives the act");
      assert.strictEqual(record.pendingRetraction, false, "nothing is pending any more");
      assert.deepStrictEqual(record.liveFragments, [], "the live set is emptied");
      assert.strictEqual(
        record.retractionClearedCause,
        CHANNEL_RETRACTION_CLEARANCES.MANUALLY_REMOVED,
        "the clearance names WHO removed the fragments, not merely THAT they are gone"
      );
      assert.deepStrictEqual(record.retractionClearedAt, CONFIRMED_AT);
      assert.strictEqual(result.value.hasLiveContent, false, "the content lock releases");
      assert.strictEqual(repo.savePublication.mock.calls.length, 1, "the NARROW save is used");
      assert.strictEqual(repo.save.mock.calls.length, 0, "the full save is never used");
      assert.strictEqual(post.domainEvents.length, 0, "the outbox owns the events after the save");
    });

    it("leaves the channel re-drivable once nothing is live on it", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(confirmInput());

      assert.ok(result.ok);
      const record = post.publications.find(channelId(CHANNEL_A));
      assert.strictEqual(record?.redrivable(), true, "the exit is what re-opens the retry path");
    });

    it("still applies AFTER the action window expired (Q17)", async () => {
      const post = makeStrandedPost();
      const expired = post.expireRetractionActionWindow({
        channelId: channelId(CHANNEL_A),
        now: new Date(STRANDED_AT.getTime() + ONE_HOUR_MS),
        window: ONE_HOUR_MS,
      });
      assert.ok(expired.ok && expired.value.applied, "the fixture closes the window first");
      post.clearDomainEvents();
      const repo = makePostRepo({ post });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(confirmInput());

      assert.ok(result.ok, "an expired window closes the alert, never the exit");
      assert.strictEqual(result.value.applied, true);
      const record = post.publications.find(channelId(CHANNEL_A));
      assert.strictEqual(record?.pendingRetraction, false);
      assert.deepStrictEqual(record?.liveFragments, []);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });
  });

  describe("the refusals that need the record", () => {
    it("returns NOT_FOUND when the post does not load", async () => {
      const repo = makePostRepo({
        findByIdResult: err(new EntityNotFoundError("Post", POST_UUID)),
      });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(confirmInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("returns NOT_FOUND for a channel outside the recorded set", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(confirmInput({ channelId: CHANNEL_UNKNOWN }));

      assert.ok(!result.ok, "the post never declared that channel");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("refuses NOTHING_PENDING as a conflict a caller can identify without matching the message", async () => {
      const post = makePublishedPost();
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new ConfirmManualRetractionUseCase(repo.port, uow);

      const result = await useCase.execute(confirmInput());

      assert.ok(!result.ok, "a channel that published cleanly has no retraction to confirm");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(
        refusalOf(result.error),
        RETRACTION_REFUSALS.NOTHING_PENDING,
        "the route switches on the discriminator, never on the message prefix"
      );
      assert.strictEqual(repo.savePublication.mock.calls.length, 0, "a refusal writes nothing");
      assert.strictEqual(uow.resultErrors.length, 1, "the refusal aborts the transaction");
    });

    it("refuses NOTHING_PENDING on a channel that has not been attempted yet", async () => {
      const repo = makePostRepo({ post: makeUnresolvedPost() });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(confirmInput());

      assert.ok(!result.ok);
      assert.strictEqual(refusalOf(result.error), RETRACTION_REFUSALS.NOTHING_PENDING);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("refuses a confirmation of a channel a RETRACTION already cleared", async () => {
      // The stated cost of scoping idempotency to the customer's OWN act: a channel
      // whose fragments another mechanism retracted answers 409 rather than a silent
      // 200. It is asserted rather than only written down, because the alternative
      // reading — "nothing pending, so report success" — is the one that would tell a
      // customer their confirmation was recorded when no record holds it. The path has
      // no production caller in this change; the case is the pin for the one that adds it.
      const post = makeStrandedPost();
      const retracted = post.markRetractionOutcome({
        channelId: channelId(CHANNEL_A),
        outcome: "retracted",
        remaining: [],
        now: CONFIRMED_AT,
      });
      assert.ok(retracted.ok, "the fixture retracts the fragments by another mechanism");
      assert.strictEqual(
        post.publications.find(channelId(CHANNEL_A))?.retractionClearedCause,
        CHANNEL_RETRACTION_CLEARANCES.RETRACTED,
        "the clearance is NOT the customer's act"
      );
      post.clearDomainEvents();
      const repo = makePostRepo({ post });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(confirmInput());

      assert.ok(!result.ok, "a clearance nobody's confirmation produced is not a duplicate");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(refusalOf(result.error), RETRACTION_REFUSALS.NOTHING_PENDING);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("refuses a confirmation of a channel RE-DRIVEN since the customer cleared it", async () => {
      // REC-12: clearing the live set makes the channel re-drivable, so a new episode
      // can open over it. The idempotency answer must be scoped to the episode that was
      // actually confirmed — otherwise the customer confirms a removal on a channel
      // that has nothing live, and is told it worked.
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());
      const first = await useCase.execute(confirmInput());
      assert.ok(first.ok && first.value.applied, "the fixture confirms the removal first");
      // publish-now, because the derived word after the stranding is FAILED and a
      // delayed re-drive of a FAILED post is refused by the aggregate (D9 / Q14).
      const reopened = post.openPublicationEpisode({ enterPublishing: true });
      assert.ok(reopened.ok, "the cleared channel is re-drivable through publish-now");
      post.clearDomainEvents();

      const second = await useCase.execute(confirmInput());

      assert.ok(!second.ok, "there is nothing live on the re-driven channel to confirm");
      assert.strictEqual(second.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(refusalOf(second.error), RETRACTION_REFUSALS.NOTHING_PENDING);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1, "only the first act wrote");
    });

    it("answers a duplicate submit with applied:false and writes nothing a second time", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const first = await useCase.execute(confirmInput());
      assert.ok(first.ok && first.value.applied, "the first submit clears the channel");

      const second = await useCase.execute(confirmInput());

      assert.ok(second.ok, "a redelivered submit is idempotent, not an error");
      assert.strictEqual(second.value.applied, false);
      assert.strictEqual(
        repo.savePublication.mock.calls.length,
        1,
        "the second submit spends no row version on work the record already accounts for"
      );
    });
  });

  describe("the save", () => {
    it("translates a lost compare-and-swap into a CONFLICT and rolls the transaction back", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({
        post,
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const uow = makeRecordingUow();
      const useCase = new ConfirmManualRetractionUseCase(repo.port, uow);

      const result = await useCase.execute(confirmInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(uow.resultErrors.length, 1, "the err reaches the seam that rolls back");
    });

    it("translates any other save failure into an INTERNAL_ERROR", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({ post, saveResult: err(new Error("connection reset")) });
      const useCase = new ConfirmManualRetractionUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(confirmInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });

  describe("without a unit of work — the optional seam the composition root always injects", () => {
    it("answers a domain refusal exactly as the transactional path does, and writes nothing", async () => {
      const post = makePublishedPost();
      const repo = makePostRepo({ post });
      const useCase = new ConfirmManualRetractionUseCase(repo.port);

      const result = await useCase.execute(confirmInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(refusalOf(result.error), RETRACTION_REFUSALS.NOTHING_PENDING);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("answers a save failure exactly as the transactional path does", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({
        post,
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const useCase = new ConfirmManualRetractionUseCase(repo.port);

      const result = await useCase.execute(confirmInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
    });
  });
});
