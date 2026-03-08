/**
 * Application Layer - Crisis Mode Use Cases Tests
 *
 * Part of Sprint 19: Crisis Mode Feature
 * Tests for EnterCrisisMode, ExitCrisisMode, and GetCrisisStatus use cases.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import {
  Project,
  AccountId,
  ProjectId,
  EntityNotFoundError,
} from "../../../../src/domain/index.js";
import {
  EnterCrisisModeUseCase,
  ExitCrisisModeUseCase,
  GetCrisisStatusUseCase,
  type EnterCrisisModeInput,
  type ExitCrisisModeInput,
  type GetCrisisStatusInput,
} from "../../../../src/application/crisis/index.js";

// Mock factories using test context
function createMockProjectRepository(t: TestContext) {
  return {
    findById: t.mock.fn(async () => err(new EntityNotFoundError("Project", "test"))),
    save: t.mock.fn(async () => ok(undefined)),
  };
}

function createMockEventDispatcher(t: TestContext) {
  return {
    dispatch: t.mock.fn(async () => {}),
    dispatchAll: t.mock.fn(async () => {}),
  };
}

describe("EnterCrisisModeUseCase", { concurrency: 1 }, () => {
  let useCase: EnterCrisisModeUseCase;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;
  let mockEventDispatcher: ReturnType<typeof createMockEventDispatcher>;

  beforeEach((t) => {
    mockProjectRepo = createMockProjectRepository(t);
    mockEventDispatcher = createMockEventDispatcher(t);
    useCase = new EnterCrisisModeUseCase(mockProjectRepo, mockEventDispatcher);
  });

  it("should enter crisis mode successfully", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    assert.ok(projectResult.ok);
    const project = projectResult.value;

    mockProjectRepo.findById.mock.mockImplementation(async () => ok(project));

    const input: EnterCrisisModeInput = {
      projectId: project.id.value,
      reason: "PR crisis - negative viral content",
    };

    const result = await useCase.execute(input);

    assert.ok(result.ok, "Should succeed");
    if (result.ok) {
      assert.equal(result.value.isInCrisisMode, true);
      assert.equal(result.value.reason, input.reason);
      assert.ok(result.value.startedAt);
    }
    assert.equal(mockProjectRepo.save.mock.calls.length, 1);
    assert.equal(mockEventDispatcher.dispatchAll.mock.calls.length, 1);
  });

  it("should fail if already in crisis mode", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    assert.ok(projectResult.ok);
    const project = projectResult.value;
    project.enterCrisisMode("Previous crisis");

    mockProjectRepo.findById.mock.mockImplementation(async () => ok(project));

    const input: EnterCrisisModeInput = {
      projectId: project.id.value,
      reason: "New crisis",
    };

    const result = await useCase.execute(input);

    assert.ok(!result.ok, "Should fail when already in crisis mode");
  });

  it("should fail with invalid project ID", async () => {
    const input: EnterCrisisModeInput = {
      projectId: "invalid-id",
      reason: "Test crisis",
    };

    const result = await useCase.execute(input);

    assert.ok(!result.ok);
  });

  it("should fail when project not found", async () => {
    const input: EnterCrisisModeInput = {
      projectId: ProjectId.generate().value,
      reason: "Test crisis",
    };

    const result = await useCase.execute(input);

    assert.ok(!result.ok);
  });
});

describe("ExitCrisisModeUseCase", { concurrency: 1 }, () => {
  let useCase: ExitCrisisModeUseCase;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;
  let mockEventDispatcher: ReturnType<typeof createMockEventDispatcher>;

  beforeEach((t) => {
    mockProjectRepo = createMockProjectRepository(t);
    mockEventDispatcher = createMockEventDispatcher(t);
    useCase = new ExitCrisisModeUseCase(mockProjectRepo, mockEventDispatcher);
  });

  it("should exit crisis mode successfully", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    assert.ok(projectResult.ok);
    const project = projectResult.value;
    project.enterCrisisMode("Test crisis");
    project.clearDomainEvents(); // Clear enter event

    mockProjectRepo.findById.mock.mockImplementation(async () => ok(project));

    const input: ExitCrisisModeInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    assert.ok(result.ok, "Should succeed");
    if (result.ok) {
      assert.equal(result.value.isInCrisisMode, false);
      assert.ok(result.value.duration >= 0); // Duration can be 0 if enter/exit happens quickly
    }
    assert.equal(mockProjectRepo.save.mock.calls.length, 1);
    assert.equal(mockEventDispatcher.dispatchAll.mock.calls.length, 1);
  });

  it("should fail if not in crisis mode", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    assert.ok(projectResult.ok);
    const project = projectResult.value;

    mockProjectRepo.findById.mock.mockImplementation(async () => ok(project));

    const input: ExitCrisisModeInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    assert.ok(!result.ok, "Should fail when not in crisis mode");
  });
});

describe("GetCrisisStatusUseCase", { concurrency: 1 }, () => {
  let useCase: GetCrisisStatusUseCase;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;

  beforeEach((t) => {
    mockProjectRepo = createMockProjectRepository(t);
    useCase = new GetCrisisStatusUseCase(mockProjectRepo);
  });

  it("should return crisis status when in crisis mode", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    assert.ok(projectResult.ok);
    const project = projectResult.value;
    project.enterCrisisMode("Active crisis");

    mockProjectRepo.findById.mock.mockImplementation(async () => ok(project));

    const input: GetCrisisStatusInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.isInCrisisMode, true);
      assert.equal(result.value.reason, "Active crisis");
      assert.ok(result.value.startedAt);
    }
  });

  it("should return not in crisis when project is normal", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    assert.ok(projectResult.ok);
    const project = projectResult.value;

    mockProjectRepo.findById.mock.mockImplementation(async () => ok(project));

    const input: GetCrisisStatusInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.isInCrisisMode, false);
      assert.equal(result.value.reason, undefined);
    }
  });

  it("should include crisis history", async () => {
    const accountId = AccountId.generate();
    const projectResult = Project.create({
      accountId,
      name: "Test Project",
    });
    assert.ok(projectResult.ok);
    const project = projectResult.value;
    project.enterCrisisMode("First crisis");
    project.exitCrisisMode();
    project.enterCrisisMode("Second crisis");

    mockProjectRepo.findById.mock.mockImplementation(async () => ok(project));

    const input: GetCrisisStatusInput = {
      projectId: project.id.value,
    };

    const result = await useCase.execute(input);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.history.length, 2);
    }
  });
});
