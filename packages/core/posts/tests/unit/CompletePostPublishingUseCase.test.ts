/**
 * @file CompletePostPublishingUseCase.test.ts
 * @description Unit tests for the single writer of the publish-now promotion: the guard order
 *              (pure refusals before any I/O), the idempotent answer resolved BEFORE the OCC
 *              token, the FSM origins the state machine actually allows, the two-way `save()`
 *              error narrowing, and provider resolution that reports what it could not resolve
 *              without ever blocking a promotion. Doubles are of the PORTS, never of the use
 *              case under test.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err, type Result } from "@shared/types";
import {
  PostAggregate,
  PostId,
  ProjectId,
  PublishStatus,
  Content,
  VersionConflictError,
  EntityNotFoundError,
  type PostRepository,
  type ChannelRepository,
  type Channel,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { CompletePostPublishingUseCase } from "../../src/CompletePostPublishingUseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POST_UUID = "11111111-1111-4111-8111-111111111111";
const PROJECT_UUID = "44444444-4444-4444-8444-444444444444";
const CHANNEL_A = "22222222-2222-4222-8222-222222222222";
const CHANNEL_B = "33333333-3333-4333-8333-333333333333";

/**
 * The idempotent branch reads `publishedAt` off a PERSISTED row, so the fixture
 * timestamp must be DISTINCT from anything the promotion could write. An
 * assertion over two identical values cannot tell "preserved" from
 * "overwritten with the same value" (R4).
 */
const FIXTURE_PUBLISHED_AT = new Date("2024-01-01T00:00:00.000Z");

function makePost(options?: {
  status?: PublishStatus;
  version?: number;
  publishedAt?: Date;
}): PostAggregate {
  const contentResult = Content.create({ body: "Fixture body" });
  assert.ok(contentResult.ok, "fixture content must build");
  return PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(POST_UUID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_UUID),
    content: contentResult.value,
    status: options?.status ?? PublishStatus.draft(),
    ...(options?.publishedAt !== undefined && { publishedAt: options.publishedAt }),
    media: [],
    contentVersions: [],
    createdAt: new Date("2023-12-01T00:00:00.000Z"),
    updatedAt: new Date("2023-12-01T00:00:00.000Z"),
    version: options?.version ?? 3,
  });
}

// ---------------------------------------------------------------------------
// Port doubles
// ---------------------------------------------------------------------------

interface MockPostRepo {
  port: PostRepository;
  findById: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
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
  // The real repository bumps the in-memory version after the CAS update
  // (`PrismaPostRepository.doUpdate` calls `aggregate.incrementVersion()`), so
  // the double does the same — otherwise the suite would assert a version the
  // production path never produces.
  const save = vi.fn(async (aggregate: PostAggregate) => {
    const result = options?.saveResult ?? ok(undefined);
    if (result.ok) {
      aggregate.incrementVersion();
    }
    return result;
  });
  const port = {
    findById,
    save,
    delete: vi.fn(),
    exists: vi.fn(),
  } as unknown as PostRepository;
  return { port, findById, save };
}

function makeChannel(channelId: string, providerType: string): Channel {
  return {
    id: { value: channelId },
    provider: { type: providerType },
  } as unknown as Channel;
}

