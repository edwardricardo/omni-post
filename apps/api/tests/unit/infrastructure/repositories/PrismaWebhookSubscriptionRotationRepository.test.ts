/**
 * @file PrismaWebhookSubscriptionRotationRepository.test.ts
 * @description Unit tests for the Prisma adapter. Mocks the Prisma client
 *              to verify the query shape (findUnique select + update data)
 *              and that errors map to a `false` rotation result without
 *              throwing.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { PrismaWebhookSubscriptionRotationRepository } from "../../../../src/infrastructure/repositories/PrismaWebhookSubscriptionRotationRepository.js";

function makePrismaStub(behaviors: {
  findUniqueResult?: unknown;
  findUniqueThrows?: Error;
  updateThrows?: Error;
}) {
  const findUnique = vi.fn(async () => {
    if (behaviors.findUniqueThrows) throw behaviors.findUniqueThrows;
    return behaviors.findUniqueResult ?? null;
  });
  const update = vi.fn(async () => {
    if (behaviors.updateThrows) throw behaviors.updateThrows;
    return {} as unknown;
  });
  return {
    prisma: {
      webhookSubscription: { findUnique, update },
    } as unknown as Parameters<
      typeof PrismaWebhookSubscriptionRotationRepository.prototype.constructor
    >[0],
    findUnique,
    update,
  };
}

describe("PrismaWebhookSubscriptionRotationRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("findById returns the row when it exists, with select narrowed to (id, secretKey)", async () => {
    const stub = makePrismaStub({
      findUniqueResult: { id: "s1", secretKey: "old-secret" },
    });
    const repo = new PrismaWebhookSubscriptionRotationRepository(stub.prisma);
    const row = await repo.findById("s1");
    assert.deepEqual(row, { id: "s1", secretKey: "old-secret" });
    const call = stub.findUnique.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.deepEqual(call.where, { id: "s1" });
    assert.deepEqual(call.select, { id: true, secretKey: true });
  });

  it("findById returns null when row does not exist", async () => {
    const stub = makePrismaStub({ findUniqueResult: null });
    const repo = new PrismaWebhookSubscriptionRotationRepository(stub.prisma);
    const row = await repo.findById("missing");
    assert.equal(row, null);
  });

  it("rotateSecret writes (secretKey, previousSecretKey, previousSecretKeyExpiresAt) and returns true", async () => {
    const stub = makePrismaStub({});
    const repo = new PrismaWebhookSubscriptionRotationRepository(stub.prisma);
    const expiresAt = new Date("2026-05-07T12:00:00.000Z");
    const ok = await repo.rotateSecret({
      id: "s1",
      newSecretKey: "new-shiny",
      previousSecretKey: "old-secret",
      previousSecretKeyExpiresAt: expiresAt,
    });
    assert.equal(ok, true);
    const call = stub.update.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.deepEqual(call.where, { id: "s1" });
    assert.deepEqual(call.data, {
      secretKey: "new-shiny",
      previousSecretKey: "old-secret",
      previousSecretKeyExpiresAt: expiresAt,
    });
  });

  it("rotateSecret returns false when Prisma update throws (no exception escapes)", async () => {
    const stub = makePrismaStub({ updateThrows: new Error("DB exploded") });
    const repo = new PrismaWebhookSubscriptionRotationRepository(stub.prisma);
    const ok = await repo.rotateSecret({
      id: "s1",
      newSecretKey: "x",
      previousSecretKey: "y",
      previousSecretKeyExpiresAt: new Date(),
    });
    assert.equal(ok, false);
  });
});
