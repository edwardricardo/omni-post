/**
 * Infrastructure Layer - Prisma Post Repository Unit Tests
 *
 * Part of FASE H12: Hexagonal Architecture - Soft Delete + Post Adapter
 * Tests PrismaPostRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 *
 * @file PrismaPostRepository.test.ts
 * @description Tests for PrismaPostRepository
 * @layer infrastructure
 */

import { describe, it, beforeEach, beforeAll, afterAll, vi, expect } from "vitest";
import { PrismaPostRepository, PrismaUnitOfWork } from "@adapters/db-prisma";
import { PostId, ProjectId, PUBLISH_STATUS } from "@core/domain/index.js";
import {
  ambientTenantContextProvider,
  withTenantContext,
} from "../../../src/security/tenantContext.js";

// ── console suppression ───────────────────────────────────────────────────────

let _originalConsoleLog: typeof console.log;
beforeAll(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
  console.log = _originalConsoleLog;
});

// ── helpers ───────────────────────────────────────────────────────────────────

const POST_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
const POST_ID_2 = "c0000000-0000-4000-8000-000000000002";
const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "aa000000-0000-4000-8000-00000000000a";
const PUBLISHED_AT = new Date("2026-03-01T09:00:00.000Z");
// The tenant scope every project-keyed collection/aggregate read now takes
// as its first argument.
const scope = { accountId: ACCOUNT_ID };

function basePostRow() {
  return {
    id: POST_ID,
    projectId: PROJECT_ID,
    accountId: ACCOUNT_ID,
    version: 2,
    status: "DRAFT",
    scheduledAt: null as Date | null,
    publishedAt: null as Date | null,
    deletedAt: null as Date | null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    contents: [
      {
        id: "d0000000-0000-4000-8000-000000000001",
        postId: POST_ID,
        locale: "en",
        title: "Test Post Title",
        summary: null as string | null,
        body: "Hello world content",
        tags: ["tag1", "tag2"],
        revision: 1,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ],
    media: [] as {
      id: string;
      postId: string;
      type: "image" | "video" | "gif";
      url: string;
      width: number | null;
      height: number | null;
      durationMs: number | null;
      alt: string | null;
      hash: string | null;
    }[],
    contentVersions: [] as { id: string; version: number }[],
    channelPublications: [] as unknown[],
  };
}

/**
 * One stored publication row. Defaults describe an unresolved channel; every case
 * below overrides only the columns it is about, so a row can be made corrupt in
 * exactly one way at a time.
 */
function publicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "f0000000-0000-4000-8000-000000000001",
    postId: POST_ID,
    accountId: ACCOUNT_ID,
    channelId: CHANNEL_ID,
    channel: { provider: "x" },
    outcome: "UNRESOLVED",
    externalId: null as string | null,
    externalIdMissing: false,
    liveFragments: [] as unknown[],
    pendingRetraction: false,
    retractionBlockedCause: null as string | null,
    actionWindowStartedAt: null as Date | null,
    actionWindowExpiredAt: null as Date | null,
    retractionAlertHash: null as string | null,
    retractionClearedCause: null as string | null,
    retractionClearedAt: null as Date | null,
    contentHash: null as string | null,
    publishedAt: null as Date | null,
    reasonCode: null as string | null,
    reasonDetail: null as string | null,
    lastFailureCode: null as string | null,
    lastFailureDetail: null as string | null,
    lastAttemptAt: PUBLISHED_AT as Date | null,
    attempts: 1,
    episode: 1,
    episodeAttempts: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/**
 * A post that published on its only channel: the word is PUBLISHED, the record
 * carries the fragment reference, and three events are pending. Built through the
 * ROOT, so the fixture cannot describe a state the aggregate would refuse.
 */
async function makePublishedAggregate() {
  const domain = await import("@core/domain/index.js");
  const channelId = domain.ChannelId.fromStringUnsafe(CHANNEL_ID);
  const post = domain.PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(POST_ID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    accountId: ACCOUNT_ID,
    content: domain.Content.reconstitute({ body: "hello", tags: [], locale: "en" }),
    status: domain.PublishStatus.scheduled(),
    media: [],
    contentVersions: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    version: 2,
  });

  const declared = post.declarePublicationTargets([channelId]);
  expect(declared.ok).toBeTruthy();
  const opened = post.openPublicationEpisode({ enterPublishing: true });
  expect(opened.ok).toBeTruthy();

  const fragment = domain.FragmentReference.create({ index: 1, externalId: "frag-1" });
  expect(fragment.ok).toBeTruthy();
  const head = domain.providedReference("frag-1");
  expect(head.ok).toBeTruthy();

  const recorded = post.recordChannelAttempt({
    channelId,
    episode: 1,
    attemptNo: 1,
    planSize: 1,
    result: {
      kind: "published",
      head: head.value,
      fragments: [fragment.value],
      publishedAt: PUBLISHED_AT,
      contentHash: domain.ContentFingerprint.ofContent({ body: "hello", mediaIds: [] }),
    },
    now: PUBLISHED_AT,
  });
  expect(recorded.ok).toBeTruthy();

  return post;
}

