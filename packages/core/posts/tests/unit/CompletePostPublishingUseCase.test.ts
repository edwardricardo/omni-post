/**
 * @file CompletePostPublishingUseCase.test.ts
 * @description Unit tests for the publish-now RECONCILIATION: the pure refusals decided
 *              before any I/O, the fail-closed refusal of a post that carries no
 *              publication record, the two directions in which a reported outcome can
 *              disagree with the record, the projection write that happens exactly when
 *              the word and the record differ, and the narrow save's error narrowing.
 *              Doubles are of the PORTS, never of the use case under test.
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
  PublishStatus,
  PUBLISH_STATUS,
  Content,
  ContentFingerprint,
  FragmentReference,
  ChannelPublication,
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
import { CompletePostPublishingUseCase } from "../../src/CompletePostPublishingUseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POST_UUID = "11111111-1111-4111-8111-111111111111";
const PROJECT_UUID = "44444444-4444-4444-8444-444444444444";
const ACCOUNT_UUID = "55555555-5555-4555-8555-555555555555";
const CHANNEL_A = "22222222-2222-4222-8222-222222222222";
const CHANNEL_B = "33333333-3333-4333-8333-333333333333";
const CHANNEL_C = "66666666-6666-4666-8666-666666666666";

const CHANNEL_A_ID = ChannelId.fromStringUnsafe(CHANNEL_A);
const CHANNEL_B_ID = ChannelId.fromStringUnsafe(CHANNEL_B);

/**
 * The moment the RECORD carries for a published channel. It is deliberately in
 * the past and distinct from anything the reconciliation could mint, so an
 * assertion over it can tell "read off the record" from "stamped now".
 */
const RECORDED_AT = new Date("2024-01-01T00:00:00.000Z");

type RecordedOutcome = "published" | "failed" | "unresolved";

function baseState(status: PublishStatus, publications: readonly ChannelPublication[]) {
  return {
    id: PostId.fromStringUnsafe(POST_UUID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_UUID),
    accountId: ACCOUNT_UUID,
    content: Content.reconstitute({ body: "Fixture body", tags: [], locale: "en" as const }),
    status,
    media: [],
    contentVersions: [],
    createdAt: new Date("2023-12-01T00:00:00.000Z"),
    updatedAt: new Date("2023-12-01T00:00:00.000Z"),
    version: 3,
    publications,
  };
}

function publishedAttempt(): AttemptResult {
  const head = providedReference("x-1");
  assert.ok(head.ok, "the fixture head must build");
  const fragment = FragmentReference.create({ index: 1, externalId: "x-1" });
  assert.ok(fragment.ok, "the fixture fragment must build");
  return {
    kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
    head: head.value,
    fragments: [fragment.value],
    publishedAt: RECORDED_AT,
    contentHash: ContentFingerprint.ofContent({ body: "Fixture body", mediaIds: [] }),
  };
}

function failedAttempt(): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
    code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
    publishedFragments: [],
  };
}

/**
 * Builds a settled record set by driving a SCRATCH aggregate through its own
 * entry points, so every record carries facts the domain would really have
 * produced. Hand-built records could hold a combination the aggregate refuses,
 * and a suite that promoted such a set would be proving nothing about production.
 */
function recordsFor(outcomes: Readonly<Record<string, RecordedOutcome>>): ChannelPublication[] {
  const channelIds = Object.keys(outcomes).map((value) => ChannelId.fromStringUnsafe(value));
  const scratch = PostAggregate.reconstitute(baseState(PublishStatus.scheduled(), []));
  const declared = scratch.declarePublicationTargets(channelIds);
  assert.ok(declared.ok, "the fixture declares its targets");
  const opened = scratch.openPublicationEpisode({ enterPublishing: false });
  assert.ok(opened.ok, "the fixture opens its first episode");

  for (const [value, outcome] of Object.entries(outcomes)) {
    if (outcome === "unresolved") {
      continue;
    }
    const applied = scratch.recordChannelAttempt({
      channelId: ChannelId.fromStringUnsafe(value),
      episode: 1,
      attemptNo: 1,
      planSize: 1,
      result: outcome === "published" ? publishedAttempt() : failedAttempt(),
      now: RECORDED_AT,
    });
    assert.ok(applied.ok, `the fixture records ${outcome} for ${value}`);
  }

  return [...scratch.publications.all];
}

