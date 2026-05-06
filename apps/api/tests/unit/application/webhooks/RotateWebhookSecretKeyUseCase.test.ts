/**
 * @file RotateWebhookSecretKeyUseCase.test.ts
 * @description Unit tests for the webhook secret rotation use case. Stubs the
 *              repository to verify validation, not-found, success path,
 *              persistence-failure handling, grace-window arithmetic, and UoW
 *              wrapping.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { RotateWebhookSecretKeyUseCase } from "../../../../src/application/webhooks/RotateWebhookSecretKeyUseCase.js";
import type { WebhookSubscriptionRotationRepository } from "../../../../src/application/webhooks/WebhookSubscriptionRotationRepository.js";

const SUB_ID = "sub-uuid-123";
const FIXED_NOW = new Date("2026-05-06T12:00:00.000Z");

function makeRepo(
  overrides: Partial<WebhookSubscriptionRotationRepository> = {}
): WebhookSubscriptionRotationRepository {
  return {
    findById: vi.fn().mockResolvedValue({ id: SUB_ID, secretKey: "old-secret-deadbeef" }),
    rotateSecret: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as WebhookSubscriptionRotationRepository;
}

describe("RotateWebhookSecretKeyUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty webhookSubscriptionId with VALIDATION_FAILED", async () => {
    const useCase = new RotateWebhookSecretKeyUseCase(makeRepo());
    const result = await useCase.execute({ webhookSubscriptionId: "   " });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("rejects graceWindowHours below the 1h floor", async () => {
    const useCase = new RotateWebhookSecretKeyUseCase(makeRepo());
    const result = await useCase.execute({
      webhookSubscriptionId: SUB_ID,
      graceWindowHours: 0,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("rejects graceWindowHours above the 30d ceiling", async () => {
    const useCase = new RotateWebhookSecretKeyUseCase(makeRepo());
    const result = await useCase.execute({
      webhookSubscriptionId: SUB_ID,
      graceWindowHours: 24 * 31,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns NOT_FOUND when subscription does not exist", async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
    const useCase = new RotateWebhookSecretKeyUseCase(repo);
    const result = await useCase.execute({ webhookSubscriptionId: SUB_ID });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "NOT_FOUND");
    assert.equal((repo.rotateSecret as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("rotates with default 24h grace window when none specified", async () => {
    const rotateSpy = vi.fn().mockResolvedValue(true);
    const repo = makeRepo({ rotateSecret: rotateSpy });
    const useCase = new RotateWebhookSecretKeyUseCase(
      repo,
      undefined,
      () => "new-secret-cafebabe",
      () => FIXED_NOW
    );
    const result = await useCase.execute({ webhookSubscriptionId: SUB_ID });
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.value.graceWindowHours, 24);
    assert.equal(result.value.newSecretKey, "new-secret-cafebabe");
    assert.equal(
      result.value.previousSecretKeyExpiresAt,
      new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000).toISOString()
    );
    const args = rotateSpy.mock.calls[0]?.[0];
    assert.equal(args.previousSecretKey, "old-secret-deadbeef");
    assert.equal(args.newSecretKey, "new-secret-cafebabe");
  });

  it("respects custom graceWindowHours (e.g. 1h emergency rotation)", async () => {
    const useCase = new RotateWebhookSecretKeyUseCase(
      makeRepo(),
      undefined,
      () => "fresh",
      () => FIXED_NOW
    );
    const result = await useCase.execute({
      webhookSubscriptionId: SUB_ID,
      graceWindowHours: 1,
    });
    assert.ok(result.ok);
    assert.equal(result.value.graceWindowHours, 1);
    assert.equal(
      result.value.previousSecretKeyExpiresAt,
      new Date(FIXED_NOW.getTime() + 60 * 60 * 1000).toISOString()
    );
  });

  it("does not leak the old secret in the success DTO", async () => {
    const useCase = new RotateWebhookSecretKeyUseCase(
      makeRepo(),
      undefined,
      () => "new-shiny",
      () => FIXED_NOW
    );
    const result = await useCase.execute({ webhookSubscriptionId: SUB_ID });
    assert.ok(result.ok);
    const json = JSON.stringify(result.value);
    assert.ok(!json.includes("old-secret-deadbeef"));
  });

  it("returns INTERNAL_ERROR when repository persistence fails", async () => {
    const repo = makeRepo({ rotateSecret: vi.fn().mockResolvedValue(false) });
    const useCase = new RotateWebhookSecretKeyUseCase(repo);
    const result = await useCase.execute({ webhookSubscriptionId: SUB_ID });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });

  it("runs inside UnitOfWork.executeInTransaction when UoW provided", async () => {
    const uowExecute = vi.fn(async (cb: () => Promise<void>) => {
      await cb();
    });
    const useCase = new RotateWebhookSecretKeyUseCase(makeRepo(), {
      executeInTransaction: uowExecute,
    });
    const result = await useCase.execute({ webhookSubscriptionId: SUB_ID });
    assert.ok(result.ok);
    assert.equal(uowExecute.mock.calls.length, 1);
  });
});