/** A post whose targets are declared and nothing else — no attempt, no edit. */
async function makeDeclaredAggregate() {
  const domain = await import("@core/domain/index.js");
  const post = domain.PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(POST_ID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    accountId: ACCOUNT_ID,
    content: domain.Content.reconstitute({ body: "hello", tags: [], locale: "en" }),
    status: domain.PublishStatus.scheduled(),
    media: [],
    contentVersions: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    version: 2,
  });

  expect(post.declarePublicationTargets([domain.ChannelId.fromStringUnsafe(CHANNEL_ID)]).ok).toBe(
    true
  );
  return post;
}

/** A post carrying declared targets and a PENDING content edit — the tripwire case. */
async function makeEditedAggregate() {
  const domain = await import("@core/domain/index.js");
  const post = domain.PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(POST_ID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    accountId: ACCOUNT_ID,
    content: domain.Content.reconstitute({ body: "hello", tags: [], locale: "en" }),
    status: domain.PublishStatus.draft(),
    media: [],
    contentVersions: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    version: 2,
  });

  expect(post.declarePublicationTargets([domain.ChannelId.fromStringUnsafe(CHANNEL_ID)]).ok).toBe(
    true
  );
  expect(post.updateContent({ body: "rewritten" }).ok).toBe(true);
  return post;
}

/** The same tripwire, entered through the media door instead of the content one. */
async function makeMediaAddedAggregate() {
  const domain = await import("@core/domain/index.js");
  const post = domain.PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(POST_ID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    accountId: ACCOUNT_ID,
    content: domain.Content.reconstitute({ body: "hello", tags: [], locale: "en" }),
    status: domain.PublishStatus.draft(),
    media: [],
    contentVersions: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    version: 2,
  });

  expect(post.declarePublicationTargets([domain.ChannelId.fromStringUnsafe(CHANNEL_ID)]).ok).toBe(
    true
  );
  const added = post.addMedia({
    id: domain.MediaId.generate(),
    type: "image",
    url: "https://example.com/i.jpg",
  });
  expect(added.ok).toBe(true);
  return post;
}

function makeTransactionMockClient() {
  return {
    // The create path reads the target project INSIDE the transaction to derive
    // the tenant it will write onto the post and its children. A double that
    // answered null here would abort every create with "Project not found".
    project: {
      findFirst: vi.fn(async () => ({ accountId: ACCOUNT_ID })),
    },
    post: {
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({ accountId: ACCOUNT_ID })),
      delete: vi.fn(async () => ({})),
    },
    postContent: {
      create: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    postMedia: {
      findMany: vi.fn(async () => [] as { id: string }[]),
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    postChannelPublication: {
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    publishLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    analytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    // The seam binds `app.account_id` as the transaction's first statement whenever
    // the resolved scope is defined, and it issues that through `$executeRaw`. The
    // unit of work binds the same GUC through `$queryRaw`, so both spellings are here
    // and each branch can be told apart by which one was called.
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ set_config: ACCOUNT_ID }]),
  };
}

