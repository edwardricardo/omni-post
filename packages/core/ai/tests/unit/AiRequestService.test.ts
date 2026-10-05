/**
 * @file AiRequestService.test.ts
 * @description Unit tests for AiRequestService's pool path as seen through the
 *   injected LoggerPort: each of its three degraded branches (the subscription read,
 *   the usage read, the usage write) lets the request through and reports the
 *   fallback as a warning, and a run where all three succeed writes nothing to the
 *   logger.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import type { LoggerPort, PlatformCredentialPort } from "@ports/core";
import { AiRequestService } from "../../src/AiRequestService.js";
import type { AIRequestExecutorPort } from "@core/domain/repositories/AIRequestExecutorPort.js";
import type { AccountSubscriptionBillingRepository } from "@core/domain/repositories/AccountSubscriptionBillingRepository.js";
import type { AiTokenUsageReader } from "@core/domain/repositories/AiTokenUsageReader.js";
import type { AITask } from "@core/domain/ai/AIContracts.js";

const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
const POOL_PROVIDER = "openai";
const POOL_TOKENS_USED = 120;

const TASK: AITask = {
  type: "generate",
  data: { messages: [{ role: "user", content: "Draft a launch post" }] },
};

const POOL_RESPONSE = {
  ok: true,
  value: "generated text",
  metadata: {
    provider: POOL_PROVIDER,
    model: "gpt-4o",
    tokensUsed: POOL_TOKENS_USED,
    latency: 15,
    cached: false,
  },
};

function makeCredentials(): PlatformCredentialPort {
  return {
    getAccountCredential: vi.fn(async () => ok(null)),
    getGroup: vi.fn(async () => ok({ OPENAI_API_KEY: "pool-key" })),
  } as unknown as PlatformCredentialPort;
}

/**
 * The pool executor double. With `reportsUsage` it invokes the usage callback the
 * service passes, exactly once, before answering, which is the only way the
 * service's usage write runs.
 */
function makeExecutor(options: { reportsUsage?: boolean } = {}): AIRequestExecutorPort {
  return {
    executeWithApiKey: vi.fn(),
    executeWithPool: vi.fn(
      async (
        _pool: unknown,
        _preferredProvider: unknown,
        _task: unknown,
        onUsage: (provider: string, tokens: number) => Promise<void>
      ) => {
        if (options.reportsUsage) {
          await onUsage(POOL_PROVIDER, POOL_TOKENS_USED);
        }
        return POOL_RESPONSE;
      }
    ),
  } as unknown as AIRequestExecutorPort;
}

function makeSubscriptions(): AccountSubscriptionBillingRepository {
  return {
    findActiveOrTrialingByAccount: vi.fn(async () => ok(null)),
  } as unknown as AccountSubscriptionBillingRepository;
}

function makeFailingSubscriptions(): AccountSubscriptionBillingRepository {
  return {
    findActiveOrTrialingByAccount: vi.fn(async () => err("DATABASE_ERROR")),
  } as unknown as AccountSubscriptionBillingRepository;
}

function makeTokenUsage(
  options: { usageReadFails?: boolean; usageWriteFails?: boolean } = {}
): AiTokenUsageReader & { recordUsage: ReturnType<typeof vi.fn> } {
  return {
    sumTokensThisMonth: vi.fn(async () => (options.usageReadFails ? err("DATABASE_ERROR") : ok(0))),
    recordUsage: vi.fn(async () =>
      options.usageWriteFails ? err("DATABASE_ERROR") : ok(undefined)
    ),
  } as unknown as AiTokenUsageReader & { recordUsage: ReturnType<typeof vi.fn> };
}

function makeMockLogger() {
  return { warn: vi.fn(), error: vi.fn() } satisfies LoggerPort;
}

function assertPoolResponse(result: Awaited<ReturnType<AiRequestService["executeRequest"]>>) {
  assert.ok(result.ok, `expected ok but got err: ${result.ok ? "" : String(result.error)}`);
  assert.strictEqual(result.value.isByok, false);
  assert.strictEqual(result.value.provider, POOL_PROVIDER);
  assert.strictEqual(result.value.tokensUsed, POOL_TOKENS_USED);
}

describe("AiRequestService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the pool response and warns through the injected logger when the subscription read fails", async () => {
    const logger = makeMockLogger();
    const service = new AiRequestService(
      makeCredentials(),
      makeExecutor(),
      makeFailingSubscriptions(),
      makeTokenUsage(),
      logger
    );

    const result = await service.executeRequest({ accountId: ACCOUNT_ID, task: TASK });

    assertPoolResponse(result);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { accountId: ACCOUNT_ID },
      "Rate limit check: subscription read failed, allowing request"
    );
  });

  it("returns the pool response and warns through the injected logger when the usage read fails", async () => {
    const logger = makeMockLogger();
    const service = new AiRequestService(
      makeCredentials(),
      makeExecutor(),
      makeSubscriptions(),
      makeTokenUsage({ usageReadFails: true }),
      logger
    );

    const result = await service.executeRequest({ accountId: ACCOUNT_ID, task: TASK });

    assertPoolResponse(result);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { accountId: ACCOUNT_ID },
      "Rate limit check: usage read failed, allowing request"
    );
  });

  it("returns the pool response and warns through the injected logger when the usage write fails", async () => {
    const logger = makeMockLogger();
    const tokenUsage = makeTokenUsage({ usageWriteFails: true });
    const service = new AiRequestService(
      makeCredentials(),
      makeExecutor({ reportsUsage: true }),
      makeSubscriptions(),
      tokenUsage,
      logger
    );

    const result = await service.executeRequest({ accountId: ACCOUNT_ID, task: TASK });

    assertPoolResponse(result);
    expect(tokenUsage.recordUsage).toHaveBeenCalledWith(
      ACCOUNT_ID,
      POOL_PROVIDER,
      POOL_TOKENS_USED,
      false
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { accountId: ACCOUNT_ID, provider: POOL_PROVIDER },
      "Failed to write AiTokenUsage"
    );
  });

  it("writes nothing to the injected logger when the subscription read, the usage read and the usage write all succeed", async () => {
    const logger = makeMockLogger();
    const tokenUsage = makeTokenUsage();
    const service = new AiRequestService(
      makeCredentials(),
      makeExecutor({ reportsUsage: true }),
      makeSubscriptions(),
      tokenUsage,
      logger
    );

    const result = await service.executeRequest({ accountId: ACCOUNT_ID, task: TASK });

    assertPoolResponse(result);
    expect(tokenUsage.recordUsage).toHaveBeenCalledWith(
      ACCOUNT_ID,
      POOL_PROVIDER,
      POOL_TOKENS_USED,
      false
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
