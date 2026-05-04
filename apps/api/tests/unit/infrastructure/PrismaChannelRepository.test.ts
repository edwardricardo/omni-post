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
import { ChannelId, ProjectId } from "../../../src/domain/index.js";

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
    publishLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
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
