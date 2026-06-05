/**
 * @file CreateTrackedLinkUseCase.test.ts
 * @description Unit tests for CreateTrackedLinkUseCase — happy path, invalid project
 *   id validation, vanity slug conflict, and entity validation errors against a
 *   mocked TrackedLinkRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateTrackedLinkUseCase } from "../../src/CreateTrackedLinkUseCase.js";
import type { TrackedLinkRepository } from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440020";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(
  opts: {
    slugAvailable?: boolean;
    saveFails?: boolean;
  } = {}
): TrackedLinkRepository {
  const { slugAvailable = true, saveFails = false } = opts;
  return {
    isShortCodeAvailable: vi.fn(async () => slugAvailable),
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok(undefined))),
  } as unknown as TrackedLinkRepository;
}

const BASE_INPUT = {
  projectId: PROJECT_ID,
  originalUrl: "https://example.com/landing-page",
};

describe("CreateTrackedLinkUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the created link output when input is valid", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTrackedLinkUseCase(repo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.id.length > 0);
    assert.strictEqual(r.value.projectId, PROJECT_ID);
    assert.strictEqual(r.value.originalUrl, BASE_INPUT.originalUrl);
  });

  it("returns VALIDATION_FAILED when the project id is not a valid UUID", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTrackedLinkUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, projectId: "bad-id" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns CONFLICT when the requested vanity slug is already taken", async () => {
    const repo = makeMockRepo({ slugAvailable: false });
    const uc = new CreateTrackedLinkUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, vanitySlug: "my-slug" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.CONFLICT);
  });

  it("returns VALIDATION_FAILED when the original url is empty", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTrackedLinkUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, originalUrl: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });
});