/**
 * The record a RE-DRIVE leaves behind: channel A published in the first episode,
 * channel B failed there and published in the second. Only B was re-drivable, so
 * only B was re-opened and only B was scheduled — which is why the completion
 * outcome for that run names one channel while the record holds two.
 */
function redrivenRecords(): ChannelPublication[] {
  const scratch = PostAggregate.reconstitute(baseState(PublishStatus.scheduled(), []));
  const declared = scratch.declarePublicationTargets([CHANNEL_A_ID, CHANNEL_B_ID]);
  assert.ok(declared.ok, "the fixture declares both targets");
  assert.ok(scratch.openPublicationEpisode({ enterPublishing: true }).ok, "first episode opens");

  const attempt = (channelId: ChannelId, episode: number, result: AttemptResult): void => {
    const applied = scratch.recordChannelAttempt({
      channelId,
      episode,
      attemptNo: 1,
      planSize: 1,
      result,
      now: RECORDED_AT,
    });
    assert.ok(applied.ok, `the fixture records episode ${episode} for ${channelId.value}`);
  };

  attempt(CHANNEL_A_ID, 1, publishedAttempt());
  attempt(CHANNEL_B_ID, 1, failedAttempt());
  assert.ok(scratch.openPublicationEpisode({ enterPublishing: true }).ok, "second episode opens");
  attempt(CHANNEL_B_ID, 2, publishedAttempt());

  return [...scratch.publications.all];
}

/**
 * A post as the repository would hand it over: a persisted word and the record
 * set that was loaded with it. The word is set INDEPENDENTLY of the records on
 * purpose — the whole subject of this use case is what happens when the two
 * agree and when they do not.
 */
