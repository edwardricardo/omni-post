/**
 * Infrastructure Layer - Prisma Channel Repository Unit Tests
 *
 * Part of FASE H4b / H12: Hexagonal Architecture - Prisma Adapters + Soft Delete
 * Tests PrismaChannelRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

import { PrismaChannelRepository } from "../../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { ChannelId, ProjectId } from "../../../src/domain/index.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function baseRow() {
  return {
    id: "f0000000-0000-4000-8000-000000000001",
    projectId: "b0000000-0000-4000-8000-000000000001",
    provider: "X",
    handle: "@myaccount",
    credentials: { accessToken: "tok_123", refreshToken: "ref_456" },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function makeMockPrisma(t: TestContext) {
  return {
    channel: {
      findFirst: t.mock.fn(async () => baseRow()),
      findMany: t.mock.fn(async () => [baseRow()]),
      upsert: t.mock.fn(async () => baseRow()),
      update: t.mock.fn(async () => baseRow()),
      delete: t.mock.fn(async () => baseRow()),
    },
    publishLog: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    analytics: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaChannelRepository", { concurrency: 1 }, () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaChannelRepository;

  beforeEach((t) => {
    prisma = makeMockPrisma(t);
    repo = new PrismaChannelRepository(prisma as never);
  });

  describe("findById", () => {
    it("returns ok(channel) with correct provider and handle", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.handle, "@myaccount");
      assert.equal(result.value.provider.type, "X");
      assert.equal(result.value.credentials.accessToken, "tok_123");
      // Uses findFirst (not findUnique) to allow deletedAt: null filter
      assert.equal(prisma.channel.findFirst.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.channel.findFirst.mock.mockImplementation(async () => null);
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Channel/);
    });

    it("sets default CONNECTED status when loading from DB", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.status, "CONNECTED");
      assert.equal(result.value.errorCount, 0);
    });
  });

  describe("findByProjectId", () => {
    it("returns all channels for a project", async () => {
      const projectId = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const channels = await repo.findByProjectId(projectId);

      assert.equal(channels.length, 1);
      assert.equal(channels[0]?.handle, "@myaccount");
      assert.equal(prisma.channel.findMany.mock.calls.length, 1);
    });

    it("returns empty array when project has no channels", async () => {
      prisma.channel.findMany.mock.mockImplementation(async () => []);
      const projectId = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const channels = await repo.findByProjectId(projectId);

      assert.equal(channels.length, 0);
    });

    it("filters by deletedAt: null to exclude soft-deleted channels", async () => {
      let capturedWhere: { deletedAt?: null } | undefined;
      prisma.channel.findMany.mock.mockImplementation(
        async (args: { where: { deletedAt?: null } }) => {
          capturedWhere = args.where;
          return [baseRow()];
        }
      );

      const projectId = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      await repo.findByProjectId(projectId);

      assert.deepEqual(capturedWhere?.deletedAt, null);
    });
  });

  describe("save", () => {
    it("serializes credentials and calls upsert", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      assert.ok(findResult.ok);

      const saveResult = await repo.save(findResult.value);
      assert.ok(saveResult.ok);
      assert.equal(prisma.channel.upsert.mock.calls.length, 1);
    });

    it("returns err when prisma throws", async () => {
      prisma.channel.upsert.mock.mockImplementation(async () => {
        throw new Error("FK violation: project not found");
      });

      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      assert.ok(findResult.ok);

      const saveResult = await repo.save(findResult.value);
      assert.ok(!saveResult.ok);
      assert.match(saveResult.error.message, /FK violation/);
    });
  });

  describe("delete (soft delete)", () => {
    it("calls update with deletedAt and returns ok when channel exists", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      assert.ok(result.ok);
      // Soft delete: update, NOT delete
      assert.equal(prisma.channel.update.mock.calls.length, 1);
      assert.equal(prisma.channel.delete.mock.calls.length, 0);

      const callRecord = prisma.channel.update.mock.calls[0];
      const args = callRecord?.arguments[0] as { data: { deletedAt: unknown } } | undefined;
      assert.ok(args?.data.deletedAt instanceof Date);
    });

    it("returns err(EntityNotFoundError) when channel does not exist", async () => {
      prisma.channel.findFirst.mock.mockImplementation(async () => null);
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Channel/);
      assert.equal(prisma.channel.update.mock.calls.length, 0);
    });
  });

  describe("hardDelete", () => {
    it("returns ok and calls delete with cascade when channel exists", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      assert.ok(result.ok);
      // Hard delete: actual DB delete + cascade
      assert.equal(prisma.channel.delete.mock.calls.length, 1);
      assert.equal(prisma.publishLog.deleteMany.mock.calls.length, 1);
      assert.equal(prisma.analytics.deleteMany.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when channel is not found at all", async () => {
      prisma.channel.findFirst.mock.mockImplementation(async () => null);
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Channel/);
      assert.equal(prisma.channel.delete.mock.calls.length, 0);
    });
  });

  describe("provider mapping", () => {
    const providers = ["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"] as const;
    for (const provider of providers) {
      it(`maps Prisma provider "${provider}" correctly`, async () => {
        prisma.channel.findFirst.mock.mockImplementation(async () => ({ ...baseRow(), provider }));
        const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
        const result = await repo.findById(id);
        assert.ok(result.ok);
        assert.equal(result.value.provider.type, provider);
      });
    }
  });
});
