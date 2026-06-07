/**
 * @file EnterCrisisModeUseCase.test.ts
 * @description Unit tests for EnterCrisisModeUseCase — validates project ID format,
 *   project existence, crisis mode activation, and conflict on already-active crisis.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { EnterCrisisModeUseCase } from "../../src/EnterCrisisModeUseCase.js";

const VALID_PROJECT_ID = "550e8400-e29b-41d4-a716-446655440001";

const makeProject = (isInCrisisMode = false) => ({
  id: { value: VALID_PROJECT_ID },
  isInCrisisMode,
  crisisStartedAt: isInCrisisMode ? new Date("2024-01-01T00:00:00Z") : undefined,
  domainEvents: [],
  enterCrisisMode: vi.fn().mockReturnValue(!isInCrisisMode),
  exitCrisisMode: vi.fn(),
  clearDomainEvents: vi.fn(),
});

const makeProjectRepo = (project = makeProject()) => ({
  findById: vi.fn().mockResolvedValue(ok(project)),
  save: vi.fn().mockResolvedValue(ok(undefined)),
});

const makeEventDispatcher = () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
  dispatchAll: vi.fn().mockResolvedValue(undefined),
});

describe("EnterCrisisModeUseCase", () => {
  let projectRepo: ReturnType<typeof makeProjectRepo>;
  let eventDispatcher: ReturnType<typeof makeEventDispatcher>;
  let useCase: EnterCrisisModeUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    projectRepo = makeProjectRepo();
    eventDispatcher = makeEventDispatcher();
    useCase = new EnterCrisisModeUseCase(projectRepo, eventDispatcher);
  });

  it("returns ok with crisis output when project enters crisis mode", async () => {
    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      reason: "Critical security incident",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.projectId, VALID_PROJECT_ID);
    assert.strictEqual(result.value.isInCrisisMode, true);
    assert.strictEqual(result.value.reason, "Critical security incident");
  });

  it("returns VALIDATION_FAILED when projectId is not a valid UUID", async () => {
    const result = await useCase.execute({
      projectId: "not-a-uuid",
      reason: "incident",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns NOT_FOUND when project does not exist", async () => {
    projectRepo.findById.mockResolvedValue(err(new Error("Project not found")));
    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      reason: "incident",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "NOT_FOUND");
  });

  it("returns CONFLICT when project is already in crisis mode", async () => {
    const alreadyInCrisis = makeProject(true);
    alreadyInCrisis.enterCrisisMode.mockReturnValue(false);
    projectRepo = makeProjectRepo(alreadyInCrisis);
    useCase = new EnterCrisisModeUseCase(projectRepo, eventDispatcher);

    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      reason: "duplicate incident",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "CONFLICT");
  });
});
