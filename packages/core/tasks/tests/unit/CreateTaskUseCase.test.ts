/**
 * @file CreateTaskUseCase.test.ts
 * @description Unit tests for CreateTaskUseCase — happy path, empty title
 *   validation, and save failure against a mocked TaskRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateTaskUseCase } from "../../src/CreateTaskUseCase.js";
import type { TaskRepository } from "@core/domain/repositories/TaskRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const ACCOUNT_ID = "acc-0000-0000-0000-tasks";
const CREATED_BY = "usr-0000-0000-0000-0001";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(saveFails = false): TaskRepository {
  return {
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok(undefined))),
    findById: vi.fn(async () => err(new Error("not found"))),
    list: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as TaskRepository;
}

const BASE_INPUT = {
  accountId: ACCOUNT_ID,
  title: "Review pull request",
  createdById: CREATED_BY,
};

describe("CreateTaskUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the new task id when input is valid", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTaskUseCase(repo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.id.length > 0);
  });

  it("returns VALIDATION_FAILED when the task title is empty", async () => {
    const repo = makeMockRepo();
    const uc = new CreateTaskUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, title: "   " });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns INTERNAL_ERROR when the repository save fails", async () => {
    const repo = makeMockRepo(true);
    const uc = new CreateTaskUseCase(repo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
