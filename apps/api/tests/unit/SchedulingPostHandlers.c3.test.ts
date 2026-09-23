/**
 * @file SchedulingPostHandlers.c3.test.ts
 * @description The two admin direct writers of the post's status word, and the guard
 *              that stops them clobbering a post whose content is already live on a
 *              provider. Both handlers read the post OUTSIDE the transaction they then
 *              write in, so the decision they take can be stale by the time it lands;
 *              what is proved here is that each one re-reads the publication record
 *              INSIDE its own transaction, refuses when any channel holds live content,
 *              and hands the database a compare-and-swap `where` so a word that moved
 *              between the two reads loses the write instead of being overwritten.
 *
 *              Two suites, one file: the guards are the same mechanism twice, and a
 *              single double is what keeps them from drifting apart.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { ErrorCode } from "@shared/types";
import {
  ChannelPublication,
  type ChannelPublicationState,
} from "@core/domain/entities/ChannelPublication.js";
import { ChannelId } from "@core/domain/value-objects/EntityId.js";
import { ContentFingerprint } from "@core/domain/value-objects/ContentFingerprint.js";
import { providedReference } from "@core/domain/value-objects/ProviderReference.js";
import {
  CHANNEL_FAILURE_CODES,
  ExclusionReason,
} from "@core/domain/value-objects/ExclusionReason.js";
import {
  PUBLICATION_OUTCOME_KINDS,
  type PublicationOutcomeKind,
} from "@core/domain/value-objects/PublicationOutcome.js";
import { SchedulingPostRouteHandler } from "../../src/admin/SchedulingPostHandlers.js";

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

const POST_ID = "66666666-6666-4666-8666-666666666666";
const LIVE_CHANNEL_ID = "77777777-7777-4777-8777-777777777777";
/**
 * The owner every row here carries. `accountId` is non-nullable on `Post`, and both
 * writers resolve it before they touch anything else, so a row without one is a row the
 * database cannot hold — and a double that omitted it would answer 404 to every case.
 */
const OWNER_ACCOUNT_ID = "55555555-5555-4555-8555-555555555555";

/** One publication row as the guard reads it: the two columns that decide liveness. */
interface PublicationRow {
  channelId: string;
  outcome: "UNRESOLVED" | "PUBLISHED" | "EXCLUDED";
  pendingRetraction: boolean;
}

/** A `post.findFirst` as these handlers issue it. */
interface FindFirstArgs {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
}

/** A `post.update` as the guard hands it over: the compare-and-swap and the new word. */
interface UpdateArgs {
  where: { id?: unknown; status?: unknown };
  data: { status: string; scheduledAt?: Date | null };
}

/** A `publishLog.updateMany` the transaction reached. */
interface UpdateManyArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

interface Recorded {
  /** Every `post.findFirst`, with whether it was issued inside the transaction. */
  reads: Array<{ args: FindFirstArgs; inTransaction: boolean }>;
  /** Every `post.update` the transaction reached. */
  updates: UpdateArgs[];
  /** Every `publishLog.updateMany` the transaction reached. */
  logUpdates: UpdateManyArgs[];
}

interface DoubleOptions {
  /** The row the OUTER read answers, or null for "no such post". */
  post: Record<string, unknown> | null;
  /** The publication rows the IN-TRANSACTION read answers. */
  publications: PublicationRow[];
  /** When true, `post.update` answers as Prisma does for a lost compare-and-swap. */
  casLost?: boolean;
  /**
   * What `post.update` rejects with instead, for the failures that are NOT a lost swap.
   * The refusal path keys on `P2025` exactly, and this is what pins that the exactness is
   * load-bearing: any other rejection must keep reaching the 500 it always did.
   */
  updateRejectsWith?: unknown;
  /**
   * What `publishLog.updateMany` rejects with. The log write shares the swap's
   * transaction, so a `P2025` raised HERE is the case that tells a discriminator keyed on
   * the error code apart from one keyed on the statement that raised it.
   */
  logUpdateRejectsWith?: unknown;
  /** When true, the post is gone by the time the transaction re-reads it. */
  vanishesInTransaction?: boolean;
}

