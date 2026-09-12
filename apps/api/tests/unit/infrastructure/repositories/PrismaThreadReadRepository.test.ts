/**
 * @file PrismaThreadReadRepository.test.ts
 * @description Unit tests for the Prisma adapter of the ThreadReadRepository port.
 *              Stubs the Prisma client to assert the include shapes (post→project,
 *              tweets ordered by sequenceNumber), the timeframe/project/account
 *              where clauses, and the thread count.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaThreadReadRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaThreadReadRepository.js");

interface MockPrisma {
  thread: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    thread: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
}

describe("PrismaThreadReadRepository", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaThreadReadRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaThreadReadRepository(prisma as never);
  });

  it("getById queries findUnique with post→project and ordered tweets include", async () => {
    prisma.thread.findUnique.mockResolvedValue({ id: "t1", tweets: [] });
    const result = await repo.getById("t1");
    expect(result).toEqual({ id: "t1", tweets: [] });
    const arg = prisma.thread.findUnique.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ id: "t1" });
    expect(arg.include.post.include.project).toBe(true);
    expect(arg.include.tweets.orderBy).toEqual({ sequenceNumber: "asc" });
  });

  it("getById returns null when the thread does not exist", async () => {
    prisma.thread.findUnique.mockResolvedValue(null);
    expect(await repo.getById("missing")).toBeNull();
  });

  it("getByIds queries findMany with an id IN clause", async () => {
    prisma.thread.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    const result = await repo.getByIds(["t1", "t2"]);
    expect(result).toHaveLength(2);
    const arg = prisma.thread.findMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ id: { in: ["t1", "t2"] } });
  });

  it("getByProjectIdAndTimeframe filters by createdAt range + post.projectId, ordered desc", async () => {
    prisma.thread.findMany.mockResolvedValue([]);
    const start = new Date("2026-05-01T00:00:00Z");
    const end = new Date("2026-06-01T00:00:00Z");
    await repo.getByProjectIdAndTimeframe("proj-1", start, end);
    const arg = prisma.thread.findMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({
      createdAt: { gte: start, lt: end },
      post: { projectId: "proj-1", deletedAt: null },
    });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("getByAccountIdAndTimeframe filters by createdAt range + post.project.accountId", async () => {
    prisma.thread.findMany.mockResolvedValue([]);
    const start = new Date("2026-05-01T00:00:00Z");
    const end = new Date("2026-06-01T00:00:00Z");
    await repo.getByAccountIdAndTimeframe("acc-1", start, end);
    const arg = prisma.thread.findMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({
      createdAt: { gte: start, lt: end },
      post: { deletedAt: null, project: { accountId: "acc-1", deletedAt: null } },
    });
  });

  it("getByProjectId filters by post.projectId with tweets-only include", async () => {
    prisma.thread.findMany.mockResolvedValue([]);
    await repo.getByProjectId("proj-1");
    const arg = prisma.thread.findMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ post: { projectId: "proj-1", deletedAt: null } });
    expect(arg.include.tweets.orderBy).toEqual({ sequenceNumber: "asc" });
    expect(arg.include.post).toBeUndefined();
  });

  it("getByAccountId filters by post.project.accountId", async () => {
    prisma.thread.findMany.mockResolvedValue([]);
    await repo.getByAccountId("acc-1");
    const arg = prisma.thread.findMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({
      post: { deletedAt: null, project: { accountId: "acc-1", deletedAt: null } },
    });
  });

  it("listThreadRefsByProject selects four columns, keeps the bound, and adds NO ordering", async () => {
    prisma.thread.findMany.mockResolvedValue([]);
    await repo.listThreadRefsByProject("proj-1", 1000);
    const arg = prisma.thread.findMany.mock.calls[0]?.[0];
    expect(arg).toEqual({
      where: { post: { projectId: "proj-1", deletedAt: null } },
      select: { id: true, postId: true, strategy: true, createdAt: true },
      take: 1000,
    });
    // No include: the export emits these rows verbatim, so a joined relation
    // would add keys to a payload that is supposed to be unchanged.
    expect(arg.include).toBeUndefined();
    // No orderBy either. The read this replaces has none, and imposing one would
    // change WHICH rows a truncated take returns — a behaviour change dressed as
    // a tidy-up. Callers get storage order by contract.
    expect(arg.orderBy).toBeUndefined();
  });

  it("listThreadRefsByProject passes the caller's bound through", async () => {
    prisma.thread.findMany.mockResolvedValue([]);
    await repo.listThreadRefsByProject("proj-2", 10);
    expect(prisma.thread.findMany.mock.calls[0]?.[0].take).toBe(10);
  });

  it("countByProjectId counts threads filtered by post.projectId", async () => {
    prisma.thread.count.mockResolvedValue(7);
    const count = await repo.countByProjectId("proj-1");
    expect(count).toBe(7);
    expect(prisma.thread.count).toHaveBeenCalledWith({
      where: { post: { projectId: "proj-1", deletedAt: null } },
    });
  });
});
