/**
 * Infrastructure Layer - Prisma Project Repository Unit Tests
 *
 * Part of FASE H4b / H12: Hexagonal Architecture - Prisma Adapters + Soft Delete
 * Tests PrismaProjectRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 *
 * @file PrismaProjectRepository.test.ts
 * @description Tests for PrismaProjectRepository
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { PrismaProjectRepository } from "../../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { ProjectId, AccountId } from "@core/domain/index.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function baseRow() {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    accountId: "a0000000-0000-4000-8000-000000000001",
    name: "My Project",
    locale: "es",
    isInCrisisMode: false,
    crisisStartedAt: null as Date | null,
    crisisReason: null as string | null,
    crisisModeHistory: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    channels: [] as { id: string }[],
    posts: [] as { id: string }[],
  };
}

function makeMockPrisma() {
  return {
    project: {
      findFirst: vi.fn(async () => baseRow()),
      findMany: vi.fn(async () => [baseRow()]),
      upsert: vi.fn(async () => baseRow()),
      update: vi.fn(async () => baseRow()),
      count: vi.fn(async () => 1),
      delete: vi.fn(async () => baseRow()),
    },
    post: {
      findMany: vi.fn(async () => [] as { id: string }[]),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    publishLog: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
    analytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    postMedia: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    postContent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    publishingQueue: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    channel: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentTemplate: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    instagramStoryProject: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    videoProcessingJob: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    instagramAnalytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    schedulingRule: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    webhookEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    webhookSubscription: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    template: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaProjectRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaProjectRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaProjectRepository(prisma as never);
  });

  describe("findById", () => {
    it("returns ok(project) when row exists", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.name).toBe("My Project");
      expect(result.value.locale).toBe("es");
      // Uses findFirst (not findUnique) to allow deletedAt: null filter
      expect(prisma.project.findFirst.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.project.findFirst.mockImplementation(async () => null);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Project/);
    });
  });

  describe("findByAccountId", () => {
    it("returns array of projects", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const projects = await repo.findByAccountId(accountId);

      expect(projects.length).toBe(1);
      expect(projects[0]?.name).toBe("My Project");
      expect(prisma.project.findMany.mock.calls.length).toBe(1);
    });

    it("returns empty array when no projects exist", async () => {
      prisma.project.findMany.mockImplementation(async () => []);
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const projects = await repo.findByAccountId(accountId);

      expect(projects.length).toBe(0);
    });
  });

  describe("save", () => {
    it("calls upsert and returns ok", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);
      expect(saveResult.ok).toBeTruthy();
      expect(prisma.project.upsert.mock.calls.length).toBe(1);
    });

    it("returns err when prisma throws", async () => {
      prisma.project.upsert.mockImplementation(async () => {
        throw new Error("Unique constraint violation");
      });

      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);
      expect(saveResult.ok).toBeFalsy();
      expect(saveResult.error.message).toMatch(/Unique constraint/);
    });
  });

  describe("exists", () => {
    it("returns true when count > 0", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      expect(result).toBe(true);
    });

    it("returns false when count is 0", async () => {
      prisma.project.count.mockImplementation(async () => 0);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      expect(result).toBe(false);
    });
  });

  describe("delete (soft delete)", () => {
    it("calls update with deletedAt and returns ok when project exists", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      expect(result.ok).toBeTruthy();
      // Soft delete: update, NOT delete
      expect(prisma.project.update.mock.calls.length).toBe(1);
      expect(prisma.project.delete.mock.calls.length).toBe(0);

      const callRecord = prisma.project.update.mock.calls[0];
      const args = callRecord?.[0] as { data: { deletedAt: unknown } } | undefined;
      expect(args?.data.deletedAt instanceof Date).toBeTruthy();
    });

    it("returns err when project does not exist", async () => {
      prisma.project.count.mockImplementation(async () => 0);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Project/);
      expect(prisma.project.update.mock.calls.length).toBe(0);
    });
  });

  describe("hardDelete", () => {
    it("returns ok and calls delete when project exists (even if soft-deleted)", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeTruthy();
      // Hard delete: calls the actual DB delete
      expect(prisma.project.delete.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when project is not found at all", async () => {
      prisma.project.findFirst.mockImplementation(async () => null);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Project/);
      expect(prisma.project.delete.mock.calls.length).toBe(0);
    });
  });

  describe("findByName", () => {
    it("returns Project when found by account and name", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const project = await repo.findByName(accountId, "My Project");

      expect(project !== null).toBeTruthy();
      expect(project?.name).toBe("My Project");
      expect(prisma.project.findFirst.mock.calls.length).toBe(1);
    });

    it("returns null when not found", async () => {
      prisma.project.findFirst.mockImplementation(async () => null);
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const project = await repo.findByName(accountId, "Nonexistent");

      expect(project).toBe(null);
    });

    it("only searches non-deleted projects (deletedAt: null in where clause)", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      await repo.findByName(accountId, "My Project");

      const callRecord = prisma.project.findFirst.mock.calls[0];
      const args = callRecord?.[0] as { where: Record<string, unknown> } | undefined;
      expect(args?.where.deletedAt).toEqual(null);
    });
  });

  describe("findPublishLogsByProjectId", () => {
    it("calls publishLog.findMany and returns an array", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const logs = await repo.findPublishLogsByProjectId(id);

      expect(Array.isArray(logs)).toBe(true);
      expect(prisma.publishLog.findMany.mock.calls.length).toBe(1);
    });

    it("queries by post.projectId using nested filter", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      await repo.findPublishLogsByProjectId(id);

      const callRecord = prisma.publishLog.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { post: { projectId: string } } } | undefined;
      expect(args?.where.post.projectId).toBe("b0000000-0000-4000-8000-000000000001");
    });
  });

  describe("crisis mode roundtrip", () => {
    it("preserves crisis mode history during save/load cycle", async () => {
      const crisisRow = {
        ...baseRow(),
        isInCrisisMode: true,
        crisisStartedAt: new Date("2026-01-15"),
        crisisReason: "PR disaster",
        crisisModeHistory: [{ reason: "PR disaster", startedAt: "2026-01-15T00:00:00.000Z" }],
      };
      prisma.project.findFirst.mockImplementation(async () => crisisRow);
      prisma.project.upsert.mockImplementation(async () => crisisRow);

      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const project = findResult.value;
      expect(project.isInCrisisMode).toBe(true);
      expect(project.crisisReason).toBe("PR disaster");
      expect(project.crisisModeHistory.length).toBe(1);
    });
  });
});
