/**
 * @file PrismaProjectQueryRepository.test.ts
 * @description Unit tests for the Prisma adapter of the ProjectQueryRepository port,
 *              focused on the analytics read methods getProjectAccess (ownership
 *              check via count) and getChannelsByProject (flat channel DTO listing).
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaProjectQueryRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaProjectQueryRepository.js");

interface MockPrisma {
  project: { count: ReturnType<typeof vi.fn> };
  channel: { findMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): MockPrisma {
  return {
    project: { count: vi.fn() },
    channel: { findMany: vi.fn() },
  };
}

describe("PrismaProjectQueryRepository analytics reads", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaProjectQueryRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaProjectQueryRepository(prisma as never);
  });

  it("getProjectAccess returns true when the account owns the project", async () => {
    prisma.project.count.mockResolvedValue(1);
    const hasAccess = await repo.getProjectAccess("acc-1", "proj-1");
    expect(hasAccess).toBe(true);
    expect(prisma.project.count).toHaveBeenCalledWith({
      where: { id: "proj-1", accountId: "acc-1" },
    });
  });

  it("getProjectAccess returns false when the account does not own the project", async () => {
    prisma.project.count.mockResolvedValue(0);
    expect(await repo.getProjectAccess("acc-1", "proj-2")).toBe(false);
  });

  it("getChannelsByProject lists channels for a project as flat DTOs", async () => {
    prisma.channel.findMany.mockResolvedValue([
      { id: "ch-1", projectId: "proj-1", provider: "X", handle: "@one" },
      { id: "ch-2", projectId: "proj-1", provider: "INSTAGRAM", handle: "@two" },
    ]);
    const channels = await repo.getChannelsByProject("proj-1");
    expect(channels).toHaveLength(2);
    expect(channels[0]?.id).toBe("ch-1");
    expect(prisma.channel.findMany).toHaveBeenCalledWith({
      where: { projectId: "proj-1" },
    });
  });
});
