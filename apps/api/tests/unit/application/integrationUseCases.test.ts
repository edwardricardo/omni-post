/**
 * @file integrationUseCases.test.ts
 * @description Unit tests for all integration platform application use cases and services.
 *   Covers both Zapier and Make platforms.
 * @layer application
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { GenerateIntegrationApiKeyUseCase } from "../../../src/application/integrations/GenerateIntegrationApiKeyUseCase.js";
import { RevokeIntegrationApiKeyUseCase } from "../../../src/application/integrations/RevokeIntegrationApiKeyUseCase.js";
import { ListIntegrationApiKeysQuery } from "../../../src/application/integrations/ListIntegrationApiKeysQuery.js";
import { SubscribeIntegrationTriggerUseCase } from "../../../src/application/integrations/SubscribeIntegrationTriggerUseCase.js";
import { UnsubscribeIntegrationTriggerUseCase } from "../../../src/application/integrations/UnsubscribeIntegrationTriggerUseCase.js";
import { TriggerIntegrationEventService } from "../../../src/application/integrations/TriggerIntegrationEventService.js";
import { IntegrationApiKey } from "../../../src/domain/entities/IntegrationApiKey.js";
import { IntegrationSubscription } from "../../../src/domain/entities/IntegrationSubscription.js";
import type { IntegrationApiKeyRepository } from "../../../src/domain/repositories/IntegrationApiKeyRepository.js";
import type { IntegrationSubscriptionRepository } from "../../../src/domain/repositories/IntegrationSubscriptionRepository.js";
import type { IntegrationPlatformValue } from "../../../src/domain/entities/IntegrationApiKey.js";

// ============================================================================
// Mock Factories
// ============================================================================

function makeApiKeyRepo(
  overrides?: Partial<IntegrationApiKeyRepository>
): IntegrationApiKeyRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByAccountId: vi.fn().mockResolvedValue([]),
    findByKeyPrefix: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    countActiveByAccountId: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeSubRepo(
  overrides?: Partial<IntegrationSubscriptionRepository>
): IntegrationSubscriptionRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByEvent: vi.fn().mockResolvedValue([]),
    findActiveByEventAndPlatform: vi.fn().mockResolvedValue([]),
    findByAccountId: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

function makeApiKey(overrides?: Partial<Record<string, unknown>>): IntegrationApiKey {
  const result = IntegrationApiKey.create({
    accountId: (overrides?.accountId as string) ?? "acc-001",
    platform: (overrides?.platform as IntegrationPlatformValue) ?? "ZAPIER",
    keyHash: "$argon2id$v=19$m=65536,t=3,p=4$salt$hash",
    keyPrefix: "zap_abcd1234",
    ...(overrides?.label !== undefined && { label: overrides.label as string }),
  });
  if (!result.ok) {
    throw new Error(`Test fixture failed: ${result.error.message}`);
  }
  return result.value;
}

function makeMakeApiKey(overrides?: Partial<Record<string, unknown>>): IntegrationApiKey {
  const result = IntegrationApiKey.create({
    accountId: (overrides?.accountId as string) ?? "acc-001",
    platform: "MAKE",
    keyHash: "$argon2id$v=19$m=65536,t=3,p=4$salt$hash",
    keyPrefix: "mak_abcd1234",
    ...(overrides?.label !== undefined && { label: overrides.label as string }),
  });
  if (!result.ok) {
    throw new Error(`Test fixture failed: ${result.error.message}`);
  }
  return result.value;
}

function makeSub(overrides?: Partial<Record<string, unknown>>): IntegrationSubscription {
  const result = IntegrationSubscription.create({
    accountId: (overrides?.accountId as string) ?? "acc-001",
    platform: (overrides?.platform as IntegrationPlatformValue) ?? "ZAPIER",
    event: (overrides?.event as string) ?? "post.published",
    targetUrl: (overrides?.targetUrl as string) ?? "https://hooks.zapier.com/webhook/test",
  });
  if (!result.ok) {
    throw new Error(`Test fixture failed: ${result.error.message}`);
  }
  return result.value;
}

// ============================================================================
// GenerateIntegrationApiKeyUseCase
// ============================================================================

describe("GenerateIntegrationApiKeyUseCase", () => {
  let repo: IntegrationApiKeyRepository;
  let useCase: GenerateIntegrationApiKeyUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeApiKeyRepo();
    useCase = new GenerateIntegrationApiKeyUseCase(repo);
  });

  it("generates a key with zap_ prefix for ZAPIER platform and returns plainKey once", async () => {
    const result = await useCase.execute({ accountId: "acc-001", label: "Test" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.plainKey).toMatch(/^zap_/);
    expect(result.value.keyPrefix).toMatch(/^zap_/);
    expect(result.value.platform).toBe("ZAPIER");
    expect(result.value.id).toBeTruthy();
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("generates a key with mak_ prefix for MAKE platform", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      platform: "MAKE",
      label: "Make Key",
    });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.plainKey).toMatch(/^mak_/);
    expect(result.value.keyPrefix).toMatch(/^mak_/);
    expect(result.value.platform).toBe("MAKE");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("defaults to ZAPIER platform when platform is not specified", async () => {
    const result = await useCase.execute({ accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.platform).toBe("ZAPIER");
  });

  it("rejects when active key count reaches maximum (5)", async () => {
    repo = makeApiKeyRepo({
      countActiveByAccountId: vi.fn().mockResolvedValue(5),
    });
    useCase = new GenerateIntegrationApiKeyUseCase(repo);

    const result = await useCase.execute({ accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.message).toContain("Maximum");
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects empty accountId", async () => {
    const result = await useCase.execute({ accountId: "" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns error when save fails", async () => {
    repo = makeApiKeyRepo({
      save: vi.fn().mockResolvedValue(err(new Error("DB down"))),
    });
    useCase = new GenerateIntegrationApiKeyUseCase(repo);

    const result = await useCase.execute({ accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});

// ============================================================================
// RevokeIntegrationApiKeyUseCase
// ============================================================================

describe("RevokeIntegrationApiKeyUseCase", () => {
  let repo: IntegrationApiKeyRepository;
  let useCase: RevokeIntegrationApiKeyUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeApiKeyRepo();
    useCase = new RevokeIntegrationApiKeyUseCase(repo);
  });

  it("revokes an existing key belonging to the account", async () => {
    const key = makeApiKey({ accountId: "acc-001" });
    repo = makeApiKeyRepo({
      findById: vi.fn().mockResolvedValue(key),
    });
    useCase = new RevokeIntegrationApiKeyUseCase(repo);

    const result = await useCase.execute({ keyId: key.id, accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("returns NOT_FOUND when key does not exist", async () => {
    const result = await useCase.execute({ keyId: "nonexistent", accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns FORBIDDEN when key belongs to another account", async () => {
    const key = makeApiKey({ accountId: "acc-other" });
    repo = makeApiKeyRepo({
      findById: vi.fn().mockResolvedValue(key),
    });
    useCase = new RevokeIntegrationApiKeyUseCase(repo);

    const result = await useCase.execute({ keyId: key.id, accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("rejects empty keyId", async () => {
    const result = await useCase.execute({ keyId: "", accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

// ============================================================================
// ListIntegrationApiKeysQuery
// ============================================================================

describe("ListIntegrationApiKeysQuery", () => {
  let repo: IntegrationApiKeyRepository;
  let query: ListIntegrationApiKeysQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeApiKeyRepo();
    query = new ListIntegrationApiKeysQuery(repo);
  });

  it("returns DTOs without keyHash and with platform", async () => {
    const keys = [makeApiKey(), makeApiKey({ label: "Second" })];
    repo = makeApiKeyRepo({
      findActiveByAccountId: vi.fn().mockResolvedValue(keys),
    });
    query = new ListIntegrationApiKeysQuery(repo);

    const result = await query.execute({ accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value).toHaveLength(2);
    for (const dto of result.value) {
      expect(dto).toHaveProperty("id");
      expect(dto).toHaveProperty("keyPrefix");
      expect(dto).toHaveProperty("platform");
      expect(dto).toHaveProperty("createdAt");
      expect(dto).not.toHaveProperty("keyHash");
    }
  });

  it("returns empty array when no keys exist", async () => {
    const result = await query.execute({ accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value).toHaveLength(0);
  });

  it("rejects empty accountId", async () => {
    const result = await query.execute({ accountId: "" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

// ============================================================================
// SubscribeIntegrationTriggerUseCase
// ============================================================================

describe("SubscribeIntegrationTriggerUseCase", () => {
  let repo: IntegrationSubscriptionRepository;
  let useCase: SubscribeIntegrationTriggerUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeSubRepo();
    useCase = new SubscribeIntegrationTriggerUseCase(repo);
  });

  it("creates a subscription for a supported event (default ZAPIER)", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      event: "post.published",
      targetUrl: "https://hooks.zapier.com/webhook/test",
    });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.id).toBeTruthy();
    expect(result.value.event).toBe("post.published");
    expect(result.value.platform).toBe("ZAPIER");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("creates a subscription with MAKE platform", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      platform: "MAKE",
      event: "post.published",
      targetUrl: "https://hook.make.com/webhook/test",
    });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.platform).toBe("MAKE");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects unsupported event type", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      event: "unsupported.event",
      targetUrl: "https://hooks.zapier.com/webhook/test",
    });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects non-HTTPS targetUrl", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      event: "post.published",
      targetUrl: "http://hooks.zapier.com/webhook/test",
    });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects empty accountId", async () => {
    const result = await useCase.execute({
      accountId: "",
      event: "post.published",
      targetUrl: "https://hooks.zapier.com/webhook/test",
    });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

// ============================================================================
// UnsubscribeIntegrationTriggerUseCase
// ============================================================================

describe("UnsubscribeIntegrationTriggerUseCase", () => {
  let repo: IntegrationSubscriptionRepository;
  let useCase: UnsubscribeIntegrationTriggerUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeSubRepo();
    useCase = new UnsubscribeIntegrationTriggerUseCase(repo);
  });

  it("deactivates an existing subscription belonging to the account", async () => {
    const sub = makeSub({ accountId: "acc-001" });
    repo = makeSubRepo({
      findById: vi.fn().mockResolvedValue(sub),
    });
    useCase = new UnsubscribeIntegrationTriggerUseCase(repo);

    const result = await useCase.execute({
      subscriptionId: sub.id,
      accountId: "acc-001",
    });

    assert.ok(result.ok, "Should succeed");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("returns NOT_FOUND when subscription does not exist", async () => {
    const result = await useCase.execute({
      subscriptionId: "nonexistent",
      accountId: "acc-001",
    });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns FORBIDDEN when subscription belongs to another account", async () => {
    const sub = makeSub({ accountId: "acc-other" });
    repo = makeSubRepo({
      findById: vi.fn().mockResolvedValue(sub),
    });
    useCase = new UnsubscribeIntegrationTriggerUseCase(repo);

    const result = await useCase.execute({
      subscriptionId: sub.id,
      accountId: "acc-001",
    });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("FORBIDDEN");
  });
});

// ============================================================================
// TriggerIntegrationEventService
// ============================================================================

describe("TriggerIntegrationEventService", () => {
  let repo: IntegrationSubscriptionRepository;
  let service: TriggerIntegrationEventService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeSubRepo();
    service = new TriggerIntegrationEventService(repo);

    // Mock global fetch
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("OK", { status: 200 })));
  });

  it("fires POST requests to all active subscribers (all platforms)", async () => {
    const sub1 = makeSub({ targetUrl: "https://hooks.zapier.com/a" });
    const sub2 = makeSub({ targetUrl: "https://hooks.zapier.com/b" });

    repo = makeSubRepo({
      findActiveByEvent: vi.fn().mockResolvedValue([sub1, sub2]),
    });
    service = new TriggerIntegrationEventService(repo);

    await service.fire("post.published", { postId: "p-001" });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fires only to Make subscribers when platform filter is MAKE", async () => {
    const makeSub1 = makeSub({
      platform: "MAKE",
      targetUrl: "https://hook.make.com/a",
    });

    repo = makeSubRepo({
      findActiveByEventAndPlatform: vi.fn().mockResolvedValue([makeSub1]),
    });
    service = new TriggerIntegrationEventService(repo);

    await service.fire("post.published", { postId: "p-001" }, "MAKE");

    expect(repo.findActiveByEventAndPlatform).toHaveBeenCalledWith("post.published", "MAKE");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not throw when fetch fails", async () => {
    const sub = makeSub();
    repo = makeSubRepo({
      findActiveByEvent: vi.fn().mockResolvedValue([sub]),
    });
    service = new TriggerIntegrationEventService(repo);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    // Should not throw
    await service.fire("post.published", { postId: "p-001" });
  });

  it("does not fire when no active subscriptions exist", async () => {
    await service.fire("post.published", { postId: "p-001" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not throw when repository lookup fails", async () => {
    repo = makeSubRepo({
      findActiveByEvent: vi.fn().mockRejectedValue(new Error("DB down")),
    });
    service = new TriggerIntegrationEventService(repo);

    // Should not throw
    await service.fire("post.published", { postId: "p-001" });
  });
});
