/**
 * @file PrismaAnalyticsReadRepository.test.ts
 * @description Unit tests for the bounded project-entries read of the Prisma
 *              adapter behind the AnalyticsReadRepository port. Pins the exact
 *              object handed to Prisma — the nested project scope with its
 *              soft-delete filter, the optional capture-time lower bound, the
 *              descending capture order, the caller's bound, and the explicit
 *              column list — because the analytics routes moved onto this method
 *              on the promise that the query shape behind them did not change.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaAnalyticsReadRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaAnalyticsReadRepository.js");

interface MockPrisma {
  analytics: { findMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): MockPrisma {
  return { analytics: { findMany: vi.fn() } };
}

/** The nine columns of the analytics table, which are also exactly the nine the
 *  export emits. Naming them keeps a tenth column from silently joining the
 *  payload the day one is added to the schema. */
const ENTRY_SELECT = {
  id: true,
  postId: true,
  channelId: true,
  provider: true,
  views: true,
  likes: true,
  comments: true,
  shares: true,
  capturedAt: true,
};

describe("PrismaAnalyticsReadRepository.listProjectEntries", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaAnalyticsReadRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaAnalyticsReadRepository(prisma as never);
  });

  it("issues one bounded nested-join read carrying the capture-time lower bound", async () => {
    const since = new Date("2026-03-08T12:00:00.000Z");
    prisma.analytics.findMany.mockResolvedValue([]);

    await repo.listProjectEntries("proj-1", { since, take: 500 });

    const arg = prisma.analytics.findMany.mock.calls[0]?.[0];
    expect(arg).toEqual({
      where: {
        post: { projectId: "proj-1", deletedAt: null },
        capturedAt: { gte: since },
      },
      select: ENTRY_SELECT,
      orderBy: { capturedAt: "desc" },
      take: 500,
    });
    // One query, not a post-id materialization followed by a second read.
    expect(prisma.analytics.findMany).toHaveBeenCalledTimes(1);
    // An include would re-widen the row and join relations nothing consumes.
    expect(arg.include).toBeUndefined();
  });

  it("omits the capture-time filter entirely when no lower bound is supplied", async () => {
    prisma.analytics.findMany.mockResolvedValue([]);

    await repo.listProjectEntries("proj-1", { take: 100 });

    const arg = prisma.analytics.findMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ post: { projectId: "proj-1", deletedAt: null } });
    // The key must be ABSENT, not present-and-undefined: under
    // exactOptionalPropertyTypes an explicit undefined is a different value, and
    // Prisma would read it as a filter on an undefined column.
    expect("capturedAt" in (arg.where as object)).toBe(false);
    expect(arg.take).toBe(100);
  });

  it("passes the caller's bound through unchanged", async () => {
    prisma.analytics.findMany.mockResolvedValue([]);
    await repo.listProjectEntries("proj-2", {
      since: new Date("2026-01-01T00:00:00.000Z"),
      take: 5000,
    });
    expect(prisma.analytics.findMany.mock.calls[0]?.[0].take).toBe(5000);
  });

  it("returns the rows the query produced", async () => {
    const row = {
      id: "a-1",
      postId: "p-1",
      channelId: "c-1",
      provider: "X",
      views: 1,
      likes: 2,
      comments: 3,
      shares: 4,
      capturedAt: new Date("2026-03-10T00:00:00.000Z"),
    };
    prisma.analytics.findMany.mockResolvedValue([row]);
    expect(await repo.listProjectEntries("proj-1", { take: 10 })).toEqual([row]);
  });
});