function makePost(options?: {
  status?: PublishStatus;
  publications?: readonly ChannelPublication[];
  publishedAt?: Date;
  version?: number;
}): PostAggregate {
  const state = baseState(
    options?.status ?? PublishStatus.publishing(),
    options?.publications ?? recordsFor({ [CHANNEL_A]: "published" })
  );
  const post = PostAggregate.reconstitute({
    ...state,
    version: options?.version ?? state.version,
    ...(options?.publishedAt !== undefined && { publishedAt: options.publishedAt }),
  });
  post.clearDomainEvents();
  return post;
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
  /**
   * One aggregate per `findById` call, in order — the shape a concurrent writer
   * that settles BETWEEN two attempts leaves behind. The last entry answers
   * every further call, so a sequence never runs out.
   */
  reads?: readonly PostAggregate[];
  findByIdResult?: Result<PostAggregate, EntityNotFoundError>;
  findByIdThrows?: Error;
  saveResult?: Result<void, Error>;
}): MockPostRepo {
  let readIndex = 0;
  const findById = vi.fn(async () => {
    if (options?.findByIdThrows) {
      throw options.findByIdThrows;
    }
    if (options?.findByIdResult) {
      return options.findByIdResult;
    }
    const reads = options?.reads;
    if (reads !== undefined && reads.length > 0) {
      const read = reads[Math.min(readIndex, reads.length - 1)];
      readIndex += 1;
      assert.ok(read, "the read sequence answers every call");
      return ok(read);
    }
    return ok(options?.post ?? makePost());
  });
  // Both saves bump the in-memory version exactly as the production adapter
  // does after its CAS update, so a double cannot make a caller look correct
  // against a version the adapter would never have produced.
  const bumping = (result: Result<void, Error>) =>
    vi.fn(async (aggregate: PostAggregate) => {
      if (result.ok) {
        aggregate.incrementVersion();
      }
      return result;
    });
  const save = bumping(options?.saveResult ?? ok(undefined));
  const savePublication = bumping(options?.saveResult ?? ok(undefined));
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
 * Records every `err` that came back FROM INSIDE the callback, which is the
 * only way to tell an aborting failure from one thrown past the seam. A `throw`
 * would never reach `resultErrors`.
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

/**
 * A SECOND copy of the version-conflict error, shaped as a duplicate module
 * instance would mint it: same `code`, same `name`, a DIFFERENT constructor.
 * Nothing about it is exotic — it is what `instanceof` sees when two copies of
 * `@core/domain` coexist in one process.
 *
 * The code is written as a LITERAL rather than imported from
 * `VERSION_CONFLICT_CODE` on purpose. Importing it would make the test agree
 * with any future value automatically, and the whole hazard is that the OTHER
 * copy in the process is an older build still minting the OLD string. The
 * literal pins the value as the cross-copy compatibility contract it now is.
 */
class ForeignVersionConflictError extends Error {
  readonly code = "VERSION_CONFLICT";

  constructor() {
    super(`Post "${POST_UUID}" version conflict: expected 3, found 4`);
    this.name = "VersionConflictError";
  }
}

const TOTAL_OUTCOME = { channels: [{ channelId: CHANNEL_A, success: true }] };

function useCaseOver(repo: MockPostRepo, uow: RecordingUow): CompletePostPublishingUseCase {
  return new CompletePostPublishingUseCase(repo.port, uow);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CompletePostPublishingUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Every case here asserts `uow.calls === 0` alongside the zero repository
  // calls. Without it the suite cannot tell "refused before any I/O" from
  // "opened a transaction, did nothing inside it, rolled it back" — the second
  // leaves every repository counter at zero and would pass all three.
  describe("pure refusals — decided before any I/O", () => {
    it("returns VALIDATION_FAILED for an invalid post id without touching the repository", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: "not-a-uuid",
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(!result.ok, "an invalid id must be refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(uow.calls, 0, "no transaction is opened to refuse an id");
    });

    it("returns VALIDATION_FAILED for an empty channel set — a vacuous total is not a publish", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: { channels: [] },
      });

      assert.ok(!result.ok, "an empty scheduled set must be refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
      assert.strictEqual(uow.calls, 0, "no transaction is opened to refuse an empty outcome");
    });
  });

  describe("the record is the sole source of truth, and its absence fails closed", () => {
    it("returns an error NAMING the missing record for a post that predates the record", async () => {
      const repo = makePostRepo({ post: makePost({ publications: [] }) });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(!result.ok, "an outcome that cannot be established is not an outcome");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.match(result.error.message, /publication record/);
      assert.match(result.error.message, new RegExp(POST_UUID));
      assert.strictEqual(repo.savePublication.mock.calls.length, 0, "and nothing is written");
      assert.strictEqual(repo.save.mock.calls.length, 0);
    });

    it("returns NOT_FOUND when the post does not exist", async () => {
      const repo = makePostRepo({
        findByIdResult: err(new EntityNotFoundError("Post", POST_UUID)),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("returns VALIDATION_FAILED naming a reported channel that is outside the recorded set", async () => {
      const repo = makePostRepo({
        post: makePost({ publications: recordsFor({ [CHANNEL_A]: "published" }) }),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: {
          channels: [
            { channelId: CHANNEL_A, success: true },
            { channelId: CHANNEL_C, success: true },
          ],
        },
      });

      assert.ok(!result.ok, "a channel nobody scheduled cannot report an outcome");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.match(result.error.message, new RegExp(CHANNEL_C));
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("reconciles a re-drive whose outcome names only the channel the episode re-opened", async () => {
      const repo = makePostRepo({
        post: makePost({ status: PublishStatus.publishing(), publications: redrivenRecords() }),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: { channels: [{ channelId: CHANNEL_B, success: true }] },
      });

      assert.ok(result.ok, "a re-drive reports its episode, not a census of the record");
      assert.strictEqual(result.value.status, PUBLISH_STATUS.PUBLISHED);
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    it("returns VALIDATION_FAILED for a reported channel id that is not an identifier at all", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: { channels: [{ channelId: "not-a-uuid", success: true }] },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });
  });

  describe("a reported outcome that disagrees with the record", () => {
    it("returns CONFLICT when the caller reports success for a channel the record excluded", async () => {
      const repo = makePostRepo({
        post: makePost({ publications: recordsFor({ [CHANNEL_A]: "failed" }) }),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: { channels: [{ channelId: CHANNEL_A, success: true }] },
      });

      assert.ok(!result.ok, "the record decides, and a caller cannot talk over it");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.match(result.error.message, new RegExp(CHANNEL_A));
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("returns CONFLICT when the caller reports failure for a channel the record published", async () => {
      const repo = makePostRepo({
        post: makePost({ publications: recordsFor({ [CHANNEL_A]: "published" }) }),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: { channels: [{ channelId: CHANNEL_A, success: false, error: "rate limited" }] },
      });

      assert.ok(!result.ok, "the other direction of the same disagreement");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.match(result.error.message, new RegExp(CHANNEL_A));
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("returns CONFLICT when a reported channel is still unresolved on the record", async () => {
      const repo = makePostRepo({
        post: makePost({ publications: recordsFor({ [CHANNEL_A]: "unresolved" }) }),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: { channels: [{ channelId: CHANNEL_A, success: true }] },
      });

      assert.ok(!result.ok, "a channel that settled nothing cannot have reported a result");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });
  });

  describe("the reconciliation itself", () => {
    it("promotes a PUBLISHING post whose every record published, with ONE narrow save and the RECORD's moment", async () => {
      const post = makePost({
        status: PublishStatus.publishing(),
        publications: recordsFor({ [CHANNEL_A]: "published", [CHANNEL_B]: "published" }),
        version: 4,
      });
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: {
          channels: [
            { channelId: CHANNEL_A, success: true },
            { channelId: CHANNEL_B, success: true },
          ],
        },
      });

      assert.ok(result.ok, "the record derives PUBLISHED, so the word follows it");
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(result.value.status, PUBLISH_STATUS.PUBLISHED);
      assert.strictEqual(result.value.postId, POST_UUID);
      assert.strictEqual(result.value.projectId, PROJECT_UUID);
      assert.strictEqual(result.value.version, 5, "the real post-save version, never a constant");
      assert.strictEqual(
        result.value.publishedAt?.getTime(),
        RECORDED_AT.getTime(),
        "read off the record's own publication moment, never stamped now"
      );
      assert.strictEqual(
        repo.savePublication.mock.calls.length,
        1,
        "the narrow save, exactly once"
      );
      assert.strictEqual(repo.save.mock.calls.length, 0, "never the full save: no content moves");
      assert.strictEqual(uow.calls, 1, "one transaction");
      assert.strictEqual(post.status.value, PUBLISH_STATUS.PUBLISHED);
      assert.strictEqual(
        post.domainEvents.length,
        0,
        "events are cleared after the save; the outbox is the only delivery path"
      );
    });

    it("records a NON-TOTAL outcome instead of refusing it, and mints no publication moment", async () => {
      const post = makePost({
        status: PublishStatus.publishing(),
        publications: recordsFor({ [CHANNEL_A]: "published", [CHANNEL_B]: "failed" }),
      });
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: {
          channels: [
            { channelId: CHANNEL_A, success: true },
            { channelId: CHANNEL_B, success: false, error: "auth required" },
          ],
        },
      });

      assert.ok(result.ok, "known partiality is recorded, not refused");
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(result.value.status, PUBLISH_STATUS.PARTIALLY_PUBLISHED);
      assert.strictEqual(
        result.value.publishedAt,
        undefined,
        "the post did not publish everywhere, so it carries no publication moment"
      );
      assert.strictEqual(post.publishedAt, undefined);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    it("derives FAILED when no channel published", async () => {
      const post = makePost({
        status: PublishStatus.publishing(),
        publications: recordsFor({ [CHANNEL_A]: "failed", [CHANNEL_B]: "failed" }),
      });
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: {
          channels: [
            { channelId: CHANNEL_A, success: false, error: "auth required" },
            { channelId: CHANNEL_B, success: false, error: "auth required" },
          ],
        },
      });

      assert.ok(result.ok, "a total failure is an outcome, not an error of this capability");
      assert.strictEqual(result.value.status, PUBLISH_STATUS.FAILED);
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(result.value.publishedAt, undefined);
    });

    it("repairs a lifecycle word found over a settled record, which is the only path that moves it", async () => {
      // A direct status writer outside the aggregate can leave the row reading
      // DRAFT over records that already settled. The reconciliation is what
      // brings the word back to the value the record proves.
      const post = makePost({
        status: PublishStatus.draft(),
        publications: recordsFor({ [CHANNEL_A]: "published" }),
      });
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(result.ok);
      assert.strictEqual(result.value.status, PUBLISH_STATUS.PUBLISHED);
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });

    it("applies nothing and writes nothing when the word already equals the derivation", async () => {
      const post = makePost({
        status: PublishStatus.published(),
        publications: recordsFor({ [CHANNEL_A]: "published" }),
        publishedAt: RECORDED_AT,
      });
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(result.ok, "a terminal state is answered, not rejected");
      assert.strictEqual(result.value.applied, false);
      assert.strictEqual(result.value.status, PUBLISH_STATUS.PUBLISHED);
      assert.strictEqual(
        result.value.publishedAt?.getTime(),
        RECORDED_AT.getTime(),
        "the first reconciliation's timestamp is the publication's record"
      );
      assert.strictEqual(result.value.version, 3, "no save, so no version advanced");
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(repo.save.mock.calls.length, 0);
      assert.strictEqual(post.domainEvents.length, 0, "and no second event was raised");
    });

    it("emits the published event exactly once, at the save, and never dispatches it itself", async () => {
      const post = makePost({
        status: PublishStatus.publishing(),
        publications: recordsFor({ [CHANNEL_A]: "published" }),
      });
      const seen: string[] = [];
      const repo = makePostRepo({ post });
      repo.savePublication.mockImplementation(async (aggregate: PostAggregate) => {
        for (const event of aggregate.domainEvents) {
          seen.push(event.constructor.name);
        }
        aggregate.incrementVersion();
        return ok(undefined);
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(result.ok);
      assert.deepStrictEqual(
        seen,
        ["PostPublished"],
        "the reconciliation re-announces no start: the episode was opened elsewhere"
      );
    });
  });

  describe("the optimistic-concurrency token", () => {
    it("returns CONFLICT for a stale expectedVersion when the word has to move", async () => {
      const repo = makePostRepo({
        post: makePost({
          status: PublishStatus.publishing(),
          publications: recordsFor({ [CHANNEL_A]: "published" }),
          version: 7,
        }),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
        expectedVersion: 3,
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("answers a stale expectedVersion with success when there is nothing to apply", async () => {
      // The reconciliation advances the version itself, so every retry of one
      // that already committed presents a token it already outdated (R4).
      const repo = makePostRepo({
        post: makePost({
          status: PublishStatus.published(),
          publications: recordsFor({ [CHANNEL_A]: "published" }),
          publishedAt: RECORDED_AT,
          version: 9,
        }),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
        expectedVersion: 3,
      });

      assert.ok(result.ok, "a saga whose post already settled must not fail on retry");
      assert.strictEqual(result.value.applied, false);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
    });

    it("recovers on the next attempt: a refused CONFLICT re-reads and reconciles the settled version", async () => {
      // The two halves belong in ONE case: a CONFLICT that is not recoverable
      // fails a saga that in fact completed, and a recovery that never
      // conflicted proves nothing about the token. The double answers the
      // SETTLED version on the second read — a concurrent writer committed
      // between the attempts — so a reconciliation that carried the refused
      // attempt's aggregate over would report 8 here instead of 9.
      const records = { [CHANNEL_A]: "published" as const };
      const repo = makePostRepo({
        reads: [
          makePost({
            status: PublishStatus.publishing(),
            publications: recordsFor(records),
            version: 7,
          }),
          makePost({
            status: PublishStatus.publishing(),
            publications: recordsFor(records),
            version: 8,
          }),
        ],
      });
      const uow = makeRecordingUow();
      const useCase = useCaseOver(repo, uow);

      const refused = await useCase.execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
        expectedVersion: 3,
      });

      assert.ok(!refused.ok, "the stale token is refused");
      assert.strictEqual(refused.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(
        repo.savePublication.mock.calls.length,
        0,
        "a refused reconciliation writes nothing"
      );

      // The retry carries NO token: the saga step forwards none, so recovery
      // must not depend on the caller computing a fresh one.
      const recovered = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(recovered.ok, "the next attempt reconciles instead of conflicting again");
      assert.strictEqual(recovered.value.applied, true);
      assert.strictEqual(recovered.value.status, PUBLISH_STATUS.PUBLISHED);
      assert.strictEqual(
        recovered.value.version,
        9,
        "the SETTLED version (8) advanced by this reconciliation's own save: proof the aggregate " +
          "was re-read inside the second transaction rather than carried over from the refusal"
      );
      assert.strictEqual(repo.savePublication.mock.calls.length, 1, "exactly one save");
      assert.strictEqual(repo.findById.mock.calls.length, 2, "one load per attempt");
      assert.strictEqual(uow.calls, 2, "and each attempt ran in its own transaction");
    });
  });

  describe("transaction semantics", () => {
    it("maps a VersionConflictError from the narrow save to CONFLICT, returned from inside the callback", async () => {
      const repo = makePostRepo({
        post: makePost({ status: PublishStatus.publishing() }),
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(
        uow.resultErrors.length,
        1,
        "the err must abort the transaction as a value"
      );
      assert.strictEqual(uow.resultErrors[0], result.error, "the same error object, not a copy");
    });

    it("recognises a version conflict raised by a DIFFERENT copy of the error class", async () => {
      // `@core/domain` ships a dual conditional export (`development` -> src,
      // `default` -> dist), which is exactly the resolution shape fitness #27
      // polices. Under it the adapter's `VersionConflictError` constructor and
      // the one this module imported can be two distinct objects, and class
      // identity stops matching while every shape stays equal. This double IS
      // that second copy: same `code`, same `name`, different constructor.
      // Narrowed by class identity the CAS conflict silently downgrades to
      // INTERNAL_ERROR — a lost update reported as an infrastructure blip,
      // with the suite green.
      const repo = makePostRepo({
        post: makePost({ status: PublishStatus.publishing() }),
        saveResult: err(new ForeignVersionConflictError()),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(!result.ok);
      assert.strictEqual(
        result.error.code,
        USE_CASE_ERRORS.CONFLICT,
        "a conflict is a conflict whichever module instance minted it"
      );
      assert.strictEqual(uow.resultErrors.length, 1, "and it still aborts the transaction");
    });

    it("maps any other save failure to INTERNAL_ERROR, returned from inside the callback", async () => {
      const repo = makePostRepo({
        post: makePost({ status: PublishStatus.publishing() }),
        saveResult: err(new Error("outbox write exploded")),
      });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
      assert.strictEqual(uow.resultErrors.length, 1);
      assert.strictEqual(uow.resultErrors[0], result.error);
    });

    it("classifies a raised tenant-guard failure into an error Result and writes nothing", async () => {
      const tenantFailure = new Error("Tenant context is required for this query");
      tenantFailure.name = "TenantContextMissingError";
      const repo = makePostRepo({ findByIdThrows: tenantFailure });
      const uow = makeRecordingUow();

      const result = await useCaseOver(repo, uow).execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
      });

      assert.ok(!result.ok, "an unscoped reconciliation is refused, never executed unscoped");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
      assert.strictEqual(result.error.originalError, tenantFailure);
      assert.strictEqual(repo.savePublication.mock.calls.length, 0);
      assert.strictEqual(
        uow.resultErrors.length,
        0,
        "a throw never becomes an err inside the seam"
      );
    });

    it("runs the whole reconciliation without a unit of work when none is injected", async () => {
      const repo = makePostRepo({ post: makePost({ status: PublishStatus.publishing() }) });
      const useCase = new CompletePostPublishingUseCase(repo.port);

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(result.ok, "the optional seam stays optional for unit callers");
      assert.strictEqual(result.value.status, PUBLISH_STATUS.PUBLISHED);
      assert.strictEqual(repo.savePublication.mock.calls.length, 1);
    });
  });

  describe("the record set the fixtures build", () => {
    it("builds records the aggregate itself produced, so a promoted set is one production could hold", () => {
      const records = recordsFor({ [CHANNEL_A]: "published", [CHANNEL_B]: "failed" });

      assert.strictEqual(records.length, 2);
      assert.strictEqual(records[0]?.channelId.value, CHANNEL_A_ID.value);
      assert.ok(records[0]?.isPublished(), "the published record settled a publication");
      assert.strictEqual(records[0]?.publishedAt?.getTime(), RECORDED_AT.getTime());
      assert.strictEqual(records[1]?.channelId.value, CHANNEL_B_ID.value);
      assert.ok(!records[1]?.isPublished(), "the failed record did not");
      assert.strictEqual(
        records[1]?.outcomeKind,
        PUBLICATION_OUTCOME_KINDS.EXCLUDED,
        "a nontransient failure settles as an exclusion, not as an unresolved channel"
      );
    });
  });
});