function makeMockPrisma() {
  const txClient = makeTransactionMockClient();

  return {
    _txClient: txClient,
    post: {
      findFirst: vi.fn(async () => basePostRow()),
      findMany: vi.fn(async () => [basePostRow()]),
      create: vi.fn(async () => basePostRow()),
      update: vi.fn(async () => basePostRow()),
      delete: vi.fn(async () => basePostRow()),
      count: vi.fn(async () => 1),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    postContent: {
      create: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
    },
    postMedia: {
      findMany: vi.fn(async () => [] as { id: string }[]),
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    publishLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    analytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    // $transaction executes the callback immediately with the txClient
    $transaction: vi.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaPostRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaPostRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaPostRepository(prisma as never, undefined, ambientTenantContextProvider);
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns ok(PostAggregate) when row exists", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.id.value).toBe(POST_ID);
      expect(result.value.projectId.value).toBe(PROJECT_ID);
      expect(result.value.content.body).toBe("Hello world content");
      expect(result.value.status.value).toBe("DRAFT");
      expect(prisma.post.findFirst.mock.calls.length).toBe(1);
    });

    it("queries with deletedAt: null to exclude soft-deleted posts", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      await repo.findById(id);

      const callRecord = prisma.post.findFirst.mock.calls[0];
      const args = callRecord?.[0] as { where: { deletedAt: unknown } } | undefined;
      expect(args?.where.deletedAt).toEqual(null);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.post.findFirst.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Post/);
    });

    it("maps media attachments when present", async () => {
      const rowWithMedia = {
        ...basePostRow(),
        media: [
          {
            id: "e0000000-0000-4000-8000-000000000001",
            postId: POST_ID,
            type: "image" as const,
            url: "https://example.com/image.jpg",
            width: 1080,
            height: 1080,
            durationMs: null,
            alt: "An image",
            hash: null,
          },
        ],
      };
      prisma.post.findFirst.mockImplementation(async () => rowWithMedia);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.media.length).toBe(1);
      expect(result.value.media[0]?.type).toBe("image");
      expect(result.value.media[0]?.url).toBe("https://example.com/image.jpg");
    });

    it("maps scheduled post with scheduledAt", async () => {
      const futureDate = new Date(Date.now() + 3600_000);
      const scheduledRow = {
        ...basePostRow(),
        status: "SCHEDULED",
        scheduledAt: futureDate,
      };
      prisma.post.findFirst.mockImplementation(async () => scheduledRow);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.status.value).toBe("SCHEDULED");
      expect(result.value.scheduledAt !== undefined).toBeTruthy();
    });
  });

  // ── findById: a corrupted publication row is surfaced, never repaired ────────

  describe("findById — a stored publication row that cannot be read back", () => {
    it("refuses the post when a stored live fragment cannot be parsed", async () => {
      prisma.post.findFirst.mockImplementation(async () => ({
        ...basePostRow(),
        channelPublications: [
          publicationRow({
            outcome: "EXCLUDED",
            pendingRetraction: true,
            reasonCode: "THREAD_INTERRUPTED",
            actionWindowStartedAt: PUBLISHED_AT,
            liveFragments: [{ index: 1, externalId: "frag-1" }, { index: 2 }],
          }),
        ],
      }));

      await expect(repo.findById(PostId.fromStringUnsafe(POST_ID))).rejects.toThrow(
        /live fragment/i
      );
    });

    it("refuses the post when a published row carries an unreadable content fingerprint", async () => {
      prisma.post.findFirst.mockImplementation(async () => ({
        ...basePostRow(),
        channelPublications: [
          publicationRow({
            outcome: "PUBLISHED",
            externalId: "frag-1",
            publishedAt: PUBLISHED_AT,
            contentHash: "not-a-digest",
            liveFragments: [{ index: 1, externalId: "frag-1" }],
          }),
        ],
      }));

      await expect(repo.findById(PostId.fromStringUnsafe(POST_ID))).rejects.toThrow(/fingerprint/i);
    });

    it("refuses the post when a published row carries no content fingerprint at all", async () => {
      prisma.post.findFirst.mockImplementation(async () => ({
        ...basePostRow(),
        channelPublications: [
          publicationRow({
            outcome: "PUBLISHED",
            externalId: "frag-1",
            publishedAt: PUBLISHED_AT,
            liveFragments: [{ index: 1, externalId: "frag-1" }],
          }),
        ],
      }));

      await expect(repo.findById(PostId.fromStringUnsafe(POST_ID))).rejects.toThrow(/fingerprint/i);
    });

    it("refuses the post when an excluded row carries an unrecognised reason code", async () => {
      prisma.post.findFirst.mockImplementation(async () => ({
        ...basePostRow(),
        channelPublications: [publicationRow({ outcome: "EXCLUDED", reasonCode: "NOT_A_REASON" })],
      }));

      await expect(repo.findById(PostId.fromStringUnsafe(POST_ID))).rejects.toThrow(/reason/i);
    });

    it("returns the post with every stored fragment when the row reads back cleanly", async () => {
      prisma.post.findFirst.mockImplementation(async () => ({
        ...basePostRow(),
        channelPublications: [
          publicationRow({
            outcome: "EXCLUDED",
            pendingRetraction: true,
            reasonCode: "THREAD_INTERRUPTED",
            actionWindowStartedAt: PUBLISHED_AT,
            liveFragments: [
              { index: 1, externalId: "frag-1" },
              { index: 2, externalId: "frag-2" },
            ],
          }),
        ],
      }));

      const result = await repo.findById(PostId.fromStringUnsafe(POST_ID));

      expect(result.ok).toBeTruthy();
      const records = result.value.publications.all;
      expect(records.length).toBe(1);
      expect(records[0]?.liveFragments.length).toBe(2);
    });
  });

  // ── exists ──────────────────────────────────────────────────────────────────

  describe("exists", () => {
    it("returns true when count > 0", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.exists(id);
      expect(result).toBe(true);
    });

    it("returns false when count is 0", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.exists(id);
      expect(result).toBe(false);
    });

    it("counts only non-deleted posts (deletedAt: null)", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      await repo.exists(id);

      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.[0] as { where: { deletedAt: unknown } } | undefined;
      expect(args?.where.deletedAt).toEqual(null);
    });
  });

  // ── findOwnerAccountId ──────────────────────────────────────────────────────

  describe("findOwnerAccountId", () => {
    it("returns the owning accountId when the project relation resolves", async () => {
      prisma.post.findFirst.mockImplementation(
        async () => ({ project: { accountId: ACCOUNT_ID } }) as never
      );
      const result = await repo.findOwnerAccountId(PostId.fromStringUnsafe(POST_ID));

      expect(result?.value).toBe(ACCOUNT_ID);
    });

    it("returns null when the post row does not exist", async () => {
      prisma.post.findFirst.mockImplementation(async () => null as never);
      const result = await repo.findOwnerAccountId(PostId.fromStringUnsafe(POST_ID));

      expect(result).toBeNull();
    });

    it("returns null when the post is visible but its project relation is not", async () => {
      // The join CAN come back without its parent. Row security covers `Project` and does not
      // cover `Post`, so a caller whose scope excludes the project sees the post row and a
      // `project` of null — measured directly against PostgreSQL as `omnipost_app` with no
      // scope bound. Dereferencing it turns an authorization outcome into a TypeError that the
      // route reports as a 500, which tells the caller nothing and tells an attacker that the
      // id exists.
      prisma.post.findFirst.mockImplementation(async () => ({ project: null }) as never);
      const result = await repo.findOwnerAccountId(PostId.fromStringUnsafe(POST_ID));

      expect(result).toBeNull();
    });
  });

  // ── delete (soft) ───────────────────────────────────────────────────────────

  describe("delete (soft delete)", () => {
    it("calls post.update with deletedAt and returns ok when post exists", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.delete(id);

      expect(result.ok).toBeTruthy();
      // Soft delete: update, NOT hard delete
      expect(prisma.post.update.mock.calls.length).toBe(1);
      expect(prisma.post.delete.mock.calls.length).toBe(0);

      const callRecord = prisma.post.update.mock.calls[0];
      const args = callRecord?.[0] as { data: { deletedAt: unknown } } | undefined;
      expect(args?.data.deletedAt instanceof Date).toBeTruthy();
    });

    it("returns err(EntityNotFoundError) when post does not exist", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.delete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Post/);
      expect(prisma.post.update.mock.calls.length).toBe(0);
    });
  });

  // ── hardDelete ──────────────────────────────────────────────────────────────

  describe("hardDelete", () => {
    it("returns ok and executes cascade deletions in correct FK order", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeTruthy();
      // Transaction was called
      expect(prisma.$transaction.mock.calls.length).toBe(1);

      const tx = prisma._txClient;
      // Verify all cascade deletes were called
      expect(tx.publishLog.deleteMany.mock.calls.length).toBe(1);
      expect(tx.analytics.deleteMany.mock.calls.length).toBe(1);
      expect(tx.contentVersion.deleteMany.mock.calls.length).toBe(1);
      expect(tx.postMedia.deleteMany.mock.calls.length).toBe(1);
      expect(tx.tweet.deleteMany.mock.calls.length).toBe(1);
      expect(tx.thread.deleteMany.mock.calls.length).toBe(1);
      expect(tx.postContent.deleteMany.mock.calls.length).toBe(1);
      expect(tx.post.delete.mock.calls.length).toBe(1);
    });

    it("can delete even soft-deleted posts (findFirst has no deletedAt filter)", async () => {
      // findFirst returns a soft-deleted post (has deletedAt set)
      const softDeletedRow = { ...basePostRow(), deletedAt: new Date("2026-01-15") };
      prisma.post.findFirst.mockImplementation(async () => softDeletedRow);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeTruthy();
      expect(prisma.$transaction.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when post does not exist at all", async () => {
      prisma.post.findFirst.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Post/);
      expect(prisma.$transaction.mock.calls.length).toBe(0);
    });
  });

  // ── save (create path) ──────────────────────────────────────────────────────

  describe("save — new aggregate (create path)", () => {
    it("calls $transaction and creates post + content when post does not exist", async () => {
      // exists() returns false → create path
      prisma.post.count.mockImplementation(async () => 0);

      const postResult = await import("@core/domain/index.js").then((m) =>
        m.PostAggregate.create({
          projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
          body: "New post content",
        })
      );
      expect(postResult.ok).toBeTruthy();

      const saveResult = await repo.save(postResult.value);

      expect(saveResult.ok).toBeTruthy();
      expect(prisma.$transaction.mock.calls.length).toBe(1);

      const tx = prisma._txClient;
      expect(tx.post.create.mock.calls.length).toBe(1);
      expect(tx.postContent.create.mock.calls.length).toBe(1);

      // The tenant written onto both rows is the one READ from the project, not
      // anything the caller supplied — the aggregate carries no account at all.
      const postArgs = tx.post.create.mock.calls[0]?.[0] as { data: { accountId?: string } };
      const contentArgs = tx.postContent.create.mock.calls[0]?.[0] as {
        data: { accountId?: string };
      };
      expect(postArgs?.data?.accountId).toBe(ACCOUNT_ID);
      expect(contentArgs?.data?.accountId).toBe(ACCOUNT_ID);
    });

    it("binds the scope the INJECTED provider reports as the transaction's first statement", async () => {
      // exists() returns false → the standalone create path, which opens its own
      // GUC-bound transaction because no unit of work is active.
      prisma.post.count.mockImplementation(async () => 0);
      const injectedProvider = {
        getTenantContext: () => ({ accountId: "acc-injected" }),
        getSystemContext: () => undefined,
      };
      const injectedRepo = new PrismaPostRepository(prisma as never, undefined, injectedProvider);

      const postResult = await import("@core/domain/index.js").then((m) =>
        m.PostAggregate.create({
          projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
          body: "New post content",
        })
      );
      expect(postResult.ok).toBeTruthy();

      const saveResult = await injectedRepo.save(postResult.value);

      expect(saveResult.ok).toBeTruthy();
      const tx = prisma._txClient;
      const gucCall = tx.$executeRaw.mock.calls[0] as unknown as
        [TemplateStringsArray, string] | undefined;
      expect(gucCall?.[1]).toBe("acc-injected");
    });

    it("returns err when $transaction throws during create", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      prisma.$transaction.mockImplementation(async () => {
        throw new Error("DB write failed");
      });

      const postResult = await import("@core/domain/index.js").then((m) =>
        m.PostAggregate.create({
          projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
          body: "Content",
        })
      );
      expect(postResult.ok).toBeTruthy();

      const saveResult = await repo.save(postResult.value);

      expect(saveResult.ok).toBeFalsy();
      expect(saveResult.error.message).toMatch(/DB write failed/);
    });
  });

  // ── save (update path) ──────────────────────────────────────────────────────

  describe("save — existing aggregate (update path)", () => {
    it("calls $transaction and upserts content when post exists", async () => {
      // exists() returns true → update path
      prisma.post.count.mockImplementation(async () => 1);

      const findResult = await repo.findById(PostId.fromStringUnsafe(POST_ID));
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);

      expect(saveResult.ok).toBeTruthy();
      expect(prisma.$transaction.mock.calls.length).toBe(1);

      const tx = prisma._txClient;
      expect(tx.post.update.mock.calls.length).toBe(1);
      expect(tx.postContent.upsert.mock.calls.length).toBe(1);
    });

    it("returns err when $transaction throws during update", async () => {
      prisma.post.count.mockImplementation(async () => 1);
      prisma.$transaction.mockImplementation(async () => {
        throw new Error("Constraint violation");
      });

      const findResult = await repo.findById(PostId.fromStringUnsafe(POST_ID));
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);

      expect(saveResult.ok).toBeFalsy();
      expect(saveResult.error.message).toMatch(/Constraint violation/);
    });
  });

  // ── findByProjectId ─────────────────────────────────────────────────────────

  describe("findByProjectId", () => {
    it("returns paginated result with correct structure", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.findByProjectId(scope, projectId);

      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(result.hasNext).toBe(false);
      expect(result.hasPrevious).toBe(false);
    });

    it("applies custom pagination correctly", async () => {
      // Return multiple rows so pagination kicks in
      prisma.post.findMany.mockImplementation(async () => [
        basePostRow(),
        { ...basePostRow(), id: POST_ID_2 },
      ]);
      prisma.post.count.mockImplementation(async () => 10);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.findByProjectId(scope, projectId, { page: 2, limit: 2 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(2);
      expect(result.total).toBe(10);
      expect(result.totalPages).toBe(5);
      expect(result.hasNext).toBe(true);
      expect(result.hasPrevious).toBe(true);

      // Verify skip was calculated correctly (page 2, limit 2 → skip 2)
      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { skip: number; take: number } | undefined;
      expect(args?.skip).toBe(2);
      expect(args?.take).toBe(2);
    });

    it("filters by projectId and deletedAt: null", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(scope, projectId);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: Record<string, unknown> } | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
      expect(args?.where.deletedAt).toEqual(null);
    });

    it("applies sort parameter correctly", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(scope, projectId, undefined, {
        field: "scheduledAt",
        direction: "asc",
      });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { orderBy: Record<string, unknown> } | undefined;
      expect(args?.orderBy).toEqual({ scheduledAt: "asc" });
    });
  });

  // ── findByStatus ────────────────────────────────────────────────────────────

  describe("findByStatus", () => {
    it("returns paginated posts for a single status", async () => {
      const scheduledRow = { ...basePostRow(), status: "SCHEDULED" };
      prisma.post.findMany.mockImplementation(async () => [scheduledRow]);
      prisma.post.count.mockImplementation(async () => 1);

      const result = await repo.findByStatus(PUBLISH_STATUS.SCHEDULED);

      expect(result.items.length).toBe(1);
      expect(result.items[0]?.status.value).toBe("SCHEDULED");
    });

    it("accepts an array of statuses", async () => {
      await repo.findByStatus([PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.SCHEDULED]);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { status: { in: string[] } } } | undefined;
      expect(args?.where.status.in).toEqual(["DRAFT", "SCHEDULED"]);
    });

    it("always includes deletedAt: null filter", async () => {
      await repo.findByStatus(PUBLISH_STATUS.DRAFT);

      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.[0] as { where: { deletedAt: unknown } } | undefined;
      expect(args?.where.deletedAt).toEqual(null);
    });
  });

  // ── findReadyForPublishing ──────────────────────────────────────────────────

  describe("findReadyForPublishing", () => {
    it("returns posts with SCHEDULED status and past scheduledAt", async () => {
      const pastDate = new Date(Date.now() - 3600_000);
      const scheduledRow = {
        ...basePostRow(),
        status: "SCHEDULED",
        scheduledAt: pastDate,
      };
      prisma.post.findMany.mockImplementation(async () => [scheduledRow]);

      const posts = await repo.findReadyForPublishing();

      expect(posts.length).toBe(1);
      expect(posts[0]?.status.value).toBe("SCHEDULED");
    });

    it("passes limit to Prisma take", async () => {
      prisma.post.findMany.mockImplementation(async () => []);

      await repo.findReadyForPublishing(50);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { take: number } | undefined;
      expect(args?.take).toBe(50);
    });

    it("uses default limit of 100 when not specified", async () => {
      prisma.post.findMany.mockImplementation(async () => []);

      await repo.findReadyForPublishing();

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { take: number } | undefined;
      expect(args?.take).toBe(100);
    });

    it("filters by SCHEDULED status and lte scheduledAt", async () => {
      prisma.post.findMany.mockImplementation(async () => []);

      await repo.findReadyForPublishing();

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { status: string; scheduledAt: { lte: Date }; deletedAt: unknown };
          }
        | undefined;
      expect(args?.where.status).toBe("SCHEDULED");
      expect(args?.where.scheduledAt.lte instanceof Date).toBeTruthy();
      expect(args?.where.deletedAt).toEqual(null);
    });
  });

  // ── findWithFilters ─────────────────────────────────────────────────────────

  describe("findWithFilters", () => {
    it("returns paginated result with no filters (base deletedAt: null)", async () => {
      const result = await repo.findWithFilters({});

      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
    });

    it("applies projectId filter", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findWithFilters({ projectId });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { projectId: string } } | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
    });

    it("applies status filter (array)", async () => {
      await repo.findWithFilters({ status: [PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.PUBLISHED] });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { status: { in: string[] } } } | undefined;
      expect(args?.where.status.in).toEqual(["DRAFT", "PUBLISHED"]);
    });

    it("applies date range filters for scheduledBefore and scheduledAfter", async () => {
      const before = new Date("2026-02-01");
      const after = new Date("2026-01-01");
      await repo.findWithFilters({ scheduledBefore: before, scheduledAfter: after });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { scheduledAt: { lte: Date; gte: Date } };
          }
        | undefined;
      expect(args?.where.scheduledAt.lte).toEqual(before);
      expect(args?.where.scheduledAt.gte).toEqual(after);
    });

    it("applies date range filters for createdBefore and createdAfter", async () => {
      const before = new Date("2026-02-01");
      const after = new Date("2026-01-01");
      await repo.findWithFilters({ createdBefore: before, createdAfter: after });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { createdAt: { lte: Date; gte: Date } };
          }
        | undefined;
      expect(args?.where.createdAt.lte).toEqual(before);
      expect(args?.where.createdAt.gte).toEqual(after);
    });

    it("applies hasMedia: true filter using some: {}", async () => {
      await repo.findWithFilters({ hasMedia: true });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { media: unknown } } | undefined;
      expect(args?.where.media).toEqual({ some: {} });
    });

    it("applies hasMedia: false filter using none: {}", async () => {
      await repo.findWithFilters({ hasMedia: false });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { media: unknown } } | undefined;
      expect(args?.where.media).toEqual({ none: {} });
    });

    it("applies searchText filter on contents body and title", async () => {
      await repo.findWithFilters({ searchText: "hello" });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { OR: unknown[] } } | undefined;
      expect(Array.isArray(args?.where.OR)).toBeTruthy();
      expect(args?.where.OR.length).toBe(2);
    });
  });

  // ── countByProjectId ────────────────────────────────────────────────────────

  describe("countByProjectId", () => {
    it("returns count of non-deleted posts for a project", async () => {
      prisma.post.count.mockImplementation(async () => 7);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByProjectId(scope, projectId);

      expect(count).toBe(7);
      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { projectId: string; deletedAt: unknown };
          }
        | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
      expect(args?.where.deletedAt).toEqual(null);
    });

    it("returns 0 when project has no posts", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByProjectId(scope, projectId);
      expect(count).toBe(0);
    });
  });

  // ── countByStatus ───────────────────────────────────────────────────────────

  describe("countByStatus", () => {
    it("counts posts for a specific project and status", async () => {
      prisma.post.count.mockImplementation(async () => 3);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByStatus(scope, projectId, PUBLISH_STATUS.DRAFT);

      expect(count).toBe(3);
      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { projectId: string; status: string; deletedAt: unknown };
          }
        | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
      expect(args?.where.status).toBe("DRAFT");
      expect(args?.where.deletedAt).toEqual(null);
    });

    it("returns 0 when no posts match status", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByStatus(scope, projectId, PUBLISH_STATUS.PUBLISHED);
      expect(count).toBe(0);
    });
  });

  // ── getProjectStats ─────────────────────────────────────────────────────────

  describe("getProjectStats", () => {
    it("returns correct stats object with all fields", async () => {
      // Simulate 5 sequential count calls: total, drafts, scheduled, published, failed
      let callCount = 0;
      const counts = [10, 5, 2, 2, 1];
      prisma.post.count.mockImplementation(async () => counts[callCount++] ?? 0);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const stats = await repo.getProjectStats(scope, projectId);

      expect(stats.total).toBe(10);
      expect(stats.drafts).toBe(5);
      expect(stats.scheduled).toBe(2);
      expect(stats.published).toBe(2);
      expect(stats.failed).toBe(1);
    });

    it("makes 5 count queries (total + 4 statuses)", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getProjectStats(scope, projectId);

      expect(prisma.post.count.mock.calls.length).toBe(5);
    });

    it("all queries include deletedAt: null and projectId filters", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getProjectStats(scope, projectId);

      for (const call of prisma.post.count.mock.calls) {
        const args = call?.[0] as { where: { projectId: string; deletedAt: unknown } } | undefined;
        expect(args?.where.projectId).toBe(PROJECT_ID);
        expect(args?.where.deletedAt).toEqual(null);
      }
    });
  });

  // ── bulkUpdateStatus ────────────────────────────────────────────────────────

  describe("bulkUpdateStatus", () => {
    it("calls updateMany with correct ids and status, returns ok", async () => {
      const postIds = [PostId.fromStringUnsafe(POST_ID), PostId.fromStringUnsafe(POST_ID_2)];

      const result = await repo.bulkUpdateStatus(postIds, PUBLISH_STATUS.PUBLISHED);

      expect(result.ok).toBeTruthy();
      expect(prisma.post.updateMany.mock.calls.length).toBe(1);

      const callRecord = prisma.post.updateMany.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { id: { in: string[] }; deletedAt: unknown };
            data: { status: string };
          }
        | undefined;
      expect(args?.where.id.in).toEqual([POST_ID, POST_ID_2]);
      expect(args?.where.deletedAt).toEqual(null);
      expect(args?.data.status).toBe("PUBLISHED");
    });

    it("returns ok with empty array (no-op)", async () => {
      const result = await repo.bulkUpdateStatus([], PUBLISH_STATUS.DRAFT);
      expect(result.ok).toBeTruthy();
    });

    it("returns err when updateMany throws", async () => {
      prisma.post.updateMany.mockImplementation(async () => {
        throw new Error("Bulk update failed");
      });

      const postIds = [PostId.fromStringUnsafe(POST_ID)];
      const result = await repo.bulkUpdateStatus(postIds, PUBLISH_STATUS.FAILED);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Bulk update failed/);
    });
  });

  // ── savePublication (the narrow save) ───────────────────────────────────────

  describe("savePublication — the narrow save", () => {
    it("writes the status, the publication moment and the version bump, and no content or media statement", async () => {
      const post = await makePublishedAggregate();

      const result = await repo.savePublication(post);

      expect(result.ok).toBeTruthy();
      const tx = prisma._txClient;
      expect(tx.post.update.mock.calls.length).toBe(1);
      const args = tx.post.update.mock.calls[0]?.[0] as {
        where: { id: string; version: number };
        data: Record<string, unknown>;
      };
      expect(args.where.id).toBe(POST_ID);
      expect(args.where.version).toBe(2);
      expect(args.data.status).toBe("PUBLISHED");
      expect(args.data.publishedAt).toBeInstanceOf(Date);
      expect(args.data.version).toEqual({ increment: 1 });
      // The narrow save touches the word, the moment and the records. Nothing else:
      // a save that also rewrote content would let a publication write carry an edit
      // of content that is already live.
      expect(Object.keys(args.data).sort()).toEqual(["publishedAt", "status", "version"]);
      expect(tx.postContent.upsert.mock.calls.length).toBe(0);
      expect(tx.postContent.create.mock.calls.length).toBe(0);
      expect(tx.postMedia.upsert.mock.calls.length).toBe(0);
      expect(tx.postMedia.createMany.mock.calls.length).toBe(0);
      expect(tx.postMedia.deleteMany.mock.calls.length).toBe(0);
    });

    it("upserts one publication row per record, keyed by (post, channel) and carrying the parent's tenant", async () => {
      const post = await makePublishedAggregate();

      const result = await repo.savePublication(post);

      expect(result.ok).toBeTruthy();
      const tx = prisma._txClient;
      expect(tx.postChannelPublication.upsert.mock.calls.length).toBe(1);
      const args = tx.postChannelPublication.upsert.mock.calls[0]?.[0] as {
        where: { postId_channelId: { postId: string; channelId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };
      expect(args.where.postId_channelId).toEqual({ postId: POST_ID, channelId: CHANNEL_ID });
      expect(args.create.accountId).toBe(ACCOUNT_ID);
      expect(args.create.outcome).toBe("PUBLISHED");
      expect(args.create.externalId).toBe("frag-1");
      expect(args.create.liveFragments).toEqual([{ index: 1, externalId: "frag-1" }]);
      expect(args.update.outcome).toBe("PUBLISHED");
      expect(args.update.attempts).toBe(1);
      expect(args.update.episode).toBe(1);
    });

    it("binds the tenant as the first statement and runs every write on that one transaction", async () => {
      const post = await makePublishedAggregate();

      const result = await withTenantContext({ accountId: ACCOUNT_ID }, () =>
        repo.savePublication(post)
      );

      expect(result.ok).toBeTruthy();
      // ONE transaction: the narrow save never splits its statements across two
      // connections, where the second would commit through the first's rollback.
      expect(prisma.$transaction.mock.calls.length).toBe(1);
      const tx = prisma._txClient;
      // The GUC bind is the transaction's first statement, so every write below it
      // is governed by `tenant_isolation` for THIS tenant.
      expect(tx.$executeRaw.mock.calls.length).toBe(1);
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.post.update.mock.invocationCallOrder[0] as number
      );
      expect(tx.post.update.mock.invocationCallOrder[0]).toBeLessThan(
        tx.postChannelPublication.upsert.mock.invocationCallOrder[0] as number
      );
      // Nothing ran on the injected client, which the enclosing transaction does
      // not own and which no bind would reach.
      expect(prisma.post.update.mock.calls.length).toBe(0);
    });

    it("reuses the open unit of work instead of opening a transaction of its own", async () => {
      const post = await makePublishedAggregate();
      const uow = new PrismaUnitOfWork(prisma as never, ambientTenantContextProvider);

      const result = await withTenantContext({ accountId: ACCOUNT_ID }, () =>
        uow.executeInTransaction(() => repo.savePublication(post))
      );

      expect(result.ok).toBeTruthy();
      // Exactly one transaction, opened by the unit of work — which binds the same
      // GUC from the same provider before handing the client on.
      expect(prisma.$transaction.mock.calls.length).toBe(1);
      const tx = prisma._txClient;
      expect(tx.$queryRaw.mock.calls.length).toBe(1);
      expect(tx.post.update.mock.calls.length).toBe(1);
      expect(tx.postChannelPublication.upsert.mock.calls.length).toBe(1);
      expect(prisma.post.update.mock.calls.length).toBe(0);
    });

    it("writes the pending domain events to the outbox inside the same transaction", async () => {
      const writeEvents = vi.fn(async () => {});
      const outboxRepo = new PrismaPostRepository(
        prisma as never,
        { writeEvents } as never,
        ambientTenantContextProvider
      );
      const post = await makePublishedAggregate();

      const result = await outboxRepo.savePublication(post);

      expect(result.ok).toBeTruthy();
      expect(writeEvents.mock.calls.length).toBe(1);
      const written = (
        writeEvents.mock.calls[0] as unknown as [unknown, { eventType: string }[]]
      )[1];
      expect(written.map((event) => event.eventType)).toContain("PostChannelPublished");
      expect(written.map((event) => event.eventType)).toContain("PostPublished");
    });

    it("refuses when a content event is pending, writing nothing", async () => {
      const post = await makeEditedAggregate();

      const result = await repo.savePublication(post);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/PostContentUpdated/);
      const tx = prisma._txClient;
      expect(tx.post.update.mock.calls.length).toBe(0);
      expect(tx.postChannelPublication.upsert.mock.calls.length).toBe(0);
    });

    it("refuses when a media event is pending, writing nothing", async () => {
      const post = await makeMediaAddedAggregate();

      const result = await repo.savePublication(post);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/PostMediaAdded/);
      expect(prisma._txClient.post.update.mock.calls.length).toBe(0);
    });

    it("returns a version conflict when the compare-and-swap matches no row", async () => {
      prisma._txClient.post.update.mockImplementation(async () => {
        throw Object.assign(new Error("Record to update not found"), { code: "P2025" });
      });
      prisma._txClient.post.findUnique = vi.fn(async () => ({ version: 7 }));
      const post = await makePublishedAggregate();

      const result = await repo.savePublication(post);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/version conflict/i);
      expect(prisma._txClient.postChannelPublication.upsert.mock.calls.length).toBe(0);
    });

    it("refuses when the word has diverged from the record", async () => {
      const domain = await import("@core/domain/index.js");
      const post = await makePublishedAggregate();
      // A word that outran its record: the derivation still reads PUBLISHED for one
      // channel, so a second, unresolved channel must make the save refuse.
      const declared = domain.ChannelPublication.declare(
        domain.ChannelId.fromStringUnsafe("aa000000-0000-4000-8000-00000000000b")
      );
      const diverged = domain.PostAggregate.reconstitute({
        id: PostId.fromStringUnsafe(POST_ID),
        projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
        accountId: ACCOUNT_ID,
        content: post.content,
        status: post.status,
        media: [],
        contentVersions: [],
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        version: 2,
        publications: [...post.publications.all, declared],
      });

      const result = await repo.savePublication(diverged);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/derives/);
      expect(prisma._txClient.post.update.mock.calls.length).toBe(0);
    });

    it("writes NO publication row from the full save, even with targets declared", async () => {
      // The narrow save is the ONLY production writer of the record. The full save
      // runs neither of the two refusals the narrow one runs — the projection
      // invariant and the pending-edit tripwire — so a record written through it
      // would be a record nothing checked.
      prisma.post.count.mockImplementation(async () => 1);
      const post = await makeDeclaredAggregate();

      const result = await repo.save(post);

      expect(result.ok).toBeTruthy();
      expect(post.publications.size).toBe(1);
      expect(prisma._txClient.post.update.mock.calls.length).toBe(1);
      expect(prisma._txClient.postChannelPublication.upsert.mock.calls.length).toBe(0);
    });
  });
});
