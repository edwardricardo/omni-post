/**
 * @file taskUseCases.test.ts
 * @description Unit tests for Task use cases: create, complete, cancel, list.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { Task, TASK_STATUS, TASK_PRIORITY } from "@core/domain/entities/Task.js";
import { CreateTaskUseCase } from "@core/application/tasks/CreateTaskUseCase.js";
import { CompleteTaskUseCase } from "@core/application/tasks/CompleteTaskUseCase.js";
import { CancelTaskUseCase } from "@core/application/tasks/CancelTaskUseCase.js";
import { ListTasksQuery } from "@core/application/tasks/ListTasksQuery.js";
import type { TaskRepository } from "@core/domain/repositories/TaskRepository.js";

// ============================================================================
// Mock Factories
// ============================================================================

function makeTask(overrides: Record<string, unknown> = {}): Task {
  return Task.reconstitute({
    id: "task-001",
    accountId: "account-001",
    projectId: null,
    title: "Test task",
    description: null,
    status: TASK_STATUS.OPEN,
    priority: TASK_PRIORITY.MEDIUM,
    assigneeId: "member-002",
    createdById: "member-001",
    dueDate: null,
    completedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    postId: null,
    ...overrides,
  });
}

function createMockTaskRepository(): TaskRepository {
  return {
    findById: vi.fn(),
    findByAccountId: vi.fn(),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    softDelete: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

// ============================================================================
// CreateTaskUseCase
// ============================================================================

describe("CreateTaskUseCase", () => {
  let useCase: CreateTaskUseCase;
  let mockRepo: TaskRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockTaskRepository();
    useCase = new CreateTaskUseCase(mockRepo);
  });

  it("creates a task with valid input", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      title: "New task",
      createdById: "member-001",
    });

    assert.ok(result.ok);
    assert.ok(result.value.id);
    expect(mockRepo.save).toHaveBeenCalledOnce();
  });

  it("returns validation error for empty title", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      title: "",
      createdById: "member-001",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it("returns validation error for title exceeding 200 characters", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      title: "a".repeat(201),
      createdById: "member-001",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns error when repository save fails", async () => {
    vi.mocked(mockRepo.save).mockResolvedValueOnce(err(new Error("DB failure")));

    const result = await useCase.execute({
      accountId: "account-001",
      title: "New task",
      createdById: "member-001",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });

  it("passes optional fields to the entity", async () => {
    const result = await useCase.execute({
      accountId: "account-001",
      title: "New task",
      createdById: "member-001",
      projectId: "proj-001",
      description: "Some description",
      assigneeId: "member-002",
      priority: TASK_PRIORITY.HIGH,
      postId: "post-001",
    });

    assert.ok(result.ok);
    const savedTask = vi.mocked(mockRepo.save).mock.calls[0]?.[0];
    assert.ok(savedTask);
    assert.equal(savedTask.projectId, "proj-001");
    assert.equal(savedTask.description, "Some description");
    assert.equal(savedTask.assigneeId, "member-002");
    assert.equal(savedTask.priority, TASK_PRIORITY.HIGH);
    assert.equal(savedTask.postId, "post-001");
  });
});

// ============================================================================
// CompleteTaskUseCase
// ============================================================================

describe("CompleteTaskUseCase", () => {
  let useCase: CompleteTaskUseCase;
  let mockRepo: TaskRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockTaskRepository();
    useCase = new CompleteTaskUseCase(mockRepo);
  });

  it("completes when called by assignee", async () => {
    const task = makeTask({ assigneeId: "member-002" });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      completedById: "member-002",
    });

    assert.ok(result.ok);
    assert.equal(task.status, TASK_STATUS.COMPLETED);
    expect(mockRepo.save).toHaveBeenCalledOnce();
  });

  it("completes when called by creator", async () => {
    const task = makeTask({ createdById: "member-001", assigneeId: "member-002" });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      completedById: "member-001",
    });

    assert.ok(result.ok);
    assert.equal(task.status, TASK_STATUS.COMPLETED);
  });

  it("rejects completion by unrelated user", async () => {
    const task = makeTask({
      createdById: "member-001",
      assigneeId: "member-002",
    });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      completedById: "member-999",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "FORBIDDEN");
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it("rejects when task belongs to different account", async () => {
    const task = makeTask({ accountId: "other-account" });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      completedById: "member-001",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "NOT_FOUND");
  });

  it("rejects completing a cancelled task", async () => {
    const task = makeTask({ status: TASK_STATUS.CANCELLED });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      completedById: "member-002",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns NOT_FOUND when task does not exist", async () => {
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(err(new Error("Task not found: task-999")));

    const result = await useCase.execute({
      taskId: "task-999",
      accountId: "account-001",
      completedById: "member-001",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "NOT_FOUND");
  });
});

// ============================================================================
// CancelTaskUseCase
// ============================================================================

describe("CancelTaskUseCase", () => {
  let useCase: CancelTaskUseCase;
  let mockRepo: TaskRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockTaskRepository();
    useCase = new CancelTaskUseCase(mockRepo);
  });

  it("cancels when called by creator", async () => {
    const task = makeTask({ createdById: "member-001" });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      cancelledById: "member-001",
    });

    assert.ok(result.ok);
    assert.equal(task.status, TASK_STATUS.CANCELLED);
    expect(mockRepo.save).toHaveBeenCalledOnce();
  });

  it("rejects cancellation by non-creator", async () => {
    const task = makeTask({ createdById: "member-001" });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      cancelledById: "member-002",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "FORBIDDEN");
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it("rejects cancelling a completed task", async () => {
    const task = makeTask({
      status: TASK_STATUS.COMPLETED,
      createdById: "member-001",
    });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      cancelledById: "member-001",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("rejects when task belongs to different account", async () => {
    const task = makeTask({ accountId: "other-account", createdById: "member-001" });
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(ok(task));

    const result = await useCase.execute({
      taskId: "task-001",
      accountId: "account-001",
      cancelledById: "member-001",
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "NOT_FOUND");
  });
});

// ============================================================================
// ListTasksQuery
// ============================================================================

describe("ListTasksQuery", () => {
  let query: ListTasksQuery;
  let mockRepo: TaskRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockTaskRepository();
    query = new ListTasksQuery(mockRepo);
  });

  it("returns all tasks for an account", async () => {
    const tasks = [makeTask(), makeTask({ id: "task-002", title: "Second task" })];
    vi.mocked(mockRepo.findByAccountId).mockResolvedValueOnce(tasks);

    const result = await query.execute({ accountId: "account-001" });

    assert.ok(result.ok);
    assert.equal(result.value.length, 2);
    expect(mockRepo.findByAccountId).toHaveBeenCalledWith("account-001", {});
  });

  it("passes status filter to repository", async () => {
    vi.mocked(mockRepo.findByAccountId).mockResolvedValueOnce([]);

    await query.execute({
      accountId: "account-001",
      status: TASK_STATUS.IN_PROGRESS,
    });

    expect(mockRepo.findByAccountId).toHaveBeenCalledWith(
      "account-001",
      expect.objectContaining({ status: TASK_STATUS.IN_PROGRESS })
    );
  });

  it("passes assignee filter to repository", async () => {
    vi.mocked(mockRepo.findByAccountId).mockResolvedValueOnce([]);

    await query.execute({
      accountId: "account-001",
      assigneeId: "member-002",
    });

    expect(mockRepo.findByAccountId).toHaveBeenCalledWith(
      "account-001",
      expect.objectContaining({ assigneeId: "member-002" })
    );
  });

  it("clamps limit to maximum of 100", async () => {
    vi.mocked(mockRepo.findByAccountId).mockResolvedValueOnce([]);

    await query.execute({
      accountId: "account-001",
      limit: 500,
    });

    expect(mockRepo.findByAccountId).toHaveBeenCalledWith(
      "account-001",
      expect.objectContaining({ limit: 100 })
    );
  });

  it("passes priority filter to repository", async () => {
    vi.mocked(mockRepo.findByAccountId).mockResolvedValueOnce([]);

    await query.execute({
      accountId: "account-001",
      priority: TASK_PRIORITY.URGENT,
    });

    expect(mockRepo.findByAccountId).toHaveBeenCalledWith(
      "account-001",
      expect.objectContaining({ priority: TASK_PRIORITY.URGENT })
    );
  });

  it("returns DTOs via toJSON", async () => {
    const task = makeTask();
    vi.mocked(mockRepo.findByAccountId).mockResolvedValueOnce([task]);

    const result = await query.execute({ accountId: "account-001" });

    assert.ok(result.ok);
    assert.equal(result.value.length, 1);
    const dto = result.value[0];
    assert.ok(dto);
    assert.equal(dto.id, task.id);
    assert.equal(dto.title, task.title);
    assert.equal(dto.status, task.status);
  });
});