/** A row that makes each handler reach its log write; only the count is read. */
const QUEUED_LOG = { id: "99999999-9999-4999-8999-999999999999" };

/**
 * @function recordNotFound
 * @description Prisma's rejection for a single-row write whose `where` matched nothing.
 * @param message - What the statement was doing, for the failure text.
 * @returns The error object, carrying `P2025` exactly as the client does.
 */
function recordNotFound(message: string): Error {
  return Object.assign(new Error(message), { code: "P2025" });
}

/**
 * @function prismaDouble
 * @description The narrow slice of the client these two handlers touch, recording what
 *              was asked and where. `$transaction` is interactive, matching the real
 *              seam, so a read the handler issues through `tx` is distinguishable from
 *              one it issues on the client — which is the whole subject of two cases.
 *
 *              Typed all the way down, with exactly ONE coercion — the handoff to the
 *              production constructor — because a double's SHAPE is knowable and only
 *              its identity as a `PrismaClient` is not. That is the same rule the three
 *              markers in `helpers/mockPrisma.ts` follow: mark the cast that defeats the
 *              compiler, and give everything else a real type.
 * @param options - What the reads answer and whether the write loses its race.
 * @returns The double and the call log.
 */
function prismaDouble(options: DoubleOptions): { prisma: PrismaClient; recorded: Recorded } {
  const recorded: Recorded = { reads: [], updates: [], logUpdates: [] };
  let inTransaction = false;

  const findFirst = async (args: FindFirstArgs) => {
    recorded.reads.push({ args, inTransaction });
    if (options.post === null) {
      return null;
    }
    if (inTransaction && options.vanishesInTransaction === true) {
      return null;
    }
    return {
      id: POST_ID,
      accountId: OWNER_ACCOUNT_ID,
      deletedAt: null,
      scheduledAt: null,
      publishLogs: [],
      ...options.post,
      channelPublications: options.publications,
    };
  };

  const tx = {
    $executeRaw: async () => 0,
    post: {
      findFirst,
      update: async (args: UpdateArgs) => {
        recorded.updates.push(args);
        if (options.updateRejectsWith !== undefined) {
          throw options.updateRejectsWith;
        }
        if (options.casLost === true) {
          throw recordNotFound("An operation failed because it depends on one or more records");
        }
        return {
          id: POST_ID,
          status: args.data.status,
          scheduledAt: args.data.scheduledAt ?? null,
        };
      },
    },
    publishLog: {
      updateMany: async (args: UpdateManyArgs) => {
        recorded.logUpdates.push(args);
        if (options.logUpdateRejectsWith !== undefined) {
          throw options.logUpdateRejectsWith;
        }
        return { count: 0 };
      },
    },
  };

  const prisma = {
    post: { findFirst },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await fn(tx);
      } finally {
        inTransaction = false;
      }
    },
  };

  // canon-exception: test-fixture — the double carries only the slice these two handlers
  // touch, which is not provably a `PrismaClient`; the double assertion says so rather
  // than claiming an overlap the compiler has already refused.
  return { prisma: prisma as unknown as PrismaClient, recorded };
}

/** What `sendError` / `sendSuccess` put on the reply, as these cases read it. */
interface SentBody {
  details?: { code?: unknown; channelIds?: unknown };
}

/** The reply surface `BaseRouteHandler.sendError` / `sendSuccess` drive. */
function replyDouble(): { reply: FastifyReply; sent: { statusCode: number; body: SentBody } } {
  const sent: { statusCode: number; body: SentBody } = { statusCode: 0, body: {} };
  const reply = {
    code(statusCode: number) {
      sent.statusCode = statusCode;
      return reply;
    },
    send(body: unknown) {
      // canon-exception: test-fixture — the serializer's body is opaque here; the cast
      // narrows it to the two fields these cases read.
      sent.body = body as SentBody;
      return reply;
    },
  };
  // canon-exception: test-fixture — same reason as the client double above: the two
  // methods the handler calls are all that exists, which is not a `FastifyReply`.
  return { reply: reply as unknown as FastifyReply, sent };
}

