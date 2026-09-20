/**
 * @file expireRetractionActionWindow.test.ts
 * @description Unit tests for the sweep's writer: the act that closes one channel's
 *              customer action window. The window LENGTH is the caller's — the domain
 *              reads no configuration — so the tests pin that the value handed in is the
 *              one the record re-asserts, that a window which has not elapsed applies
 *              nothing and writes nothing, and that a second tick over the same row is a
 *              no-op rather than a second version. Doubles are of the PORTS.
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
  CHANNEL_FAILURE_CODES,
  ATTEMPT_CLASSIFICATIONS,
  type AttemptResult,
  type PostRepository,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ExpireRetractionActionWindowUseCase } from "../../src/ExpireRetractionActionWindowUseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POST_UUID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_UUID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_UUID = "a0000000-0000-4000-8000-000000000001";
const CHANNEL_A = "aa000000-0000-4000-8000-00000000000a";
const CHANNEL_UNKNOWN = "aa000000-0000-4000-8000-00000000000f";
const STRANDED_AT = new Date("2026-03-01T09:00:00.000Z");
const ONE_HOUR_MS = 60 * 60 * 1000;
/** Two hours after the window opened: elapsed for a one-hour window, not for a three-hour one. */
const SWEEP_TICK_AT = new Date(STRANDED_AT.getTime() + 2 * ONE_HOUR_MS);

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

function strandingFailure(): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
    code: CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED,
    publishedFragments: [makeFragment(1)],
  };
}

/** A post whose only channel is pending retraction, its window open since STRANDED_AT. */
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
  assert.deepStrictEqual(
    record?.actionWindowStartedAt,
    STRANDED_AT,
    "the fixture's window opens at the stranding attempt"
  );
  post.clearDomainEvents();
  return post;
}

/** A post whose only channel is open and unresolved: no window was ever opened. */
function makeUnresolvedPost(): PostAggregate {
  const post = makePost();
  const declared = post.declarePublicationTargets([channelId(CHANNEL_A)]);
  assert.ok(declared.ok, "the fixture declares its target");
  const opened = post.openPublicationEpisode({ enterPublishing: false });
  assert.ok(opened.ok, "the fixture opens its first episode");
  post.clearDomainEvents();
  return post;
}

// ---------------------------------------------------------------------------
// Port doubles
// ---------------------------------------------------------------------------

