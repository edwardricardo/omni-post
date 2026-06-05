/**
 * @file GenerateIntegrationApiKeyUseCase.test.ts
 * @description Unit tests for GenerateIntegrationApiKeyUseCase — happy path,
 *   missing accountId, max active key limit, and save failure.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { GenerateIntegrationApiKeyUseCase } from "../../src/GenerateIntegrationApiKeyUseCase.js";
import type { IntegrationApiKeyRepository } from "@core/domain/repositories/IntegrationApiKeyRepository.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";

function makeMockRepo(
  opts: {
    countActive?: number;
    saveFails?: boolean;
  } = {}
): IntegrationApiKeyRepository {
  return {
    countActiveByAccountId: vi.fn(async () => opts.countActive ?? 0),
    save: vi.fn(async () => (opts.saveFails ? err(new Error("DB error")) : ok(undefined))),
    findById: vi.fn(async () => err(new Error("not found"))),
    findByAccountId: vi.fn(async () => ok([])),
    revoke: vi.fn(async () => ok(undefined)),
  } as unknown as IntegrationApiKeyRepository;
}

function makeMockHasher(): PasswordHasher {
  return {
    hash: vi.fn(async (plain: string) => `hashed:${plain}`),
    verify: vi.fn(async () => true),
    needsRehash: vi.fn(() => false),
  } as unknown as PasswordHasher;
}

const BASE_INPUT = {
  accountId: "acc-uuid-001",
};

describe("GenerateIntegrationApiKeyUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a plain key, prefix and platform when accountId is valid and limit not reached", async () => {
    const uc = new GenerateIntegrationApiKeyUseCase(makeMockRepo(), makeMockHasher());
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.plainKey.length > 0);
    assert.ok(r.value.keyPrefix.length > 0);
    assert.ok(r.value.id.length > 0);
    assert.strictEqual(r.value.platform, "ZAPIER");
  });

  it("returns VALIDATION_FAILED when accountId is empty", async () => {
    const uc = new GenerateIntegrationApiKeyUseCase(makeMockRepo(), makeMockHasher());
    const r = await uc.execute({ accountId: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the active key limit of 5 is reached", async () => {
    const uc = new GenerateIntegrationApiKeyUseCase(
      makeMockRepo({ countActive: 5 }),
      makeMockHasher()
    );
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns INTERNAL_ERROR when the repository save fails", async () => {
    const uc = new GenerateIntegrationApiKeyUseCase(
      makeMockRepo({ saveFails: true }),
      makeMockHasher()
    );
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