function requestDouble(body?: Record<string, unknown>): FastifyRequest {
  const request = {
    params: { id: POST_ID },
    ...(body !== undefined && { body }),
    headers: {},
    id: "req-1",
    url: "/admin/posts",
    method: "POST",
  };
  // canon-exception: test-fixture — the request carries only the fields the validators
  // and the logger read, which is not a `FastifyRequest`.
  return request as unknown as FastifyRequest;
}

const LIVE_PUBLISHED: PublicationRow = {
  channelId: LIVE_CHANNEL_ID,
  outcome: "PUBLISHED",
  pendingRetraction: false,
};
const LIVE_STRANDED: PublicationRow = {
  channelId: LIVE_CHANNEL_ID,
  outcome: "EXCLUDED",
  pendingRetraction: true,
};
const NOT_LIVE: PublicationRow = {
  channelId: LIVE_CHANNEL_ID,
  outcome: "UNRESOLVED",
  pendingRetraction: false,
};

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

/**
 * The failures that are NOT a lost compare-and-swap. `P2002` is a real Prisma code from
 * the same error family, so a refusal path that tested "does it carry a code" rather
 * than "is that code P2025" would answer it as a conflict; the bare `Error` is the other
 * side — a fault with no code at all. Both must stay 500s, because a 409 tells the
 * operator the post moved on when in fact the write failed.
 */
const NOT_A_LOST_SWAP: ReadonlyArray<{ label: string; error: unknown }> = [
  {
    label: "a Prisma error with a DIFFERENT code",
    error: Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
  },
  { label: "a fault carrying no code at all", error: new Error("connection reset") },
];

/**
 * The column spelling of each outcome kind, as `PostPublicationWrites.publicationRowData`
 * writes it — the ONE writer of that column in the tree. Typed as a total `Record` over
 * the kind union, so a kind added to the domain stops this file compiling instead of
 * quietly going unexercised.
 */
const OUTCOME_COLUMN: Record<PublicationOutcomeKind, PublicationRow["outcome"]> = {
  [PUBLICATION_OUTCOME_KINDS.UNRESOLVED]: "UNRESOLVED",
  [PUBLICATION_OUTCOME_KINDS.PUBLISHED]: "PUBLISHED",
  [PUBLICATION_OUTCOME_KINDS.EXCLUDED]: "EXCLUDED",
};

const SETTLEMENT_MOMENT = new Date("2026-03-01T09:00:00.000Z");

/**
 * @function settledStateOf
 * @description The stored state of one settlement, carrying exactly the facts
 *              `ChannelPublication.reconstitute` refuses to rebuild without. The
 *              settled facts are ADDED per branch rather than set to `undefined` on a
 *              shared object: `exactOptionalPropertyTypes` rejects the latter, and an
 *              unresolved state carrying a settled key is precisely what the entity
 *              refuses.
 * @param outcomeKind - Which settlement the record holds.
 * @param pendingRetraction - Whether fragments are still on the provider.
 * @returns The stored state.
 */
function settledStateOf(
  outcomeKind: PublicationOutcomeKind,
  pendingRetraction: boolean
): ChannelPublicationState {
  const base: ChannelPublicationState = {
    id: "88888888-8888-4888-8888-888888888888",
    channelId: ChannelId.fromStringUnsafe(LIVE_CHANNEL_ID),
    outcomeKind,
    pendingRetraction,
  };

  if (outcomeKind === PUBLICATION_OUTCOME_KINDS.PUBLISHED) {
    const head = providedReference("frag-1");
    if (!head.ok) {
      throw new Error("the provider-reference fixture is invalid");
    }
    return {
      ...base,
      head: head.value,
      publishedAt: SETTLEMENT_MOMENT,
      contentHash: ContentFingerprint.ofContent({ body: "hello", mediaIds: [] }),
    };
  }

  if (outcomeKind === PUBLICATION_OUTCOME_KINDS.EXCLUDED) {
    const reason = ExclusionReason.create({ code: CHANNEL_FAILURE_CODES.CONTENT_REJECTED });
    if (!reason.ok) {
      throw new Error("the exclusion-reason fixture is invalid");
    }
    return { ...base, reason: reason.value, excludedAt: SETTLEMENT_MOMENT };
  }

  return base;
}

