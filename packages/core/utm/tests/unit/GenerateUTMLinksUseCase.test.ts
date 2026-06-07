/**
 * @file GenerateUTMLinksUseCase.test.ts
 * @description Unit tests for GenerateUTMLinksUseCase — happy path, validation
 *   errors (bad link id, empty utm fields), and not-found against a mocked
 *   TrackedLinkRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { GenerateUTMLinksUseCase } from "../../src/GenerateUTMLinksUseCase.js";
import type { TrackedLinkRepository } from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const TRACKED_LINK_ID = "550e8400-e29b-41d4-a716-446655440010";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

const UTM_URL = "https://example.com/page?utm_source=twitter&utm_medium=social&utm_campaign=launch";

function makeLinkStub(): Record<string, unknown> {
  return {
    setUTMParameters: vi.fn(),
    getUTMUrl: vi.fn(() => UTM_URL),
  };
}

function makeMockRepo(found = true): TrackedLinkRepository {
  return {
    save: vi.fn(async () => ok(undefined)),
    findById: vi.fn(async () =>
      found ? ok(makeLinkStub()) : err(new EntityNotFoundError("TrackedLink", TRACKED_LINK_ID))
    ),
  } as unknown as TrackedLinkRepository;
}

const BASE_INPUT = {
  trackedLinkId: TRACKED_LINK_ID,
  source: "twitter",
  medium: "social",
  campaign: "launch",
};

describe("GenerateUTMLinksUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the UTM url when the link exists and parameters are valid", async () => {
    const uc = new GenerateUTMLinksUseCase(makeMockRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.utmUrl.length > 0);
  });

  it("returns VALIDATION_FAILED when the tracked link id is not a valid UUID", async () => {
    const uc = new GenerateUTMLinksUseCase(makeMockRepo(true), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, trackedLinkId: "not-a-uuid" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the utm source is empty", async () => {
    const uc = new GenerateUTMLinksUseCase(makeMockRepo(true), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, source: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns NOT_FOUND when the tracked link does not exist", async () => {
    const uc = new GenerateUTMLinksUseCase(makeMockRepo(false), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });
});
