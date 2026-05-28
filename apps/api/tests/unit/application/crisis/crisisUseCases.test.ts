/**
 * Application Layer - Crisis Mode Use Cases Tests
 *
 * Tests for EnterCrisisMode, ExitCrisisMode, and GetCrisisStatus use cases.
 *
 * @file crisisUseCases.test.ts
 * @description Tests for EnterCrisisModeUseCase
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { ok, err } from "@shared/types";
import { Project, AccountId, ProjectId, EntityNotFoundError } from "@core/domain/index.js";
import {
  EnterCrisisModeUseCase,
  ExitCrisisModeUseCase,
  GetCrisisStatusUseCase,
  type EnterCrisisModeInput,
  type ExitCrisisModeInput,
  type GetCrisisStatusInput,
} from "@core/crisis/index.js";

// Mock factories using test context
function createMockProjectRepository() {
  return {
    findById: vi.fn(async () => err(new EntityNotFoundError("Project", "test"))),
    save: vi.fn(async () => ok(undefined)),
  };
}

function createMockEventDispatcher() {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async () => {}),
  };
}

describe("EnterCrisisModeUseCase", () => {
  let useCase: EnterCrisisModeUseCase;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;
  let mockEventDispatcher: ReturnType<typeof createMockEventDispatcher>;

  beforeEach(() => {
    mockProjectRepo = createMockProjectRepository();
    mockEventDispatcher = createMockEventDispatcher();
    useCase = new EnterCrisisModeUseCase(mockProjectRepo, mockEventDispatcher);
  });

  it("should enter crisis mode successfully", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    expect(projectResult.ok).toBeTruthy();
    const project = projectResult.value;

    mockProjectRepo.findById.mockImplementation(async () => ok(project));

    const input: EnterCrisisModeInput = {
      projectId: project.id.value,
      reason: "PR crisis - negative viral content",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isInCrisisMode).toBe(true);
      expect(result.value.reason).toBe(input.reason);
      expect(result.value.startedAt).toBeTruthy();
    }
    expect(mockProjectRepo.save.mock.calls.length).toBe(1);
    expect(mockEventDispatcher.dispatchAll.mock.calls.length).toBe(1);
  });

  it("should fail if already in crisis mode", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    expect(projectResult.ok).toBeTruthy();
    const project = projectResult.value;
    project.enterCrisisMode("Previous crisis");

    mockProjectRepo.findById.mockImplementation(async () => ok(project));

    const input: EnterCrisisModeInput = {
      projectId: project.id.value,
      reason: "New crisis",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeFalsy();
  });

  it("should fail with invalid project ID", async () => {
    const input: EnterCrisisModeInput = {
      projectId: "invalid-id",
      reason: "Test crisis",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeFalsy();
  });

  it("should fail when project not found", async () => {
    const input: EnterCrisisModeInput = {
      projectId: ProjectId.generate().value,
      reason: "Test crisis",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeFalsy();
  });
});

describe("ExitCrisisModeUseCase", () => {
  let useCase: ExitCrisisModeUseCase;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;
  let mockEventDispatcher: ReturnType<typeof createMockEventDispatcher>;

  beforeEach(() => {
    mockProjectRepo = createMockProjectRepository();
    mockEventDispatcher = createMockEventDispatcher();
    useCase = new ExitCrisisModeUseCase(mockProjectRepo, mockEventDispatcher);
  });

  it("should exit crisis mode successfully", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    expect(projectResult.ok).toBeTruthy();
    const project = projectResult.value;
    project.enterCrisisMode("Test crisis");
    project.clearDomainEvents(); // Clear enter event

    mockProjectRepo.findById.mockImplementation(async () => ok(project));

    const input: ExitCrisisModeInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isInCrisisMode).toBe(false);
      expect(result.value.duration >= 0).toBeTruthy(); // Duration can be 0 if enter/exit happens quickly
    }
    expect(mockProjectRepo.save.mock.calls.length).toBe(1);
    expect(mockEventDispatcher.dispatchAll.mock.calls.length).toBe(1);
  });

  it("should fail if not in crisis mode", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    expect(projectResult.ok).toBeTruthy();
    const project = projectResult.value;

    mockProjectRepo.findById.mockImplementation(async () => ok(project));

    const input: ExitCrisisModeInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeFalsy();
  });
});

describe("GetCrisisStatusUseCase", () => {
  let useCase: GetCrisisStatusUseCase;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;

  beforeEach(() => {
    mockProjectRepo = createMockProjectRepository();
    useCase = new GetCrisisStatusUseCase(mockProjectRepo);
  });

  it("should return crisis status when in crisis mode", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    expect(projectResult.ok).toBeTruthy();
    const project = projectResult.value;
    project.enterCrisisMode("Active crisis");

    mockProjectRepo.findById.mockImplementation(async () => ok(project));

    const input: GetCrisisStatusInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isInCrisisMode).toBe(true);
      expect(result.value.reason).toBe("Active crisis");
      expect(result.value.startedAt).toBeTruthy();
    }
  });

  it("should return not in crisis when project is normal", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    expect(projectResult.ok).toBeTruthy();
    const project = projectResult.value;

    mockProjectRepo.findById.mockImplementation(async () => ok(project));

    const input: GetCrisisStatusInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isInCrisisMode).toBe(false);
      expect(result.value.reason).toBe(undefined);
    }
  });

  it("should include crisis history", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    expect(projectResult.ok).toBeTruthy();
    const project = projectResult.value;
    project.enterCrisisMode("First crisis");
    project.exitCrisisMode();
    project.enterCrisisMode("Second crisis");

    mockProjectRepo.findById.mockImplementation(async () => ok(project));

    const input: GetCrisisStatusInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.history.length).toBe(2);
    }
  });
});