/**
 * @function hydrateRecord
 * @description Builds a REAL `ChannelPublication` in the requested settlement, through
 *              the entity's own `reconstitute` — the path the repository uses — so the
 *              record answers `hasLiveContent()` for itself rather than being described
 *              by this file.
 * @param outcomeKind - Which settlement the record holds.
 * @param pendingRetraction - Whether fragments are still on the provider.
 * @returns The hydrated record.
 */
function hydrateRecord(
  outcomeKind: PublicationOutcomeKind,
  pendingRetraction: boolean
): ChannelPublication {
  const rebuilt = ChannelPublication.reconstitute(settledStateOf(outcomeKind, pendingRetraction));
  expect(
    rebuilt.ok,
    `the ${outcomeKind}/${pendingRetraction} fixture is a state the record can hold`
  ).toBe(true);
  if (!rebuilt.ok) {
    throw new Error("unreachable: the assertion above already failed");
  }
  return rebuilt.value;
}

/**
 * @function rowOf
 * @description The two columns the guard reads, DERIVED from a hydrated record the way
 *              the adapter derives them — so the row and the domain record under test
 *              are the same fact seen twice, not two independent descriptions.
 * @param record - The hydrated publication.
 * @returns The row the in-transaction read answers with.
 */
function rowOf(record: ChannelPublication): PublicationRow {
  return {
    channelId: record.channelId.value,
    outcome: OUTCOME_COLUMN[record.outcomeKind],
    pendingRetraction: record.pendingRetraction,
  };
}

