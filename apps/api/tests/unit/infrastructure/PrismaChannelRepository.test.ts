/**
 * Infrastructure Layer - Prisma Channel Repository Unit Tests
 *
 * Tests PrismaChannelRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 *
 * @file PrismaChannelRepository.test.ts
 * @description Tests for PrismaChannelRepository
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { PrismaChannelRepository } from "../../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { ChannelCredentialsCrypto } from "../../../src/security/ChannelCredentialsCrypto.js";
import { EncryptionService } from "../../../src/security/EncryptionService.js";
import { ChannelId, ProjectId, AccountId } from "../../../src/domain/index.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_KEY = randomBytes(32).toString("base64");
const sharedEncryption = new EncryptionService({
  activeKeyBase64: TEST_KEY,
  activeKeyVersion: 1,
});
const sharedCrypto = new ChannelCredentialsCrypto(sharedEncryption);

/**
 * Builds a Channel row with credentials already encrypted via the shared
 * crypto helper, so `repo.findById` returns a valid Channel domain entity.
 */
function baseRow() {
  // Match the recordId the repository uses on read (`row.id`).
  const enc = sharedCrypto.encrypt(
    { accessToken: "tok_123", refreshToken: "ref_456" },
    { recordId: "f0000000-0000-4000-8000-000000000001" }
  );
  return {
    id: "f0000000-0000-4000-8000-000000000001",
    projectId: "b0000000-0000-4000-8000-000000000001",
    provider: "X",
    handle: "@myaccount",
    credentialsCiphertext: enc.credentialsCiphertext,
    credentialsIv: enc.credentialsIv,
    credentialsAuthTag: enc.credentialsAuthTag,
    credentialsKeyVersion: enc.credentialsKeyVersion,
    isPrimary: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function makeMockPrisma() {
  return {
    channel: {
      findFirst: vi.fn(async () => baseRow()),
      findMany: vi.fn(async () => [baseRow()]),
      upsert: vi.fn(async () => baseRow()),
      update: vi.fn(async () => baseRow()),
      delete: vi.fn(async () => baseRow()),
    },
    publishLog: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      groupBy: vi.fn(async () => [] as Array<{ channelId: string; _count: { _all: number } }>),
    },
    analytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaChannelRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaChannelRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaChannelRepository(prisma as never, sharedCrypto);
  });

  describe("findById", () => {
    it("returns ok(channel) with correct provider and handle", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.handle).toBe("@myaccount");
      expect(result.value.provider.type).toBe("X");
      expect(result.value.credentials.accessToken).toBe("tok_123");
      // Uses findFirst (not findUnique) to allow deletedAt: null filter
      expect(prisma.channel.findFirst.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.channel.findFirst.mockImplementation(async () => null);
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Channel/);
    });

    it("sets default CONNECTED status when loading from DB", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.status).toBe("CONNECTED");
      expect(result.value.errorCount).toBe(0);
    });
  });

  describe("findByProjectId", () => {
    it("returns all channels for a project", async () => {
      const projectId = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const channels = await repo.findByProjectId(projectId);

      expect(channels.length).toBe(1);
      expect(channels[0]?.handle).toBe("@myaccount");
      expect(prisma.channel.findMany.mock.calls.length).toBe(1);
    });

    it("returns empty array when project has no channels", async () => {
      prisma.channel.findMany.mockImplementation(async () => []);
      const projectId = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const channels = await repo.findByProjectId(projectId);

      expect(channels.length).toBe(0);
    });

    it("filters by deletedAt: null to exclude soft-deleted channels", async () => {
      let capturedWhere: { deletedAt?: null } | undefined;
      prisma.channel.findMany.mockImplementation(async (args: { where: { deletedAt?: null } }) => {
        capturedWhere = args.where;
        return [baseRow()];
      });

      const projectId = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      await repo.findByProjectId(projectId);

      expect(capturedWhere?.deletedAt).toEqual(null);
    });
  });

  describe("findConnectionViewsByProjectScopedToAccount", () => {
    const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
    const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";

    function viewRow() {
      return {
        id: "f0000000-0000-4000-8000-000000000001",
        provider: "X",
        handle: "@myaccount",
        accountName: "My Account",
        profileImage: "https://img/pic.png",
        connectedAt: new Date("2026-01-02"),
        lastUsedAt: new Date("2026-01-03"),
        expiredAt: null,
        needsReauth: false,
      };
    }

    it("scopes the query to the account (tenancy) and excludes soft-deleted", async () => {
      let captured: { where?: Record<string, unknown> } = {};
      prisma.channel.findMany.mockImplementation(
        async (args: { where: Record<string, unknown> }) => {
          captured = args;
          return [viewRow()];
        }
      );

      await repo.findConnectionViewsByProjectScopedToAccount(
        ProjectId.fromStringUnsafe(PROJECT_ID),
        AccountId.fromStringUnsafe(ACCOUNT_ID)
      );

      expect(captured.where?.projectId).toBe(PROJECT_ID);
      expect(captured.where?.deletedAt).toEqual(null);
      expect(captured.where?.project).toEqual({ accountId: ACCOUNT_ID });
    });

    it("maps rows to the credential-free view shape", async () => {
      prisma.channel.findMany.mockImplementation(async () => [viewRow()]);

      const views = await repo.findConnectionViewsByProjectScopedToAccount(
        ProjectId.fromStringUnsafe(PROJECT_ID),
        AccountId.fromStringUnsafe(ACCOUNT_ID)
      );

      expect(views).toHaveLength(1);
      expect(views[0]).toEqual({
        id: "f0000000-0000-4000-8000-000000000001",
        provider: "X",
        handle: "@myaccount",
        accountName: "My Account",
        profileImage: "https://img/pic.png",
        connectedAt: new Date("2026-01-02"),
        lastUsedAt: new Date("2026-01-03"),
        expiredAt: null,
        needsReauth: false,
      });
    });
  });

  describe("findOwnerAccountIdByChannelId", () => {
    const CHANNEL_ID = "f0000000-0000-4000-8000-000000000001";

    it("returns ok(accountId) resolved via the project relation", async () => {
      prisma.channel.findFirst.mockImplementation(
        async () => ({ project: { accountId: "a0000000-0000-4000-8000-000000000009" } }) as never
      );

      const result = await repo.findOwnerAccountIdByChannelId(
        ChannelId.fromStringUnsafe(CHANNEL_ID)
      );

      expect(result.ok).toBeTruthy();
      expect(result.ok && result.value).toBe("a0000000-0000-4000-8000-000000000009");
    });

    it("returns err(EntityNotFoundError) when the channel is absent or soft-deleted", async () => {
      prisma.channel.findFirst.mockImplementation(async () => null);

      const result = await repo.findOwnerAccountIdByChannelId(
        ChannelId.fromStringUnsafe(CHANNEL_ID)
      );

      expect(result.ok).toBeFalsy();
      expect(!result.ok && result.error.message).toMatch(/Channel/);
    });
  });

  describe("save", () => {
    it("serializes credentials and calls upsert", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);
      expect(saveResult.ok).toBeTruthy();
      expect(prisma.channel.upsert.mock.calls.length).toBe(1);
    });

    it("returns err when prisma throws", async () => {
      prisma.channel.upsert.mockImplementation(async () => {
        throw new Error("FK violation: project not found");
      });

      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);
      expect(saveResult.ok).toBeFalsy();
      expect(saveResult.error.message).toMatch(/FK violation/);
    });
  });

  describe("delete (soft delete)", () => {
    it("calls update with deletedAt and returns ok when channel exists", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      expect(result.ok).toBeTruthy();
      // Soft delete: update, NOT delete
      expect(prisma.channel.update.mock.calls.length).toBe(1);
      expect(prisma.channel.delete.mock.calls.length).toBe(0);

      const callRecord = prisma.channel.update.mock.calls[0];
      const args = callRecord?.[0] as { data: { deletedAt: unknown } } | undefined;
      expect(args?.data.deletedAt instanceof Date).toBeTruthy();
    });

    it("returns err(EntityNotFoundError) when channel does not exist", async () => {
      prisma.channel.findFirst.mockImplementation(async () => null);
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Channel/);
      expect(prisma.channel.update.mock.calls.length).toBe(0);
    });
  });

  describe("hardDelete", () => {
    it("returns ok and calls delete with cascade when channel exists", async () => {
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeTruthy();
      // Hard delete: actual DB delete + cascade
      expect(prisma.channel.delete.mock.calls.length).toBe(1);
      expect(prisma.publishLog.deleteMany.mock.calls.length).toBe(1);
      expect(prisma.analytics.deleteMany.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when channel is not found at all", async () => {
      prisma.channel.findFirst.mockImplementation(async () => null);
      const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Channel/);
      expect(prisma.channel.delete.mock.calls.length).toBe(0);
    });
  });

  describe("findUsageByChannelIds", () => {
    it("returns empty Map when no channel ids passed (no DB call)", async () => {
      const result = await repo.findUsageByChannelIds([]);
      expect(result.size).toBe(0);
      expect(prisma.publishLog.groupBy).not.toHaveBeenCalled();
    });

    it("issues a single groupBy filtered to status=OK + this calendar month", async () => {
      prisma.publishLog.groupBy.mockResolvedValueOnce([
        { channelId: "ch-1", _count: { _all: 12 } },
        { channelId: "ch-2", _count: { _all: 3 } },
      ]);
      const result = await repo.findUsageByChannelIds(["ch-1", "ch-2", "ch-3"]);

      expect(result.get("ch-1")).toEqual({ postsThisMonth: 12 });
      expect(result.get("ch-2")).toEqual({ postsThisMonth: 3 });
      expect(result.has("ch-3")).toBe(false);

      expect(prisma.publishLog.groupBy).toHaveBeenCalledTimes(1);
      const callArgs = prisma.publishLog.groupBy.mock.calls[0]?.[0] as {
        by: string[];
        where: { channelId: { in: string[] }; status: string; createdAt: { gte: Date } };
      };
      expect(callArgs.by).toEqual(["channelId"]);
      expect(callArgs.where.status).toBe("OK");
      expect(callArgs.where.channelId.in).toEqual(["ch-1", "ch-2", "ch-3"]);
      // Start of current calendar month, UTC
      const now = new Date();
      const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      expect(callArgs.where.createdAt.gte.getTime()).toBe(expected.getTime());
    });
  });

  describe("provider mapping", () => {
    const providers = ["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"] as const;
    for (const provider of providers) {
      it(`maps Prisma provider "${provider}" correctly`, async () => {
        prisma.channel.findFirst.mockImplementation(async () => ({ ...baseRow(), provider }));
        const id = ChannelId.fromStringUnsafe("f0000000-0000-4000-8000-000000000001");
        const result = await repo.findById(id);
        expect(result.ok).toBeTruthy();
        expect(result.value.provider.type).toBe(provider);
      });
    }
  });
});
