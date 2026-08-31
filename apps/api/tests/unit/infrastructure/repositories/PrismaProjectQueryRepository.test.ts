/**
 * @file PrismaProjectQueryRepository.test.ts
 * @description Unit tests for the Prisma adapter of the ProjectQueryRepository port.
 *              Pins the soft-delete contract: every read of a soft-deletable model
 *              (project / post / channel) MUST carry `deletedAt: null`, so a
 *              soft-deleted project — and its posts, channels, media and analytics —
 *              disappears from every read surface (access gate, listings, counts,
 *              billing quota) instead of leaking after deletion (B-READS / R3-2).
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaProjectQueryRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaProjectQueryRepository.js");

interface MockPrisma {
  project: {
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  post: {
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  channel: { findMany: ReturnType<typeof vi.fn> };
  postMedia: { groupBy: ReturnType<typeof vi.fn> };
}

function makePrisma(): MockPrisma {
  return {
    project: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    post: { count: vi.fn(), findMany: vi.fn() },
    channel: { findMany: vi.fn() },
    postMedia: { groupBy: vi.fn() },
  };
}

describe("PrismaProjectQueryRepository soft-delete contract", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaProjectQueryRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaProjectQueryRepository(prisma as never);
  });

  describe("getProjectAccess (access gate for 11 analytics routes)", () => {
    it("scopes the ownership check to non-deleted projects", async () => {
      prisma.project.count.mockResolvedValue(1);
      const hasAccess = await repo.getProjectAccess("acc-1", "proj-1");
      expect(hasAccess).toBe(true);
      expect(prisma.project.count).toHaveBeenCalledWith({
        where: { id: "proj-1", accountId: "acc-1", deletedAt: null },
      });
    });

    it("denies access to a soft-deleted project (count is 0 once deletedAt is filtered)", async () => {
      prisma.project.count.mockResolvedValue(0);
      expect(await repo.getProjectAccess("acc-1", "proj-2")).toBe(false);
    });
  });

  describe("getByAccountId / countByAccountId", () => {
    it("lists only non-deleted projects of an account", async () => {
      prisma.project.findMany.mockResolvedValue([]);
      await repo.getByAccountId("acc-1");
      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { accountId: "acc-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
    });

    it("counts only non-deleted projects (billing quota must not charge for deleted subaccounts)", async () => {
      prisma.project.count.mockResolvedValue(3);
      await repo.countByAccountId("acc-1");
      expect(prisma.project.count).toHaveBeenCalledWith({
        where: { accountId: "acc-1", deletedAt: null },
      });
    });
  });

  describe("findById", () => {
    it("uses findFirst filtered by deletedAt: null (findUnique cannot filter a non-unique column)", async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      const row = await repo.findById("proj-9");
      expect(row).toBeNull();
      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: "proj-9", deletedAt: null },
      });
    });
  });

  describe("post reads scope out soft-deleted posts", () => {
    it("getPostIds filters deletedAt", async () => {
      prisma.post.findMany.mockResolvedValue([{ id: "p1" }]);
      await repo.getPostIds("proj-1");
      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: { projectId: "proj-1", deletedAt: null },
        select: { id: true },
      });
    });

    it("countPosts filters deletedAt", async () => {
      prisma.post.count.mockResolvedValue(0);
      await repo.countPosts("proj-1");
      expect(prisma.post.count).toHaveBeenCalledWith({
        where: { projectId: "proj-1", deletedAt: null },
      });
    });
  });

  describe("getChannelsByProject", () => {
    it("lists only non-deleted channels for a project", async () => {
      prisma.channel.findMany.mockResolvedValue([
        { id: "ch-1", projectId: "proj-1", provider: "X", handle: "@one" },
      ]);
      const channels = await repo.getChannelsByProject("proj-1");
      expect(channels).toHaveLength(1);
      expect(prisma.channel.findMany).toHaveBeenCalledWith({
        where: { projectId: "proj-1", deletedAt: null },
      });
    });
  });

  describe("getMediaCountsByAccount", () => {
    it("counts media only under non-deleted posts of non-deleted projects", async () => {
      prisma.postMedia.groupBy.mockResolvedValue([]);
      await repo.getMediaCountsByAccount("acc-1");
      expect(prisma.postMedia.groupBy).toHaveBeenCalledWith({
        by: ["type"],
        where: { post: { deletedAt: null, project: { accountId: "acc-1", deletedAt: null } } },
        _count: { id: true },
      });
    });
  });
});
