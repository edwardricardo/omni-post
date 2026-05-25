/**
 * Infrastructure Layer - Prisma API Key Repository Unit Tests
 *
 * Part of FASE H10-B: API Key Management
 * Tests PrismaApiKeyRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 *
 * @file PrismaApiKeyRepository.test.ts
 * @description Tests for PrismaApiKeyRepository
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { PrismaApiKeyRepository } from "../../../src/infrastructure/repositories/PrismaApiKeyRepository.js";
import { ApiKeyNotFoundError } from "@core/domain/repositories/ApiKeyRepository.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const BASE_ID = "a0000000-0000-4000-8000-000000000010";
const BASE_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";

function baseRow() {
  return {
    id: BASE_ID,
    accountId: BASE_ACCOUNT_ID,
    name: "Test Key",
    prefix: "op_aabbccdd",
    keyHash: "$2b$10$hashedvalue",
    permissions: ["read", "write"],
    rateLimit: 1000,
    expiresAt: null as Date | null,
    lastUsedAt: null as Date | null,
    isActive: true,
    rotationSchedule: null as string | null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function makeMockPrisma() {
  return {
    apiKey: {
      findUnique: vi.fn(async () => baseRow()),
      findFirst: vi.fn(async () => baseRow()),
      findMany: vi.fn(async () => [baseRow()]),
      create: vi.fn(async () => baseRow()),
      update: vi.fn(async () => baseRow()),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaApiKeyRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaApiKeyRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaApiKeyRepository(prisma as never);
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns ok(key) when row exists", async () => {
      const result = await repo.findById(BASE_ID);

      expect(result.ok).toBeTruthy();
      expect(result.value.id).toBe(BASE_ID);
      expect(result.value.name).toBe("Test Key");
      expect(result.value.prefix).toBe("op_aabbccdd");
      expect(result.value.permissions).toEqual(["read", "write"]);
      expect(result.value.isActive).toBe(true);
      expect(result.value.expiresAt).toBe(undefined);
      expect(result.value.lastUsedAt).toBe(undefined);
      expect(result.value.rotationSchedule).toBe(undefined);
      expect(prisma.apiKey.findUnique.mock.calls.length).toBe(1);
    });

    it("returns err(ApiKeyNotFoundError) when row is null", async () => {
      prisma.apiKey.findUnique.mockImplementation(async () => null);

      const result = await repo.findById(BASE_ID);

      expect(result.ok).toBeFalsy();
      expect(result.error instanceof ApiKeyNotFoundError).toBeTruthy();
      expect(result.error.message).toMatch(new RegExp(BASE_ID));
    });

    it("maps nullable fields to undefined correctly", async () => {
      const expiresAt = new Date("2027-01-01");
      const lastUsedAt = new Date("2026-06-01");
      prisma.apiKey.findUnique.mockImplementation(async () => ({
        ...baseRow(),
        expiresAt,
        lastUsedAt,
        rotationSchedule: "0 0 * * 0",
      }));

      const result = await repo.findById(BASE_ID);

      expect(result.ok).toBeTruthy();
      expect(result.value.expiresAt).toEqual(expiresAt);
      expect(result.value.lastUsedAt).toEqual(lastUsedAt);
      expect(result.value.rotationSchedule).toBe("0 0 * * 0");
    });
  });

  // ── findByAccountId ───────────────────────────────────────────────────────

  describe("findByAccountId", () => {
    it("returns array of domain keys for account", async () => {
      const keys = await repo.findByAccountId(BASE_ACCOUNT_ID);

      expect(keys.length).toBe(1);
      expect(keys[0]?.id).toBe(BASE_ID);
      expect(prisma.apiKey.findMany.mock.calls.length).toBe(1);
      const callRecord = prisma.apiKey.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { accountId: string; isActive: boolean } };
      expect(args.where.accountId).toBe(BASE_ACCOUNT_ID);
      expect(args.where.isActive).toBe(true);
    });

    it("returns empty array when no keys found", async () => {
      prisma.apiKey.findMany.mockImplementation(async () => []);

      const keys = await repo.findByAccountId(BASE_ACCOUNT_ID);

      expect(keys.length).toBe(0);
    });
  });

  // ── findActiveByPrefix ────────────────────────────────────────────────────

  describe("findActiveByPrefix", () => {
    it("returns domain key when found", async () => {
      const key = await repo.findActiveByPrefix("op_aabbccdd");

      expect(key !== null).toBeTruthy();
      expect(key.prefix).toBe("op_aabbccdd");
      expect(prisma.apiKey.findFirst.mock.calls.length).toBe(1);
    });

    it("returns null when prefix not found", async () => {
      prisma.apiKey.findFirst.mockImplementation(async () => null);

      const key = await repo.findActiveByPrefix("op_notexist");

      expect(key).toBe(null);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("calls prisma.create with correct data and returns domain key", async () => {
      const key = await repo.create({
        accountId: BASE_ACCOUNT_ID,
        name: "My Key",
        prefix: "op_aabbccdd",
        keyHash: "$2b$10$hash",
        permissions: ["read"],
        rateLimit: 500,
      });

      expect(key.id).toBe(BASE_ID);
      expect(prisma.apiKey.create.mock.calls.length).toBe(1);
      const callRecord = prisma.apiKey.create.mock.calls[0];
      const args = callRecord?.[0] as { data: { name: string; rateLimit: number } };
      expect(args.data.name).toBe("My Key");
      expect(args.data.rateLimit).toBe(500);
    });

    it("includes expiresAt when provided", async () => {
      const expiresAt = new Date("2027-12-31");
      await repo.create({
        accountId: BASE_ACCOUNT_ID,
        name: "Expiring Key",
        prefix: "op_xxyyzz11",
        keyHash: "$2b$10$hash",
        permissions: ["read"],
        rateLimit: 100,
        expiresAt,
      });

      const callRecord = prisma.apiKey.create.mock.calls[0];
      const args = callRecord?.[0] as { data: { expiresAt?: Date } };
      expect(args.data.expiresAt).toEqual(expiresAt);
    });
  });

  // ── recordUsage ───────────────────────────────────────────────────────────

  describe("recordUsage", () => {
    it("calls update with lastUsedAt", async () => {
      await repo.recordUsage(BASE_ID);

      expect(prisma.apiKey.update.mock.calls.length).toBe(1);
      const callRecord = prisma.apiKey.update.mock.calls[0];
      const args = callRecord?.[0] as {
        where: { id: string };
        data: { lastUsedAt: Date };
      };
      expect(args.where.id).toBe(BASE_ID);
      expect(args.data.lastUsedAt instanceof Date).toBeTruthy();
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────

  describe("deactivate", () => {
    it("returns ok when key exists and is deactivated", async () => {
      const result = await repo.deactivate(BASE_ID);

      expect(result.ok).toBeTruthy();
      expect(prisma.apiKey.update.mock.calls.length).toBe(1);
      const callRecord = prisma.apiKey.update.mock.calls[0];
      const args = callRecord?.[0] as { data: { isActive: boolean } };
      expect(args.data.isActive).toBe(false);
    });

    it("returns err(ApiKeyNotFoundError) when key does not exist", async () => {
      prisma.apiKey.findUnique.mockImplementation(async () => null);

      const result = await repo.deactivate("nonexistent-id");

      expect(result.ok).toBeFalsy();
      expect(result.error instanceof ApiKeyNotFoundError).toBeTruthy();
      expect(prisma.apiKey.update.mock.calls.length).toBe(0);
    });
  });

  // ── rotate ────────────────────────────────────────────────────────────────

  describe("rotate", () => {
    it("returns ok(updatedKey) with new prefix and hash", async () => {
      const newPrefix = "op_newprefix";
      const newHash = "$2b$10$newhash";

      const result = await repo.rotate(BASE_ID, newPrefix, newHash);

      expect(result.ok).toBeTruthy();
      expect(prisma.apiKey.update.mock.calls.length).toBe(1);
      const callRecord = prisma.apiKey.update.mock.calls[0];
      const args = callRecord?.[0] as {
        where: { id: string };
        data: { prefix: string; keyHash: string };
      };
      expect(args.where.id).toBe(BASE_ID);
      expect(args.data.prefix).toBe(newPrefix);
      expect(args.data.keyHash).toBe(newHash);
    });

    it("returns err(ApiKeyNotFoundError) when key does not exist", async () => {
      prisma.apiKey.findUnique.mockImplementation(async () => null);

      const result = await repo.rotate("nonexistent-id", "op_x", "$2b$10$h");

      expect(result.ok).toBeFalsy();
      expect(result.error instanceof ApiKeyNotFoundError).toBeTruthy();
      expect(prisma.apiKey.update.mock.calls.length).toBe(0);
    });
  });

  // ── deleteByAccountId ─────────────────────────────────────────────────────

  describe("deleteByAccountId", () => {
    it("calls deleteMany with accountId", async () => {
      await repo.deleteByAccountId(BASE_ACCOUNT_ID);

      expect(prisma.apiKey.deleteMany.mock.calls.length).toBe(1);
      const callRecord = prisma.apiKey.deleteMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { accountId: string } };
      expect(args.where.accountId).toBe(BASE_ACCOUNT_ID);
    });
  });
});
