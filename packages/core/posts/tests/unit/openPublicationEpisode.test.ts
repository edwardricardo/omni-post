/**
 * @file openPublicationEpisode.test.ts
 * @description Unit tests for the writer that opens an attempt episode: the three admission
 *              branches (no record, a record with nothing live, a record holding live
 *              content), the equality rule that a locked post's request must satisfy, the
 *              by-name refusal a channel pending retraction gets WITH its fragments, the
 *              `alreadyOpen` answer a re-drive retry gets, and the narrow save — never the
 *              full one. Doubles are of the PORTS, never of the use case under test.
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
import { RETRACTION_REFUSALS, refusalOf } from "../../src/retractionRefusals.js";
import { OpenPublicationEpisodeUseCase } from "../../src/OpenPublicationEpisodeUseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POST_UUID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_UUID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_UUID = "a0000000-0000-4000-8000-000000000001";
const CHANNEL_A = "aa000000-0000-4000-8000-00000000000a";
const CHANNEL_B = "aa000000-0000-4000-8000-00000000000b";
const CHANNEL_C = "aa000000-0000-4000-8000-00000000000c";
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

function publishedResult(): AttemptResult {
  const head = providedReference("frag-1");
  assert.ok(head.ok, "the fixture head reference must build");
  return {
    kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
    head: head.value,
    fragments: [makeFragment(1)],
    publishedAt: NOW,
    contentHash: ContentFingerprint.ofContent({ body: "hello", mediaIds: [] }),
  };
}

function failedResult(publishedFragments: readonly FragmentReference[] = []): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
    code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
    publishedFragments,
  };
}

function recordOn(post: PostAggregate, channel: string, result: AttemptResult): void {
  const recorded = post.recordChannelAttempt({
    channelId: channelId(channel),
    episode: 1,
    attemptNo: 1,
    planSize: 1,
    result,
    now: NOW,
  });
  assert.ok(recorded.ok, "the fixture records its attempt");
  post.clearDomainEvents();
}

// ---------------------------------------------------------------------------
// Port doubles
// ---------------------------------------------------------------------------

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
  // Both saves bump the in-memory version exactly as the production adapter does after
  // its CAS update, so a caller is never made to look correct against a version the
  // adapter would not have produced.
  const bumping = (aggregate: PostAggregate): Result<void, Error> => {
    const result = options?.saveResult ?? ok(undefined);
    if (result.ok) {
      aggregate.incrementVersion();
    }
    return result;
  };
  const save = vi.fn(async (aggregate: PostAggregate) => bumping(aggregate));
  const savePublication = vi.fn(async (aggregate: PostAggregate) => bumping(aggregate));
  const port = {
    findById,
    save,
    savePublication,
    delete: vi.fn(),
    exists: vi.fn(),
  } as unknown as PostRepository;
  return { port, findById, save, savePublication };
}

/**
 * Records every `err` that came back FROM INSIDE the callback, which is the only way to
 * tell an aborting failure from one thrown past the seam.
 */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenPublicationEpisodeUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pure refusals — decided before any I/O", () => {
    it("returns VALIDATION_FAILED for an invalid post id without loading anything", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({ postId: "not-a-uuid", enterPublishing: false });

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
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A, "not-a-uuid"],
        enterPublishing: false,
      });

      assert.ok(!result.ok, "an invalid channel id is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.match(result.error.message, /not-a-uuid/);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
      assert.strictEqual(uow.calls, 0);
    });
  });

  describe("a post with no record — the targets are declared, then opened (D9)", () => {
    it("declares the requested channels and opens episode 1 over them", async () => {
      const post = makePost();
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A, CHANNEL_B],
        enterPublishing: false,
      });

      assert.ok(result.ok, "a post with no record is admitted");
      assert.strictEqual(result.value.alreadyOpen, false);
      assert.deepStrictEqual(
        result.value.opened.map((channel) => channel.channelId).sort(),
        [CHANNEL_A, CHANNEL_B].sort()
      );
      assert.ok(
        result.value.opened.every((channel) => channel.episode === 1),
        "the first episode is 1"
      );
      assert.strictEqual(post.publications.size, 2, "both targets are now recorded");
      assert.strictEqual(post.status.value, "SCHEDULED", "enterPublishing false leaves the word");
      assert.strictEqual(repo.savePublication.mock.calls.length, 1, "the NARROW save is used");
      assert.strictEqual(repo.save.mock.calls.length, 0, "the full save is never used");
    });

    it("enters the publication family when the caller asks for it", async () => {
      const post = makePost();
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A],
        enterPublishing: true,
      });

      assert.ok(result.ok, "publish-now is admitted");
      assert.strictEqual(result.value.status, "PUBLISHING");
      assert.strictEqual(post.status.value, "PUBLISHING");
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    it("refuses with VALIDATION_FAILED when no record exists and no channel is named", async () => {
      const repo = makePostRepo({ post: makePost() });
      const uow = makeRecordingUow();
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({ postId: POST_UUID, enterPublishing: false });

      assert.ok(!result.ok, "there is nothing to open and nothing to declare");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(uow.resultErrors.length, 1, "the refusal aborts the transaction");
    });
  });

  describe("a record with nothing live — the set is replaced, then opened (D9)", () => {
    it("replaces the recorded target set with the requested one", async () => {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A, CHANNEL_C],
        enterPublishing: false,
      });

      assert.ok(result.ok, "nothing is live, so the set may be replaced");
      assert.deepStrictEqual(
        post.publications.all.map((record) => record.channelId.value).sort(),
        [CHANNEL_A, CHANNEL_C].sort()
      );
      assert.strictEqual(
        post.publications.find(channelId(CHANNEL_B)),
        undefined,
        "the dropped channel is gone from the record"
      );
      assert.deepStrictEqual(
        result.value.opened.map((channel) => channel.episode),
        [1, 1],
        "a replaced set starts at episode 1 again"
      );
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    // The fixture is deliberately the state in which the aggregate WOULD accept the wipe:
    // a non-empty recorded set with nothing live. `declarePublicationTargets([])` passes
    // the identical-set guard (0 !== 2) and the live-content guard, and reaches
    // `replaceRecords([])`. The use case's empty-list refusal is the only thing standing
    // between the request and an emptied record, so it is asserted on the RECORD, not
    // only on the returned error.
    it("refuses an empty channel list and leaves the recorded target set intact", async () => {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [],
        enterPublishing: false,
      });

      assert.ok(!result.ok, "an empty list is a request, not an omission");
      assert.deepStrictEqual(
        post.publications.all.map((record) => record.channelId.value).sort(),
        [CHANNEL_A, CHANNEL_B].sort(),
        "the recorded target set survives an empty request"
      );
      assert.strictEqual(post.publications.size, 2);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(repo.save.mock.calls.length, 0);
      assert.strictEqual(uow.calls, 0, "the refusal needs no state, so it opens no transaction");
    });

    it("opens every recorded channel when the caller names none", async () => {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      recordOn(post, CHANNEL_A, failedResult());
      recordOn(post, CHANNEL_B, failedResult());
      assert.strictEqual(post.status.value, "FAILED", "the fixture is a post that failed outright");
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      // Publish-now, because a FAILED post is re-driven only through it: the schedule-mode
      // open admits DRAFT and SCHEDULED alone, which is the refusal the next case pins.
      const result = await useCase.execute({ postId: POST_UUID, enterPublishing: true });

      assert.ok(result.ok, "an excluded channel with nothing live is re-drivable");
      assert.strictEqual(result.value.opened.length, 2);
      assert.ok(
        result.value.opened.every((channel) => channel.episode === 2),
        "the second episode is 2"
      );
      assert.strictEqual(result.value.status, "PUBLISHING", "the re-drive re-enters the family");
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    it("returns FORBIDDEN when a schedule-mode open is asked of a post that already failed", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      recordOn(post, CHANNEL_A, failedResult());
      assert.strictEqual(post.status.value, "FAILED", "the fixture left the lifecycle words");
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({ postId: POST_UUID, enterPublishing: false });

      assert.ok(!result.ok, "a delayed re-drive of a FAILED post is refused (D9)");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
      assert.match(result.error.message, /FAILED/);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(uow.resultErrors.length, 1, "the refusal aborts the transaction");
    });
  });

  describe("a record holding live content — the request must name the recorded set (D9)", () => {
    /** Channel A published, channel B excluded with nothing live: the post is locked by A. */
    function makePartiallyPublishedPost(): PostAggregate {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      recordOn(post, CHANNEL_A, publishedResult());
      recordOn(post, CHANNEL_B, failedResult());
      assert.ok(post.publications.hasLiveContent(), "the fixture is locked");
      return post;
    }

    it("returns VALIDATION_FAILED when the requested set differs from the recorded one", async () => {
      const post = makePartiallyPublishedPost();
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_B],
        enterPublishing: true,
      });

      assert.ok(!result.ok, "a locked post's target set cannot be narrowed");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.match(result.error.message, new RegExp(CHANNEL_A));
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(uow.resultErrors.length, 1, "the refusal aborts the transaction");
    });

    it("returns VALIDATION_FAILED when the caller names no channel at all", async () => {
      const repo = makePostRepo({ post: makePartiallyPublishedPost() });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({ postId: POST_UUID, enterPublishing: true });

      assert.ok(!result.ok, "an unstated set cannot equal the recorded one");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("opens only the re-drivable channels and leaves the published one untouched", async () => {
      const post = makePartiallyPublishedPost();
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A, CHANNEL_B],
        enterPublishing: true,
      });

      assert.ok(result.ok, "the equal set is admitted");
      assert.deepStrictEqual(
        result.value.opened.map((channel) => channel.channelId),
        [CHANNEL_B],
        "a published channel is never re-sent"
      );
      const published = post.publications.find(channelId(CHANNEL_A));
      assert.ok(published, "the published record survives");
      assert.strictEqual(published.isPublished(), true);
      assert.strictEqual(published.episode, 1, "the published channel keeps its episode");
      const reopened = post.publications.find(channelId(CHANNEL_B));
      assert.ok(reopened, "the re-driven record survives");
      assert.strictEqual(reopened.episode, 2);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    it("refuses a named channel pending retraction with CHANNEL_HAS_LIVE_FRAGMENTS and its fragments", async () => {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      recordOn(post, CHANNEL_A, failedResult([makeFragment(1)]));
      const stranded = post.publications.find(channelId(CHANNEL_A));
      assert.ok(stranded, "the stranded record exists");
      assert.strictEqual(stranded.pendingRetraction, true, "the fixture strands a fragment");
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A, CHANNEL_B],
        enterPublishing: true,
      });

      assert.ok(!result.ok, "a channel with live fragments is refused by name");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.match(result.error.message, /CHANNEL_HAS_LIVE_FRAGMENTS/);
      assert.match(result.error.message, new RegExp(CHANNEL_A));
      assert.match(result.error.message, /frag-1/, "the refusal names what is live");
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(uow.resultErrors.length, 1, "the refusal aborts the transaction");
    });

    it("carries the refusal as a DISCRIMINATOR a route can switch on, not as a message prefix", async () => {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      recordOn(post, CHANNEL_A, failedResult([makeFragment(1), makeFragment(2)]));
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A, CHANNEL_B],
        enterPublishing: true,
      });

      assert.ok(!result.ok, "the stranded channel is refused");
      // The coarse code stays CONFLICT — every route already maps it to 409. WHICH
      // conflict travels beside it, because one string holding two vocabularies is how a
      // caller ends up matching on a message to tell them apart.
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      // Pinned against the literal FIRST: comparing `refusalOf(...)` to a member that does
      // not exist is `undefined === undefined`, which passes while proving nothing — the
      // vacuous green this case's own red run produced before the member was declared.
      assert.strictEqual(
        RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS,
        "CHANNEL_HAS_LIVE_FRAGMENTS"
      );
      assert.strictEqual(refusalOf(result.error), RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS);
      assert.deepStrictEqual(
        (result.error as { fragments?: unknown }).fragments,
        [
          { index: 1, externalId: "frag-1" },
          { index: 2, externalId: "frag-2" },
        ],
        "and the fragments travel with it, so the answer needs no second read"
      );
    });

    it("names the FIRST stranded channel in requested order when several are stranded", async () => {
      // The refusal carries ONE channel and its fragments, so which one it picks is part of
      // the contract a caller reads — the customer is told what to remove. With one stranded
      // channel that choice is invisible; this case makes it observable. The request names
      // C first, so C is the answer even though B is stranded too and A is clean.
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B, CHANNEL_C]);
      recordOn(post, CHANNEL_B, failedResult([makeFragment(1)]));
      recordOn(post, CHANNEL_C, failedResult([makeFragment(2)]));
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_C, CHANNEL_B, CHANNEL_A],
        enterPublishing: true,
      });

      assert.ok(!result.ok, "a request naming two stranded channels is refused");
      assert.strictEqual(refusalOf(result.error), RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS);
      assert.match(result.error.message, new RegExp(CHANNEL_C), "the refusal names C, not B");
      assert.doesNotMatch(
        result.error.message,
        new RegExp(CHANNEL_B),
        "and it names only the one it answers for"
      );
      assert.deepStrictEqual(
        (result.error as { fragments?: unknown }).fragments,
        [{ index: 2, externalId: "frag-2" }],
        "the fragments belong to the channel the refusal names"
      );
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });
  });

  describe("idempotency — a re-drive retry re-runs without opening a second episode", () => {
    it("answers alreadyOpen and writes nothing when the episode is already open", async () => {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A, CHANNEL_B],
        enterPublishing: false,
      });

      assert.ok(result.ok, "re-running the step is admitted");
      assert.strictEqual(result.value.alreadyOpen, true);
      assert.ok(
        result.value.opened.every((channel) => channel.episode === 1),
        "the open episode is answered, not advanced"
      );
      assert.strictEqual(
        repo.savePublication.mock.calls.length,
        0,
        "nothing changed, so nothing is written"
      );
      assert.strictEqual(post.version, 3, "the version is not spent on a no-op");
    });

    it("writes when the open episode is answered but the word still has to move", async () => {
      const post = makeOpenedPost([CHANNEL_A]);
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A],
        enterPublishing: true,
      });

      assert.ok(result.ok, "publish-now over an already-open episode is admitted");
      assert.strictEqual(result.value.alreadyOpen, true);
      assert.strictEqual(result.value.status, "PUBLISHING", "the word enters the family");
      assert.strictEqual(repo.savePublication.mock.calls.length, 1, "the word change is written");
    });
  });

  describe("persistence outcomes", () => {
    it("returns NOT_FOUND when the post does not exist", async () => {
      const repo = makePostRepo({
        findByIdResult: err(new EntityNotFoundError("Post", POST_UUID)),
      });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A],
        enterPublishing: false,
      });

      assert.ok(!result.ok, "a missing post is refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("returns CONFLICT when the compare-and-swap loses to a concurrent writer", async () => {
      const repo = makePostRepo({
        post: makePost(),
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const uow = makeRecordingUow();
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, uow);

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A],
        enterPublishing: false,
      });

      assert.ok(!result.ok, "a lost CAS is reported, never swallowed");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(uow.resultErrors.length, 1, "the failed save aborts the transaction");
    });

    it("returns INTERNAL_ERROR when the narrow save refuses for any other reason", async () => {
      const repo = makePostRepo({
        post: makePost(),
        saveResult: err(new Error("connection reset")),
      });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A],
        enterPublishing: false,
      });

      assert.ok(!result.ok, "an infrastructure failure is reported");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
      assert.strictEqual(
        result.error.originalError?.message,
        "connection reset",
        "the infrastructure failure is carried, not swallowed"
      );
    });
  });

  describe("without a unit of work — the optional seam the composition root always injects", () => {
    // The seam is optional so a unit test can construct the use case without one, and
    // the composition root always injects it — so this branch is unreachable in
    // production and untested by every case above, which all pass a recording double.
    // It is still a contract this package states, and an outcome that differed here
    // from the transactional path would be a silent second behaviour.
    it("answers a domain refusal exactly as the transactional path does, and writes nothing", async () => {
      const post = makeOpenedPost([CHANNEL_A, CHANNEL_B]);
      recordOn(post, CHANNEL_A, publishedResult());
      recordOn(post, CHANNEL_B, failedResult());
      const repo = makePostRepo({ post });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port);

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_B],
        enterPublishing: true,
      });

      assert.ok(!result.ok, "a locked post's target set cannot be narrowed");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("answers a save failure exactly as the transactional path does", async () => {
      const repo = makePostRepo({
        post: makePost(),
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const useCase = new OpenPublicationEpisodeUseCase(repo.port);

      const result = await useCase.execute({
        postId: POST_UUID,
        channelIds: [CHANNEL_A],
        enterPublishing: false,
      });

      assert.ok(!result.ok, "a lost CAS is reported, never swallowed");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
    });
  });
});
