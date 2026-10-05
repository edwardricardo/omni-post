/**
 * @file AiRequestService.test.ts
 * @description Unit tests for AiRequestService's degraded pool path: when the
 *   subscription read fails, the rate limit lets the request through and the
 *   fallback is reported through the injected LoggerPort.
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

const TASK: AITask = {
  type: "generate",
  data: { messages: [{ role: "user", content: "Draft a launch post" }] },
};

function makeCredentials(): PlatformCredentialPort {
  return {
    getAccountCredential: vi.fn(async () => ok(null)),
    getGroup: vi.fn(async () => ok({ OPENAI_API_KEY: "pool-key" })),
  } as unknown as PlatformCredentialPort;
}

function makeExecutor(): AIRequestExecutorPort {
  return {
    executeWithApiKey: vi.fn(),
    executeWithPool: vi.fn(async () => ({
      ok: true,
      value: "generated text",
      metadata: {
        provider: "openai",
        model: "gpt-4o",
        tokensUsed: 120,
        latency: 15,
        cached: false,
      },
    })),
  } as unknown as AIRequestExecutorPort;
}

function makeFailingSubscriptions(): AccountSubscriptionBillingRepository {
  return {
    findActiveOrTrialingByAccount: vi.fn(async () => err("DATABASE_ERROR")),
  } as unknown as AccountSubscriptionBillingRepository;
}

function makeTokenUsage(): AiTokenUsageReader {
  return {
    sumTokensThisMonth: vi.fn(async () => ok(0)),
    recordUsage: vi.fn(async () => ok(undefined)),
  } as unknown as AiTokenUsageReader;
}

function makeMockLogger() {
  return { warn: vi.fn(), error: vi.fn() } satisfies LoggerPort;
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

    assert.ok(result.ok, `expected ok but got err: ${result.ok ? "" : String(result.error)}`);
    assert.strictEqual(result.value.isByok, false);
    assert.strictEqual(result.value.provider, "openai");
    expect(logger.warn).toHaveBeenCalledWith(
      { accountId: ACCOUNT_ID },
      "Rate limit check: subscription read failed, allowing request"
    );
  });
});