describe("SchedulingPostRouteHandler — C3 guard on cancelScheduledPost", () => {
  let handler: SchedulingPostRouteHandler;

  beforeEach(() => {
    handler = undefined as never;
  });

  it("refuses 409 and writes nothing when a channel of the post has published content", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [LIVE_PUBLISHED],
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.cancelScheduledPost(requestDouble(), reply);

    expect(sent.statusCode).toBe(409);
    expect(sent.body.details?.code).toBe(ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS);
    expect(sent.body.details?.channelIds).toEqual([LIVE_CHANNEL_ID]);
    expect(recorded.updates).toEqual([]);
    expect(recorded.logUpdates).toEqual([]);
  });

  it("refuses 409 for a channel that is EXCLUDED but still holds fragments pending retraction", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [LIVE_STRANDED],
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.cancelScheduledPost(requestDouble(), reply);

    expect(sent.statusCode).toBe(409);
    expect(recorded.updates).toEqual([]);
  });

  it("takes its deciding read INSIDE the transaction, with the publication record", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [NOT_LIVE],
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply } = replyDouble();

    await handler.cancelScheduledPost(requestDouble(), reply);

    const guarded = recorded.reads.filter((read) => read.inTransaction);
    expect(guarded).toHaveLength(1);
    const selection = guarded[0]!.args.select ?? guarded[0]!.args.include;
    expect(selection?.channelPublications).toBeTruthy();
  });

  it("hands the update a compare-and-swap where, so a word that moved loses the write", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [NOT_LIVE],
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.cancelScheduledPost(requestDouble(), reply);

    expect(sent.statusCode).toBe(200);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]!.where.id).toBe(POST_ID);
    expect(recorded.updates[0]!.where.status).toEqual({ in: ["SCHEDULED", "DRAFT", "FAILED"] });
  });

  it("answers 409 rather than 500 when the compare-and-swap finds no row", async () => {
    const { prisma } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [NOT_LIVE],
      casLost: true,
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.cancelScheduledPost(requestDouble(), reply);

    expect(sent.statusCode).toBe(409);
  });

  it("keeps a write failure that is NOT a lost swap a 500, and attempts the write once", async () => {
    for (const { label, error } of NOT_A_LOST_SWAP) {
      const { prisma, recorded } = prismaDouble({
        post: { status: "SCHEDULED" },
        publications: [NOT_LIVE],
        updateRejectsWith: error,
      });
      const { reply, sent } = replyDouble();

      await new SchedulingPostRouteHandler(prisma).cancelScheduledPost(requestDouble(), reply);

      expect(sent.statusCode, label).toBe(500);
      expect(recorded.updates, label).toHaveLength(1);
    }
  });

  it("keeps a P2025 raised by a statement OTHER than the swap a 500, not a lost race", async () => {
    // The swap and the log write share one transaction, so a discriminator that asks only
    // "was the code P2025" answers 409 for whichever of them raised it. That is right
    // today only because the log write is an `updateMany`, which reports a miss as a count
    // instead of throwing — a fact about the NEIGHBOURING statement, not about the swap.
    // Pinned so the day that statement becomes a single-row `update`, a genuinely
    // different fault cannot reach the operator as "the post moved on".
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED", publishLogs: [QUEUED_LOG] },
      publications: [NOT_LIVE],
      logUpdateRejectsWith: recordNotFound("the publish log row was gone"),
    });
    const { reply, sent } = replyDouble();

    await new SchedulingPostRouteHandler(prisma).cancelScheduledPost(requestDouble(), reply);

    expect(recorded.logUpdates).toHaveLength(1);
    expect(sent.statusCode).toBe(500);
  });

  it("answers 404 when the post is gone by the time the transaction re-reads it", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [NOT_LIVE],
      vanishesInTransaction: true,
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.cancelScheduledPost(requestDouble(), reply);

    expect(sent.statusCode).toBe(404);
    expect(recorded.updates).toEqual([]);
  });

  it("mirrors the domain's live-content rule over every outcome the record can carry", async () => {
    // The row-level predicate is a SECOND declaration of
    // `ChannelPublication.hasLiveContent()` — "published, or excluded with fragments
    // still on the provider" — because the domain reads hydrated facts and this guard
    // reads columns. This case is the BINDING, and it binds only because the expected
    // value is asked of a real hydrated record: a hand-written table here would be a
    // THIRD declaration, and moving either of the other two would leave it green while
    // they diverged. Proven by probing the domain predicate: drop its
    // `|| this._pendingRetraction` term and this case goes red on two rows
    // (`UNRESOLVED/true` and `EXCLUDED/true` — the rows where the retraction flag is
    // the ONLY thing making the content live).
    const observed: Array<{ row: string; refused: boolean }> = [];
    const expected: Array<{ row: string; refused: boolean }> = [];

    for (const outcomeKind of Object.values(PUBLICATION_OUTCOME_KINDS)) {
      for (const pendingRetraction of [false, true]) {
        const record = hydrateRecord(outcomeKind, pendingRetraction);
        const row = `${OUTCOME_COLUMN[outcomeKind]}/${pendingRetraction}`;

        const { prisma } = prismaDouble({
          post: { status: "SCHEDULED" },
          publications: [rowOf(record)],
        });
        const { reply, sent } = replyDouble();
        await new SchedulingPostRouteHandler(prisma).cancelScheduledPost(requestDouble(), reply);

        observed.push({ row, refused: sent.statusCode === 409 });
        expected.push({ row, refused: record.hasLiveContent() });
      }
    }

    expect(observed).toEqual(expected);
    // A rule that answered the same for every row would satisfy the comparison above
    // vacuously, so the shape of the answer is pinned too: the six rows are not one
    // verdict repeated.
    expect(expected.filter((entry) => entry.refused)).toHaveLength(4);
    expect(expected).toHaveLength(6);
  });
});

