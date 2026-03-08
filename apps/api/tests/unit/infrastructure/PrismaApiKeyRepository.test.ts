/**
 * Infrastructure Layer - Prisma API Key Repository Unit Tests
 *
 * Part of FASE H10-B: API Key Management
 * Tests PrismaApiKeyRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

import { PrismaApiKeyRepository } from "../../../src/infrastructure/repositories/PrismaApiKeyRepository.js";
import { ApiKeyNotFoundError } from "../../../src/domain/repositories/ApiKeyRepository.js";

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

function makeMockPrisma(t: TestContext) {
  return {
    apiKey: {
      findUnique: t.mock.fn(async () => baseRow()),
      findFirst: t.mock.fn(async () => baseRow()),
      findMany: t.mock.fn(async () => [baseRow()]),
      create: t.mock.fn(async () => baseRow()),
      update: t.mock.fn(async () => baseRow()),
      deleteMany: t.mock.fn(async () => ({ count: 1 })),
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaApiKeyRepository", { concurrency: 1 }, () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaApiKeyRepository;

  beforeEach((t) => {
    prisma = makeMockPrisma(t);
    repo = new PrismaApiKeyRepository(prisma as never);
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns ok(key) when row exists", async () => {
      const result = await repo.findById(BASE_ID);

      assert.ok(result.ok);
      assert.equal(result.value.id, BASE_ID);
      assert.equal(result.value.name, "Test Key");
      assert.equal(result.value.prefix, "op_aabbccdd");
      assert.deepEqual(result.value.permissions, ["read", "write"]);
      assert.equal(result.value.isActive, true);
      assert.equal(result.value.expiresAt, undefined);
      assert.equal(result.value.lastUsedAt, undefined);
      assert.equal(result.value.rotationSchedule, undefined);
      assert.equal(prisma.apiKey.findUnique.mock.calls.length, 1);
    });

    it("returns err(ApiKeyNotFoundError) when row is null", async () => {
      prisma.apiKey.findUnique.mock.mockImplementation(async () => null);

      const result = await repo.findById(BASE_ID);

      assert.ok(!result.ok);
      assert.ok(result.error instanceof ApiKeyNotFoundError);
      assert.match(result.error.message, new RegExp(BASE_ID));
    });

    it("maps nullable fields to undefined correctly", async () => {
      const expiresAt = new Date("2027-01-01");
      const lastUsedAt = new Date("2026-06-01");
      prisma.apiKey.findUnique.mock.mockImplementation(async () => ({
        ...baseRow(),
        expiresAt,
        lastUsedAt,
        rotationSchedule: "0 0 * * 0",
      }));

      const result = await repo.findById(BASE_ID);

      assert.ok(result.ok);
      assert.deepEqual(result.value.expiresAt, expiresAt);
      assert.deepEqual(result.value.lastUsedAt, lastUsedAt);
      assert.equal(result.value.rotationSchedule, "0 0 * * 0");
    });
  });

  // ── findByAccountId ───────────────────────────────────────────────────────

  describe("findByAccountId", () => {
    it("returns array of domain keys for account", async () => {
      const keys = await repo.findByAccountId(BASE_ACCOUNT_ID);

      assert.equal(keys.length, 1);
      assert.equal(keys[0]?.id, BASE_ID);
      assert.equal(prisma.apiKey.findMany.mock.calls.length, 1);
      const callRecord = prisma.apiKey.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { accountId: string; isActive: boolean } };
      assert.equal(args.where.accountId, BASE_ACCOUNT_ID);
      assert.equal(args.where.isActive, true);
    });

    it("returns empty array when no keys found", async () => {
      prisma.apiKey.findMany.mock.mockImplementation(async () => []);

      const keys = await repo.findByAccountId(BASE_ACCOUNT_ID);

      assert.equal(keys.length, 0);
    });
  });

  // ── findActiveByPrefix ────────────────────────────────────────────────────

  describe("findActiveByPrefix", () => {
    it("returns domain key when found", async () => {
      const key = await repo.findActiveByPrefix("op_aabbccdd");

      assert.ok(key !== null);
      assert.equal(key.prefix, "op_aabbccdd");
      assert.equal(prisma.apiKey.findFirst.mock.calls.length, 1);
    });

    it("returns null when prefix not found", async () => {
      prisma.apiKey.findFirst.mock.mockImplementation(async () => null);

      const key = await repo.findActiveByPrefix("op_notexist");

      assert.equal(key, null);
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

      assert.equal(key.id, BASE_ID);
      assert.equal(prisma.apiKey.create.mock.calls.length, 1);
      const callRecord = prisma.apiKey.create.mock.calls[0];
      const args = callRecord?.arguments[0] as { data: { name: string; rateLimit: number } };
      assert.equal(args.data.name, "My Key");
      assert.equal(args.data.rateLimit, 500);
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
      const args = callRecord?.arguments[0] as { data: { expiresAt?: Date } };
      assert.deepEqual(args.data.expiresAt, expiresAt);
    });
  });

  // ── recordUsage ───────────────────────────────────────────────────────────

  describe("recordUsage", () => {
    it("calls update with lastUsedAt", async () => {
      await repo.recordUsage(BASE_ID);

      assert.equal(prisma.apiKey.update.mock.calls.length, 1);
      const callRecord = prisma.apiKey.update.mock.calls[0];
      const args = callRecord?.arguments[0] as {
        where: { id: string };
        data: { lastUsedAt: Date };
      };
      assert.equal(args.where.id, BASE_ID);
      assert.ok(args.data.lastUsedAt instanceof Date);
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────

  describe("deactivate", () => {
    it("returns ok when key exists and is deactivated", async () => {
      const result = await repo.deactivate(BASE_ID);

      assert.ok(result.ok);
      assert.equal(prisma.apiKey.update.mock.calls.length, 1);
      const callRecord = prisma.apiKey.update.mock.calls[0];
      const args = callRecord?.arguments[0] as { data: { isActive: boolean } };
      assert.equal(args.data.isActive, false);
    });

    it("returns err(ApiKeyNotFoundError) when key does not exist", async () => {
      prisma.apiKey.findUnique.mock.mockImplementation(async () => null);

      const result = await repo.deactivate("nonexistent-id");

      assert.ok(!result.ok);
      assert.ok(result.error instanceof ApiKeyNotFoundError);
      assert.equal(prisma.apiKey.update.mock.calls.length, 0);
    });
  });

  // ── rotate ────────────────────────────────────────────────────────────────

  describe("rotate", () => {
    it("returns ok(updatedKey) with new prefix and hash", async () => {
      const newPrefix = "op_newprefix";
      const newHash = "$2b$10$newhash";

      const result = await repo.rotate(BASE_ID, newPrefix, newHash);

      assert.ok(result.ok);
      assert.equal(prisma.apiKey.update.mock.calls.length, 1);
      const callRecord = prisma.apiKey.update.mock.calls[0];
      const args = callRecord?.arguments[0] as {
        where: { id: string };
        data: { prefix: string; keyHash: string };
      };
      assert.equal(args.where.id, BASE_ID);
      assert.equal(args.data.prefix, newPrefix);
      assert.equal(args.data.keyHash, newHash);
    });

    it("returns err(ApiKeyNotFoundError) when key does not exist", async () => {
      prisma.apiKey.findUnique.mock.mockImplementation(async () => null);

      const result = await repo.rotate("nonexistent-id", "op_x", "$2b$10$h");

      assert.ok(!result.ok);
      assert.ok(result.error instanceof ApiKeyNotFoundError);
      assert.equal(prisma.apiKey.update.mock.calls.length, 0);
    });
  });

  // ── deleteByAccountId ─────────────────────────────────────────────────────

  describe("deleteByAccountId", () => {
    it("calls deleteMany with accountId", async () => {
      await repo.deleteByAccountId(BASE_ACCOUNT_ID);

      assert.equal(prisma.apiKey.deleteMany.mock.calls.length, 1);
      const callRecord = prisma.apiKey.deleteMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { accountId: string } };
      assert.equal(args.where.accountId, BASE_ACCOUNT_ID);
    });
  });
});