function makeChannelRepo(known?: Record<string, string>): ChannelRepository {
  const table = known ?? { [CHANNEL_A]: "X", [CHANNEL_B]: "INSTAGRAM" };
  return {
    findById: vi.fn(async (id: { value: string }) => {
      const provider = table[id.value];
      if (!provider) {
        return err(new EntityNotFoundError("Channel", id.value));
      }
      return ok(makeChannel(id.value, provider));
    }),
  } as unknown as ChannelRepository;
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
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const result = await useCase.execute({ postId: "not-a-uuid", outcome: TOTAL_OUTCOME });

      assert.ok(!result.ok, "an invalid id must be refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
      assert.strictEqual(repo.save.mock.calls.length, 0);
      assert.strictEqual(uow.calls, 0, "no transaction is opened to refuse an id");
    });

    it("returns VALIDATION_FAILED for an empty channel set — a vacuous total is not a publish", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const result = await useCase.execute({ postId: POST_UUID, outcome: { channels: [] } });

      assert.ok(!result.ok, "an empty scheduled set must be refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
      assert.strictEqual(repo.save.mock.calls.length, 0);
      assert.strictEqual(uow.calls, 0, "no transaction is opened to refuse an empty outcome");
    });

    it("returns NOT_IMPLEMENTED naming N-COR-2 when any channel did not publish", async () => {
      const repo = makePostRepo();
      const uow = makeRecordingUow();
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const result = await useCase.execute({
        postId: POST_UUID,
        outcome: {
          channels: [
            { channelId: CHANNEL_A, success: true },
            { channelId: CHANNEL_B, success: false, error: "rate limited" },
          ],
        },
      });

      assert.ok(!result.ok, "a non-total outcome must be refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_IMPLEMENTED);
      assert.match(result.error.message, /N-COR-2/);
      assert.strictEqual(repo.findById.mock.calls.length, 0);
      assert.strictEqual(repo.save.mock.calls.length, 0);
      assert.strictEqual(uow.calls, 0, "no transaction is opened to refuse a partial outcome");
    });
  });

  describe("loading and idempotency", () => {
    it("returns NOT_FOUND when the post does not exist", async () => {
      const repo = makePostRepo({
        findByIdResult: err(new EntityNotFoundError("Post", POST_UUID)),
      });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(repo.save.mock.calls.length, 0);
    });

    it("answers an already-PUBLISHED post with applied:false, no save, and the ORIGINAL publishedAt", async () => {
      const post = makePost({
        status: PublishStatus.published(),
        publishedAt: FIXTURE_PUBLISHED_AT,
      });
      const repo = makePostRepo({ post });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(result.ok, "a terminal state is answered, not rejected");
      assert.strictEqual(result.value.applied, false);
      assert.strictEqual(
        result.value.publishedAt.getTime(),
        FIXTURE_PUBLISHED_AT.getTime(),
        "the first promotion's timestamp is the publication's record"
      );
      assert.strictEqual(repo.save.mock.calls.length, 0);
      assert.strictEqual(post.domainEvents.length, 0);
    });

    it("refuses fail-closed when a PUBLISHED row carries no publishedAt, rather than fabricating one", async () => {
      // Reachable in principle: `bulkUpdateStatus` and the direct status writers
      // bypass the aggregate, so a PUBLISHED row with a NULL timestamp can exist.
      // Inventing a timestamp would mint a publication record that never happened.
      const post = makePost({ status: PublishStatus.published() });
      const repo = makePostRepo({ post });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(
        !result.ok,
        "an inconsistent persisted row must not be answered with a made-up date"
      );
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
      assert.match(result.error.message, /publishedAt/);
      assert.strictEqual(repo.save.mock.calls.length, 0);
    });
  });

  describe("OCC ordering and FSM origins", () => {
    it("returns CONFLICT for a stale expectedVersion on a still-DRAFT post", async () => {
      const repo = makePostRepo({ post: makePost({ version: 7 }) });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
        expectedVersion: 3,
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(repo.save.mock.calls.length, 0);
    });

    it("answers a stale expectedVersion on an already-PUBLISHED post with success, not CONFLICT", async () => {
      // The promotion advances the version itself, so every retry of a
      // SUCCESSFUL promotion presents a token that promotion already outdated.
      const repo = makePostRepo({
        post: makePost({
          status: PublishStatus.published(),
          version: 9,
          publishedAt: FIXTURE_PUBLISHED_AT,
        }),
      });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
        expectedVersion: 3,
      });

      assert.ok(result.ok, "the idempotent answer resolves BEFORE the version comparison");
      assert.strictEqual(result.value.applied, false);
      assert.strictEqual(repo.save.mock.calls.length, 0);
    });

    it("recovers on the next attempt: a refused CONFLICT re-reads and promotes against the settled version", async () => {
      // R5's third scenario, and the two halves belong in ONE case: a CONFLICT
      // that is not recoverable fails a saga that in fact completed, and a
      // recovery that never conflicted proves nothing about the token. The
      // double answers the SETTLED version on the second read — the concurrent
      // writer committed between the attempts — so a promotion that carried the
      // refused attempt's aggregate over would report 8 here instead of 9.
      const repo = makePostRepo({ reads: [makePost({ version: 7 }), makePost({ version: 8 })] });
      const uow = makeRecordingUow();
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const refused = await useCase.execute({
        postId: POST_UUID,
        outcome: TOTAL_OUTCOME,
        expectedVersion: 3,
      });

      assert.ok(!refused.ok, "the stale token is refused");
      assert.strictEqual(refused.error.code, USE_CASE_ERRORS.CONFLICT);
      assert.strictEqual(repo.save.mock.calls.length, 0, "a refused promotion writes nothing");

      // The retry carries NO token: the saga step forwards none (D4), so
      // recovery must not depend on the caller computing a fresh one.
      const recovered = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(recovered.ok, "the next attempt promotes instead of conflicting again");
      assert.strictEqual(recovered.value.applied, true);
      assert.strictEqual(recovered.value.status, "PUBLISHED");
      assert.strictEqual(
        recovered.value.version,
        9,
        "the SETTLED version (8) advanced by this promotion's own save: proof the aggregate was " +
          "re-read inside the second transaction rather than carried over from the refusal"
      );
      assert.strictEqual(repo.save.mock.calls.length, 1, "exactly one save, on the second attempt");
      assert.strictEqual(repo.findById.mock.calls.length, 2, "one load per attempt");
      assert.strictEqual(uow.calls, 2, "and each attempt ran in its own transaction");
    });

    it("refuses a CANCELLED origin — the state machine allows only CANCELLED to DRAFT", async () => {
      const repo = makePostRepo({ post: makePost({ status: PublishStatus.cancelled() }) });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
      assert.strictEqual(repo.save.mock.calls.length, 0);
    });

    it("refuses a PENDING_REVIEW origin — the state machine allows only SCHEDULED or DRAFT", async () => {
      // The other half of R5's tokenless refusal set. The design names
      // CANCELLED and PENDING_REVIEW together (§Residuals, W-C), and only one
      // of them was pinned: a test set of one cannot tell "the refusal set is
      // what the design says" from "CANCELLED happens to be refused".
      const repo = makePostRepo({ post: makePost({ status: PublishStatus.pendingReview() }) });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(!result.ok, "a post awaiting review was never scheduled, so nothing published it");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
      assert.strictEqual(repo.save.mock.calls.length, 0);
    });

    it("promotes a FAILED origin — FAILED to PUBLISHING is a legal edge, so a post the provider published is truthfully PUBLISHED", async () => {
      const post = makePost({ status: PublishStatus.failed() });
      const repo = makePostRepo({ post });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(result.ok, "a FAILED origin promotes");
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(result.value.status, "PUBLISHED");
      assert.strictEqual(repo.save.mock.calls.length, 1);
    });
  });

  describe("the promotion itself", () => {
    it("promotes a DRAFT through both hops in one save and reports the persisted version", async () => {
      const post = makePost({ version: 4 });
      const repo = makePostRepo({ post });
      const uow = makeRecordingUow();
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const before = new Date();
      const result = await useCase.execute({
        postId: POST_UUID,
        outcome: {
          channels: [
            { channelId: CHANNEL_A, success: true, externalId: "x-1" },
            { channelId: CHANNEL_B, success: true, externalId: "ig-1" },
          ],
        },
      });

      assert.ok(result.ok, "a total success promotes");
      assert.strictEqual(result.value.applied, true);
      assert.strictEqual(result.value.status, "PUBLISHED");
      assert.strictEqual(result.value.postId, POST_UUID);
      assert.strictEqual(result.value.version, 5, "the real post-save version, never a constant");
      assert.ok(result.value.publishedAt.getTime() >= before.getTime());
      assert.deepStrictEqual(result.value.unresolvedChannelIds, []);
      assert.strictEqual(repo.save.mock.calls.length, 1, "loaded once, saved once");
      assert.strictEqual(uow.calls, 1, "one transaction");
      assert.strictEqual(post.status.value, "PUBLISHED");
      assert.strictEqual(
        post.domainEvents.length,
        0,
        "events are cleared after the save; the outbox is the only delivery path"
      );
    });

    it("emits both transition events, started before published, and never dispatches them itself", async () => {
      const post = makePost();
      const seen: string[] = [];
      const repo = makePostRepo({ post });
      // Capture the events at save time — the use case clears them afterwards.
      repo.save.mockImplementation(async (aggregate: PostAggregate) => {
        for (const event of aggregate.domainEvents) {
          seen.push(event.constructor.name);
        }
        aggregate.incrementVersion();
        return ok(undefined);
      });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(result.ok);
      assert.deepStrictEqual(seen, ["PostPublishingStarted", "PostPublished"]);
    });

    it("does not start publishing twice when the persisted state is already PUBLISHING", async () => {
      const post = makePost({ status: PublishStatus.publishing() });
      const seen: string[] = [];
      const repo = makePostRepo({ post });
      repo.save.mockImplementation(async (aggregate: PostAggregate) => {
        for (const event of aggregate.domainEvents) {
          seen.push(event.constructor.name);
        }
        aggregate.incrementVersion();
        return ok(undefined);
      });
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo(),
        makeRecordingUow()
      );

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(result.ok);
      assert.deepStrictEqual(seen, ["PostPublished"]);
    });

    it("resolves no provider when the post is already PUBLISHING — the only consumer is the event it will not emit", async () => {
      // Resolution exists to name providers in `PostPublishingStarted` (D7).
      // This path emits no such event, so every channel read it makes is spent
      // inside the interactive transaction on a value nothing reads — and the
      // cost is N sequential reads, one per channel.
      const repo = makePostRepo({ post: makePost({ status: PublishStatus.publishing() }) });
      const channelRepo = makeChannelRepo();
      const channelFindById = channelRepo.findById as unknown as ReturnType<typeof vi.fn>;
      const useCase = new CompletePostPublishingUseCase(repo.port, channelRepo, makeRecordingUow());

      const result = await useCase.execute({
        postId: POST_UUID,
        outcome: {
          channels: [
            { channelId: CHANNEL_A, success: true },
            { channelId: CHANNEL_B, success: true },
          ],
        },
      });

      assert.ok(result.ok, "the promotion still completes");
      assert.strictEqual(
        channelFindById.mock.calls.length,
        0,
        "no channel is read when no started event will carry the result"
      );
      assert.deepStrictEqual(
        result.value.unresolvedChannelIds,
        [],
        "nothing failed to resolve because nothing needed resolving"
      );
    });
  });

  describe("transaction semantics", () => {
    it("maps a VersionConflictError from save to CONFLICT, returned from inside the callback", async () => {
      const repo = makePostRepo({
        saveResult: err(new VersionConflictError("Post", POST_UUID, 3, 4)),
      });
      const uow = makeRecordingUow();
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

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
      const repo = makePostRepo({ saveResult: err(new ForeignVersionConflictError()) });
      const uow = makeRecordingUow();
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(!result.ok);
      assert.strictEqual(
        result.error.code,
        USE_CASE_ERRORS.CONFLICT,
        "a conflict is a conflict whichever module instance minted it"
      );
      assert.strictEqual(uow.resultErrors.length, 1, "and it still aborts the transaction");
    });

    it("maps any other save failure to INTERNAL_ERROR, returned from inside the callback", async () => {
      const repo = makePostRepo({ saveResult: err(new Error("outbox write exploded")) });
      const uow = makeRecordingUow();
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

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
      const useCase = new CompletePostPublishingUseCase(repo.port, makeChannelRepo(), uow);

      const result = await useCase.execute({ postId: POST_UUID, outcome: TOTAL_OUTCOME });

      assert.ok(!result.ok, "an unscoped promotion is refused, never executed unscoped");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
      assert.strictEqual(result.error.originalError, tenantFailure);
      assert.strictEqual(repo.save.mock.calls.length, 0);
      assert.strictEqual(
        uow.resultErrors.length,
        0,
        "a throw never becomes an err inside the seam"
      );
    });
  });

  describe("provider resolution", () => {
    it("promotes and reports the ids it could not resolve, without blocking on them", async () => {
      const repo = makePostRepo();
      const useCase = new CompletePostPublishingUseCase(
        repo.port,
        makeChannelRepo({ [CHANNEL_A]: "X" }),
        makeRecordingUow()
      );

      const result = await useCase.execute({
        postId: POST_UUID,
        outcome: {
          channels: [
            { channelId: CHANNEL_A, success: true },
            { channelId: CHANNEL_B, success: true },
          ],
        },
      });

      assert.ok(result.ok, "totality is decided from the outcome, not from resolution");
      assert.strictEqual(result.value.applied, true);
      assert.deepStrictEqual(result.value.unresolvedChannelIds, [CHANNEL_B]);
      assert.strictEqual(repo.save.mock.calls.length, 1);
    });
  });
});
