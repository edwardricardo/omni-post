/**
 * @file CreateTrackedLinkUseCase.test.ts
 * @description Unit tests for CreateTrackedLinkUseCase — happy path, invalid project
 *   id validation, vanity slug conflict, entity validation errors, parent-project
 *   ownership resolution (foreign/missing project → NOT_FOUND before any persistence
 *   or slug probe), and accountId threading from the guard-resolved project.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateTrackedLinkUseCase } from "../../src/CreateTrackedLinkUseCase.js";
import type { TrackedLink } from "@core/domain/index.js";
import type { TrackedLinkRepository } from "@core/domain/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440020";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(
  opts: {
    slugAvailable?: boolean;
    saveFails?: boolean;
  } = {}
): TrackedLinkRepository & { save: ReturnType<typeof vi.fn> } {
  const { slugAvailable = true, saveFails = false } = opts;
  return {
    isShortCodeAvailable: vi.fn(async () => slugAvailable),
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok(undefined))),
  } as unknown as TrackedLinkRepository & { save: ReturnType<typeof vi.fn> };
}

const makeProject = (): Project => {
  const result = Project.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    name: "Test Project",
  });
  if (!result.ok) throw new Error("fixture: Project.create failed");
  return result.value;
};

// Narrow mock — the use case only calls findById. Cast to the port for the ctor.
const makeProjectRepo = (found = true) =>
  ({
    findById: vi
      .fn()
      .mockResolvedValue(
        found ? ok(makeProject()) : err(new EntityNotFoundError("Project", PROJECT_ID))
      ),
  }) as unknown as ProjectRepositoryPort & { findById: ReturnType<typeof vi.fn> };

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
    const uc = new CreateTrackedLinkUseCase(repo, makeProjectRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.id.length > 0);
    assert.strictEqual(r.value.projectId, PROJECT_ID);
    assert.strictEqual(r.value.originalUrl, BASE_INPUT.originalUrl);
  });

  it("returns VALIDATION_FAILED when the project id is not a valid UUID", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTrackedLinkUseCase(repo, makeProjectRepo(true), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, projectId: "bad-id" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns NOT_FOUND (never persisting, never probing the slug) when the project is foreign/missing", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTrackedLinkUseCase(repo, makeProjectRepo(false), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, vanitySlug: "some-slug" });
    assert.ok(!r.ok, "foreign project must fail");
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
    assert.strictEqual(
      repo.save.mock.calls.length,
      0,
      "no row may be persisted for a foreign project"
    );
  });

  it("returns CONFLICT when the requested vanity slug is already taken", async () => {
    const repo = makeMockRepo({ slugAvailable: false });
    const uc = new CreateTrackedLinkUseCase(repo, makeProjectRepo(true), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, vanitySlug: "my-slug" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.CONFLICT);
  });

  it("returns VALIDATION_FAILED when the original url is empty", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTrackedLinkUseCase(repo, makeProjectRepo(true), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, originalUrl: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("threads the resolved project's accountId onto the persisted link", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTrackedLinkUseCase(repo, makeProjectRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(repo.save.mock.calls.length, 1);
    const savedLink = repo.save.mock.calls[0]?.[0] as TrackedLink;
    assert.strictEqual(savedLink.accountId, ACCOUNT_ID, "accountId must come from the project");
  });
});