/**
 * The edit events the production narrow save refuses to carry
 * (`PUBLICATION_TRIPWIRE_EVENTS`, `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`).
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

function expireInput(overrides?: {
  postId?: string;
  channelId?: string;
  now?: Date;
  window?: number;
}): { postId: string; channelId: string; now: Date; window: number } {
  return {
    postId: overrides?.postId ?? POST_UUID,
    channelId: overrides?.channelId ?? CHANNEL_A,
    now: overrides?.now ?? SWEEP_TICK_AT,
    window: overrides?.window ?? ONE_HOUR_MS,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExpireRetractionActionWindowUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pure refusals — decided before any I/O", () => {
    it("returns VALIDATION_FAILED for an invalid post id without loading anything", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, uow);

      const result = await useCase.execute(expireInput({ postId: "not-a-uuid" }));

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
      assert.strictEqual(uow.calls, 0);
    });

    it("returns VALIDATION_FAILED for an invalid channel id without loading anything", async () => {
      const repo = makePostRepo();
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput({ channelId: "not-a-uuid" }));

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("refuses a window that is not a finite number, which would otherwise expire EVERY row", async () => {
      // The record's cutoff is `now < startedAt + window`. With NaN that comparison is
      // FALSE, so the guard is not taken and the window expires immediately — the one
      // malformed value that fails OPEN instead of closed, which is why it is refused
      // here rather than left to the root.
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput({ window: Number.NaN }));

      // The window comes FIRST on purpose: if the guard ever goes, this case must fail
      // by naming the window it closed, not by naming a code mismatch.
      assert.strictEqual(
        post.publications.find(channelId(CHANNEL_A))?.actionWindowExpiredAt,
        undefined,
        "the window the malformed value would have closed is still open"
      );
      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.findById.mock.calls.length, 0, "it is decided before the load");
    });

    it("refuses a negative window", async () => {
      const repo = makePostRepo({ post: makeStrandedPost() });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput({ window: -ONE_HOUR_MS }));

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
    });
  });

  describe("the CALLER's window is the one the record re-asserts", () => {
    it("expires the window when the caller's window has elapsed", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput({ window: ONE_HOUR_MS }));

      assert.ok(result.ok);
      assert.strictEqual(result.value.applied, true);
      const record = post.publications.find(channelId(CHANNEL_A));
      assert.deepStrictEqual(record?.actionWindowExpiredAt, SWEEP_TICK_AT);
      assert.strictEqual(record?.reason?.code, CHANNEL_FAILURE_CODES.ACTION_WINDOW_EXPIRED);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1, "exactly one narrow save");
      assert.strictEqual(repo.save.mock.calls.length, 0, "the full save is never used");
    });

    it("applies nothing at the SAME moment when the caller's window is longer", async () => {
      // Same `now`, same record: only the window argument differs, so this pair is what
      // proves the value travels from the caller to the record rather than being read
      // from anywhere else.
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput({ window: 3 * ONE_HOUR_MS }));

      assert.ok(result.ok, "a window that has not elapsed is a no-op, not an error");
      assert.strictEqual(result.value.applied, false);
      assert.strictEqual(
        post.publications.find(channelId(CHANNEL_A))?.actionWindowExpiredAt,
        undefined
      );
      assert.strictEqual(repo.savePublication.mock.calls.length, 0, "a no-op writes nothing");
    });
  });

  describe("what expiry does and does not touch", () => {
    it("finalizes the outcome while keeping every live fragment and the lock", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput());

      assert.ok(result.ok && result.value.applied);
      const record = post.publications.find(channelId(CHANNEL_A));
      assert.strictEqual(record?.pendingRetraction, true, "elapsed time cannot know it came down");
      assert.deepStrictEqual(
        record?.liveFragments.map((fragment) => fragment.externalId),
        ["frag-1"]
      );
      assert.strictEqual(record?.hasLiveContent(), true);
      assert.strictEqual(result.value.hasLiveContent, true, "the content stays locked");
      assert.strictEqual(post.domainEvents.length, 0, "the outbox owns the events after the save");
    });

    it("answers a second tick over the same row with applied:false and no second write", async () => {
      const post = makeStrandedPost();
      const repo = makePostRepo({ post });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const first = await useCase.execute(expireInput());
      assert.ok(first.ok && first.value.applied, "the first tick expires the window");

      const second = await useCase.execute(expireInput());

      assert.ok(second.ok, "the sweep must not error on a row it already handled");
      assert.strictEqual(second.value.applied, false);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    it("applies nothing on a channel that never opened a window", async () => {
      const post = makeUnresolvedPost();
      const repo = makePostRepo({ post });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput());

      assert.ok(result.ok);
      assert.strictEqual(result.value.applied, false);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });
  });

  describe("the refusals that need the record", () => {
    it("returns NOT_FOUND when the post does not load", async () => {
      const repo = makePostRepo({
        findByIdResult: err(new EntityNotFoundError("Post", POST_UUID)),
      });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("returns NOT_FOUND for a channel outside the recorded set", async () => {
      const repo = makePostRepo({ post: makeStrandedPost() });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput({ channelId: CHANNEL_UNKNOWN }));

      assert.ok(!result.ok, "the post never declared that channel");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });
  });

  describe("the save", () => {
    it("translates a lost compare-and-swap into a CONFLICT and rolls the transaction back", async () => {
      const repo = makePostRepo({
        post: makeStrandedPost(),
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const uow = makeRecordingUow();
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, uow);

      const result = await useCase.execute(expireInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(uow.resultErrors.length, 1, "the err reaches the seam that rolls back");
    });

    it("translates any other save failure into an INTERNAL_ERROR", async () => {
      const repo = makePostRepo({
        post: makeStrandedPost(),
        saveResult: err(new Error("connection reset")),
      });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute(expireInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });

  describe("without a unit of work — the optional seam the composition root always injects", () => {
    it("answers a domain refusal exactly as the transactional path does, and writes nothing", async () => {
      const repo = makePostRepo({ post: makeStrandedPost() });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port);

      const result = await useCase.execute(expireInput({ channelId: CHANNEL_UNKNOWN }));

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("answers a save failure exactly as the transactional path does", async () => {
      const repo = makePostRepo({
        post: makeStrandedPost(),
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const useCase = new ExpireRetractionActionWindowUseCase(repo.port);

      const result = await useCase.execute(expireInput());

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
    });
  });
});
