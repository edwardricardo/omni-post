/**
 * @file recordChannelPublicationAttempt.test.ts
 * @description Unit tests for the writer that records ONE attempt on ONE channel: the
 *              refusals that reach the caller as a conflict (a stale or unopened episode),
 *              the redelivered ordinal that applies nothing and writes nothing, the
 *              compare-and-swap that loses, the edit tripwire the narrow save carries, and
 *              the rule that every `err` leaves the transaction rolled back. Doubles are of
 *              the PORTS, never of the use case under test.
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
  ContentFingerprint,
  InvariantViolationError,
  VersionConflictError,
  EntityNotFoundError,
  providedReference,
  CHANNEL_FAILURE_CODES,
  ATTEMPT_CLASSIFICATIONS,
  PUBLICATION_OUTCOME_KINDS,
  type AttemptResult,
  type PostRepository,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { RecordChannelPublicationAttemptUseCase } from "../../src/RecordChannelPublicationAttemptUseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POST_UUID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_UUID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_UUID = "a0000000-0000-4000-8000-000000000001";
const CHANNEL_A = "aa000000-0000-4000-8000-00000000000a";
const CHANNEL_B = "aa000000-0000-4000-8000-00000000000b";
const CHANNEL_UNKNOWN = "aa000000-0000-4000-8000-00000000000f";
const NOW = new Date("2026-03-01T09:00:00.000Z");

function channelId(value: string): ChannelId {
  return ChannelId.fromStringUnsafe(value);
}

function makeFragment(index: number): FragmentReference {
  const result = FragmentReference.create({ index, externalId: `frag-${index}` });
  assert.ok(result.ok, "the fixture fragment must build");
  return result.value;
}

function makePost(options?: {
  status?: PublishStatus;
  publications?: ChannelPublication[];
}): PostAggregate {
  return PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(POST_UUID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_UUID),
    accountId: ACCOUNT_UUID,
    content: Content.reconstitute({ body: "hello", tags: [], locale: "en" }),
    status: options?.status ?? PublishStatus.scheduled(),
    media: [],
    contentVersions: [],
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    version: 3,
    ...(options?.publications !== undefined && { publications: options.publications }),
  });
}

/** A post whose targets are declared and whose first episode is open, with no attempt yet. */
function makeOpenedPost(channels: readonly string[] = [CHANNEL_A, CHANNEL_B]): PostAggregate {
  const post = makePost();
  const declared = post.declarePublicationTargets(channels.map(channelId));
  assert.ok(declared.ok, "the fixture declares its targets");
  const opened = post.openPublicationEpisode({ enterPublishing: false });
  assert.ok(opened.ok, "the fixture opens its first episode");
  post.clearDomainEvents();
  return post;
}

function publishedResult(fragmentCount = 1): AttemptResult {
  const head = providedReference("frag-1");
  assert.ok(head.ok, "the fixture head reference must build");
  return {
    kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
    head: head.value,
    fragments: Array.from({ length: fragmentCount }, (_, index) => makeFragment(index + 1)),
    publishedAt: NOW,
    contentHash: ContentFingerprint.ofContent({ body: "hello", mediaIds: [] }),
  };
}

function transientFailure(): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
    code: CHANNEL_FAILURE_CODES.RENDER_FAILED,
    publishedFragments: [],
  };
}

function strandingFailure(): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
    code: CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED,
    publishedFragments: [makeFragment(1)],
  };
}

// ---------------------------------------------------------------------------
// Port doubles
// ---------------------------------------------------------------------------

