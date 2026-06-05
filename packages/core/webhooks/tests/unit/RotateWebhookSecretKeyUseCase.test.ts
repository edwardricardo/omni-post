/**
 * @file RotateWebhookSecretKeyUseCase.test.ts
 * @description Unit tests for RotateWebhookSecretKeyUseCase — happy path, missing
 *   subscription id validation, invalid grace window, subscription not found,
 *   and persistence failure against a mocked WebhookSubscriptionRotationRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { RotateWebhookSecretKeyUseCase } from "../../src/RotateWebhookSecretKeyUseCase.js";
import type { WebhookSubscriptionRotationRepository } from "../../src/WebhookSubscriptionRotationRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const SUB_ID = "sub-00000000-0000-4000-8000-000000000001";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

const FIXED_SECRET = "aabbccdd".repeat(8); // 64 hex chars

function makeMockRepo(
  opts: {
    found?: boolean;
    rotateFails?: boolean;
  } = {}
): WebhookSubscriptionRotationRepository {
  const { found = true, rotateFails = false } = opts;
  return {
    findById: vi.fn(async () => (found ? { id: SUB_ID, secretKey: "old-secret-key" } : null)),
    rotateSecret: vi.fn(async () => (rotateFails ? false : true)),
  };
}

describe("RotateWebhookSecretKeyUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the new secret key and expiry when the subscription exists", async () => {
    const repo = makeMockRepo();
    const uc = new RotateWebhookSecretKeyUseCase(repo, passthroughUow, () => FIXED_SECRET);
    const r = await uc.execute({ webhookSubscriptionId: SUB_ID });
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(r.value.webhookSubscriptionId, SUB_ID);
    assert.strictEqual(r.value.newSecretKey, FIXED_SECRET);
    assert.strictEqual(r.value.graceWindowHours, 24);
    assert.ok(r.value.previousSecretKeyExpiresAt.length > 0);
  });

  it("returns VALIDATION_FAILED when webhookSubscriptionId is empty", async () => {
    const repo = makeMockRepo();
    const uc = new RotateWebhookSecretKeyUseCase(repo, passthroughUow);
    const r = await uc.execute({ webhookSubscriptionId: "   " });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when graceWindowHours is out of range", async () => {
    const repo = makeMockRepo();
    const uc = new RotateWebhookSecretKeyUseCase(repo, passthroughUow);
    const r = await uc.execute({ webhookSubscriptionId: SUB_ID, graceWindowHours: 999 });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns NOT_FOUND when the subscription does not exist", async () => {
    const repo = makeMockRepo({ found: false });
    const uc = new RotateWebhookSecretKeyUseCase(repo, passthroughUow);
    const r = await uc.execute({ webhookSubscriptionId: SUB_ID });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });
});