describe("SchedulingPostRouteHandler — C3 guard on reschedulePost", () => {
  let handler: SchedulingPostRouteHandler;

  beforeEach(() => {
    handler = undefined as never;
  });

  it("refuses 409 and writes nothing when a channel of the post has published content", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "PARTIALLY_PUBLISHED" },
      publications: [LIVE_PUBLISHED],
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.reschedulePost(requestDouble({ scheduledAt: FUTURE }), reply);

    expect(sent.statusCode).toBe(409);
    expect(sent.body.details?.code).toBe(ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS);
    expect(sent.body.details?.channelIds).toEqual([LIVE_CHANNEL_ID]);
    expect(recorded.updates).toEqual([]);
    expect(recorded.logUpdates).toEqual([]);
  });

  it("refuses 409 for a channel that is EXCLUDED but still holds fragments pending retraction", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "FAILED" },
      publications: [LIVE_STRANDED],
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.reschedulePost(requestDouble({ scheduledAt: FUTURE }), reply);

    expect(sent.statusCode).toBe(409);
    expect(recorded.updates).toEqual([]);
  });

  it("takes its deciding read INSIDE the transaction, with the publication record", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [NOT_LIVE],
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply } = replyDouble();

    await handler.reschedulePost(requestDouble({ scheduledAt: FUTURE }), reply);

    const guarded = recorded.reads.filter((read) => read.inTransaction);
    expect(guarded).toHaveLength(1);
    const selection = guarded[0]!.args.select ?? guarded[0]!.args.include;
    expect(selection?.channelPublications).toBeTruthy();
  });

  it("hands the update a compare-and-swap where, so a PUBLISHED word is never re-scheduled", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [NOT_LIVE],
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.reschedulePost(requestDouble({ scheduledAt: FUTURE }), reply);

    expect(sent.statusCode).toBe(200);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]!.where.id).toBe(POST_ID);
    expect(recorded.updates[0]!.where.status).toEqual({ in: ["SCHEDULED", "DRAFT", "FAILED"] });
  });

  it("answers 409 rather than 500 when the compare-and-swap finds no row", async () => {
    const { prisma } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [NOT_LIVE],
      casLost: true,
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.reschedulePost(requestDouble({ scheduledAt: FUTURE }), reply);

    expect(sent.statusCode).toBe(409);
  });

  it("keeps a write failure that is NOT a lost swap a 500, and attempts the write once", async () => {
    for (const { label, error } of NOT_A_LOST_SWAP) {
      const { prisma, recorded } = prismaDouble({
        post: { status: "SCHEDULED" },
        publications: [NOT_LIVE],
        updateRejectsWith: error,
      });
      const { reply, sent } = replyDouble();

      await new SchedulingPostRouteHandler(prisma).reschedulePost(
        requestDouble({ scheduledAt: FUTURE }),
        reply
      );

      expect(sent.statusCode, label).toBe(500);
      expect(recorded.updates, label).toHaveLength(1);
    }
  });

  it("keeps a P2025 raised by a statement OTHER than the swap a 500, not a lost race", async () => {
    // The cancellation's twin: the same transaction, the same trap, the other writer.
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED", publishLogs: [QUEUED_LOG] },
      publications: [NOT_LIVE],
      logUpdateRejectsWith: recordNotFound("the publish log row was gone"),
    });
    const { reply, sent } = replyDouble();

    await new SchedulingPostRouteHandler(prisma).reschedulePost(
      requestDouble({ scheduledAt: FUTURE, updateChannels: true }),
      reply
    );

    expect(recorded.logUpdates).toHaveLength(1);
    expect(sent.statusCode).toBe(500);
  });

  it("answers 404 when the post is gone by the time the transaction re-reads it", async () => {
    const { prisma, recorded } = prismaDouble({
      post: { status: "SCHEDULED" },
      publications: [NOT_LIVE],
      vanishesInTransaction: true,
    });
    handler = new SchedulingPostRouteHandler(prisma);
    const { reply, sent } = replyDouble();

    await handler.reschedulePost(requestDouble({ scheduledAt: FUTURE }), reply);

    expect(sent.statusCode).toBe(404);
    expect(recorded.updates).toEqual([]);
  });
});