/**
 * The edit events the production narrow save refuses to carry
 * (`PUBLICATION_TRIPWIRE_EVENTS`, `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`).
 * Named here rather than imported because `@core/posts` does not depend on the adapter
 * package; the double implements the SAME refusal so the use case is tested against the
 * production contract instead of a laxer one.
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

interface AttemptOverrides {
  channelId?: string;
  episode?: number;
  attemptNo?: number;
  planSize?: number;
  result?: AttemptResult;
}

function attemptInput(overrides?: AttemptOverrides): {
  postId: string;
  channelId: string;
  episode: number;
  attemptNo: number;
  planSize: number;
  result: AttemptResult;
  now: Date;
} {
  return {
    postId: POST_UUID,
    channelId: overrides?.channelId ?? CHANNEL_A,
    episode: overrides?.episode ?? 1,
    attemptNo: overrides?.attemptNo ?? 1,
    planSize: overrides?.planSize ?? 1,
    result: overrides?.result ?? publishedResult(),
    now: NOW,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecordChannelPublicationAttemptUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pure refusals — decided before any I/O", () => {
    it("returns VALIDATION_FAILED for an invalid post id without loading anything", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, uow);

      const result = await useCase.execute({ ...attemptInput(), postId: "not-a-uuid" });

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
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, uow);

      const result = await useCase.execute(attemptInput({ channelId: "not-a-uuid" }));

      assert.ok(!result.ok, "an invalid channel id is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(uow.calls, 0);
    });
  });

  describe("the recorded attempt", () => {
    it("records a published attempt, derives the word and saves through the NARROW save", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({ post });
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(attemptInput());

      assert.ok(result.ok, "the attempt is recorded");
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(result.value.outcome.kind, PUBLICATION_OUTCOME_KINDS.PUBLISHED);
      assert.strictEqual(result.value.status, "PUBLISHED", "the word is derived from the record");
      assert.strictEqual(post.publications.find(channelId(CHANNEL_A))?.isPublished(), true);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1, "the NARROW save is used");
      assert.strictEqual(repo.save.mock.calls.length, 0, "the full save is never used");
      assert.strictEqual(post.domainEvents.length, 0, "the outbox owns the events after the save");
    });

    it("leaves a transient failure inside the budget unresolved and the post PUBLISHING", async () => {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      const repo = makePostRepo({ post });
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(attemptInput({ result: transientFailure() }));

      assert.ok(result.ok, "a failure inside the budget is still a recorded attempt");
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(result.value.outcome.kind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
      assert.strictEqual(result.value.status, "PUBLISHING", "an unresolved channel keeps it open");
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    it("strands the channel pending retraction when fragments went out before the failure", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({ post });
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(
        attemptInput({ result: strandingFailure(), planSize: 2 })
      );

      assert.ok(result.ok, "an interrupted thread is a recorded outcome, not an error");
      assert.strictEqual(result.value.outcome.kind, PUBLICATION_OUTCOME_KINDS.EXCLUDED);
      const record = post.publications.find(channelId(CHANNEL_A));
      assert.ok(record, "the record survives");
      assert.strictEqual(record.pendingRetraction, true, "the live fragment is recorded as live");
      assert.deepStrictEqual(
        record.liveFragments.map((fragment) => fragment.externalId),
        ["frag-1"]
      );
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });
  });

  describe("redelivery — a replayed ordinal applies nothing and writes nothing (PROM-R4)", () => {
    it("answers applied: false for an ordinal the episode already recorded", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({ post });
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, makeRecordingUow());

      const first = await useCase.execute(attemptInput({ result: transientFailure() }));
      assert.ok(first.ok, "the first delivery is recorded");
      repo.savePublication.mockClear();

      const replay = await useCase.execute(attemptInput({ result: publishedResult() }));

      assert.ok(replay.ok, "a redelivery is answered, never failed");
      assert.strictEqual(replay.value.applied, false);
      assert.strictEqual(
        replay.value.outcome.kind,
        PUBLICATION_OUTCOME_KINDS.UNRESOLVED,
        "the replayed result is discarded, not applied"
      );
      assert.strictEqual(
        repo.savePublication.mock.calls.length,
        0,
        "a redelivery writes nothing at all"
      );
      assert.strictEqual(post.publications.find(channelId(CHANNEL_A))?.episodeAttempts, 1);
    });
  });

  describe("conflicts — every one of them rolls the transaction back", () => {
    it("returns CONFLICT when the attempt names a stale episode", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, uow);

      const result = await useCase.execute(attemptInput({ episode: 7 }));

      assert.ok(!result.ok, "an attempt from another episode is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.match(result.error.message, /episode/);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(uow.resultErrors.length, 1, "the refusal aborts the transaction");
    });

    it("returns CONFLICT when the channel has no open episode at all", async () => {
      const post = makePost();
      const declared = post.declarePublicationTargets([channelId(CHANNEL_A)]);
      assert.ok(declared.ok, "the fixture declares a target but opens no episode");
      post.clearDomainEvents();
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, uow);

      const result = await useCase.execute(attemptInput({ episode: 0 }));

      assert.ok(!result.ok, "an attempt against episode zero is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(uow.resultErrors.length, 1);
    });

    it("returns NOT_FOUND when the channel is outside the recorded target set", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, uow);

      const result = await useCase.execute(attemptInput({ channelId: CHANNEL_UNKNOWN }));

      assert.ok(!result.ok, "an unrecorded channel has no attempt to record");
      assert.strictEqual(
        result.error.code,
        USE_CASE_ERRORS.NOT_FOUND,
        "a missing record is distinct from a stale episode, because the worker acts differently on each"
      );
      assert.match(result.error.message, new RegExp(CHANNEL_UNKNOWN));
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(uow.resultErrors.length, 1);
    });

    it("returns CONFLICT when a published result does not carry every fragment of the plan", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({ post });
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(attemptInput({ planSize: 3 }));

      assert.ok(!result.ok, "a partial thread is never a published channel");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("returns CONFLICT when the compare-and-swap loses to a concurrent writer", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({
        post,
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const uow = makeRecordingUow();
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, uow);

      const result = await useCase.execute(attemptInput());

      assert.ok(!result.ok, "a lost CAS is reported, never swallowed");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(uow.resultErrors.length, 1, "the failed save aborts the transaction");
    });

    it("returns NOT_FOUND when the post does not exist", async () => {
      const repo = makePostRepo({
        findByIdResult: err(new EntityNotFoundError("Post", POST_UUID)),
      });
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(attemptInput());

      assert.ok(!result.ok, "a missing post is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });
  });

  describe("the edit tripwire the narrow save carries", () => {
    it("refuses an aggregate that arrived carrying a pending content edit", async () => {
      // A DRAFT post, because only DRAFT and FAILED admit an edit at all — the fixture
      // has to reach the tripwire, not the lifecycle refusal that sits in front of it.
      const post = makePost({ status: PublishStatus.draft() });
      const declared = post.declarePublicationTargets([channelId(CHANNEL_A)]);
      assert.ok(declared.ok, "the fixture declares its target");
      const opened = post.openPublicationEpisode({ enterPublishing: false });
      assert.ok(opened.ok, "the fixture opens its first episode");
      post.clearDomainEvents();
      // The load that precedes this use case never produces an edit; a caller that mixed
      // one in is exactly what the tripwire exists to catch, so the fixture mixes one in.
      const edited = post.addMedia({ type: "image", url: "https://cdn.example.test/a.png" });
      assert.ok(edited.ok, "the fixture edit is accepted by the aggregate");
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port, uow);

      const result = await useCase.execute(attemptInput());

      assert.ok(!result.ok, "a publication save must not carry an edit");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
      assert.match(
        result.error.message,
        /publication save writes no content|pending PostMediaAdded/
      );
      assert.strictEqual(uow.resultErrors.length, 1, "the refusal aborts the transaction");
    });
  });

  describe("without a unit of work — the optional seam the composition root always injects", () => {
    // The seam is optional so a unit test can construct the use case without one, and
    // the composition root always injects it — so this branch is unreachable in
    // production and untested by every case above, which all pass a recording double.
    // It is still a contract this package states, and an outcome that differed here
    // from the transactional path would be a silent second behaviour.
    it("answers a domain refusal exactly as the transactional path does, and writes nothing", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({ post });
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port);

      const result = await useCase.execute(attemptInput({ episode: 0 }));

      assert.ok(!result.ok, "an unopened episode is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("answers a save failure exactly as the transactional path does", async () => {
      const repo = makePostRepo({
        post: makeOpenedPost([CHANNEL_A]),
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const useCase = new RecordChannelPublicationAttemptUseCase(repo.port);

      const result = await useCase.execute(attemptInput());

      assert.ok(!result.ok, "a lost CAS is reported, never swallowed");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
    });
  });
});
