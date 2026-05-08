/**
 * @file entities.task.test.ts
 * @description Unit tests for Task domain entity covering creation,
 *   status transitions, validation, and serialisation.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  Task,
  TASK_STATUS,
  TASK_PRIORITY,
  type CreateTaskInput,
  type TaskProps,
} from "../../../src/domain/entities/Task.js";

function makeInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    accountId: "account-001",
    title: "Review social media campaign",
    createdById: "member-001",
    ...overrides,
  };
}

function makeTask(overrides: Partial<CreateTaskInput> = {}): Task {
  const result = Task.create(makeInput(overrides));
  assert.ok(result.ok, "Task creation should succeed");
  return result.value;
}

function makeReconstituted(overrides: Partial<TaskProps> = {}): Task {
  return Task.reconstitute({
    id: "task-001",
    accountId: "account-001",
    projectId: null,
    title: "Review social media campaign",
    description: null,
    status: TASK_STATUS.OPEN,
    priority: TASK_PRIORITY.MEDIUM,
    assigneeId: null,
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

describe("Task entity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates with valid data and OPEN status", () => {
      const result = Task.create(makeInput());
      assert.ok(result.ok);
      assert.equal(result.value.status, TASK_STATUS.OPEN);
      assert.equal(result.value.title, "Review social media campaign");
      assert.equal(result.value.priority, TASK_PRIORITY.MEDIUM);
      assert.equal(result.value.assigneeId, null);
      assert.equal(result.value.completedAt, null);
    });

    it("generates a unique ID", () => {
      const r1 = Task.create(makeInput());
      const r2 = Task.create(makeInput());
      assert.ok(r1.ok);
      assert.ok(r2.ok);
      assert.notEqual(r1.value.id, r2.value.id);
    });

    it("trims title whitespace", () => {
      const result = Task.create(makeInput({ title: "  Trimmed title  " }));
      assert.ok(result.ok);
      assert.equal(result.value.title, "Trimmed title");
    });

    it("rejects empty title", () => {
      const result = Task.create(makeInput({ title: "" }));
      assert.ok(!result.ok);
      assert.ok(result.error.message.includes("empty"));
    });

    it("rejects whitespace-only title", () => {
      const result = Task.create(makeInput({ title: "   " }));
      assert.ok(!result.ok);
      assert.ok(result.error.message.includes("empty"));
    });

    it("rejects title exceeding 200 characters", () => {
      const longTitle = "a".repeat(201);
      const result = Task.create(makeInput({ title: longTitle }));
      assert.ok(!result.ok);
      assert.ok(result.error.message.includes("200"));
    });

    it("accepts title of exactly 200 characters", () => {
      const title = "a".repeat(200);
      const result = Task.create(makeInput({ title }));
      assert.ok(result.ok);
      assert.equal(result.value.title, title);
    });

    it("rejects due date in the past", () => {
      const pastDate = new Date("2020-01-01T00:00:00Z");
      const result = Task.create(makeInput({ dueDate: pastDate }));
      assert.ok(!result.ok);
      assert.ok(result.error.message.includes("past"));
    });

    it("accepts future due date", () => {
      const futureDate = new Date(Date.now() + 86_400_000);
      const result = Task.create(makeInput({ dueDate: futureDate }));
      assert.ok(result.ok);
      assert.deepEqual(result.value.dueDate, futureDate);
    });

    it("applies provided priority", () => {
      const result = Task.create(makeInput({ priority: TASK_PRIORITY.URGENT }));
      assert.ok(result.ok);
      assert.equal(result.value.priority, TASK_PRIORITY.URGENT);
    });

    it("sets optional fields when provided", () => {
      const result = Task.create(
        makeInput({
          projectId: "proj-001",
          description: "Detailed description",
          assigneeId: "member-002",
          postId: "post-001",
        })
      );
      assert.ok(result.ok);
      assert.equal(result.value.projectId, "proj-001");
      assert.equal(result.value.description, "Detailed description");
      assert.equal(result.value.assigneeId, "member-002");
      assert.equal(result.value.postId, "post-001");
    });

    it("sets null for optional fields when not provided", () => {
      const result = Task.create(makeInput());
      assert.ok(result.ok);
      assert.equal(result.value.projectId, null);
      assert.equal(result.value.description, null);
      assert.equal(result.value.postId, null);
    });
  });

  describe("reconstitute", () => {
    it("rebuilds entity from persisted data", () => {
      const task = makeReconstituted();
      assert.equal(task.id, "task-001");
      assert.equal(task.accountId, "account-001");
      assert.equal(task.status, TASK_STATUS.OPEN);
    });
  });

  describe("assign", () => {
    it("sets assignee and transitions to IN_PROGRESS", () => {
      const task = makeTask();
      const result = task.assign("member-002");
      assert.ok(result.ok);
      assert.equal(task.assigneeId, "member-002");
      assert.equal(task.status, TASK_STATUS.IN_PROGRESS);
    });

    it("rejects empty assignee ID", () => {
      const task = makeTask();
      const result = task.assign("");
      assert.ok(!result.ok);
      assert.ok(result.error.message.includes("empty"));
    });

    it("rejects whitespace-only assignee ID", () => {
      const task = makeTask();
      const result = task.assign("   ");
      assert.ok(!result.ok);
    });
  });

  describe("complete", () => {
    it("sets status to COMPLETED and records completedAt", () => {
      const task = makeTask();
      const result = task.complete();
      assert.ok(result.ok);
      assert.equal(task.status, TASK_STATUS.COMPLETED);
      assert.ok(task.completedAt instanceof Date);
    });

    it("can complete an IN_PROGRESS task", () => {
      const task = makeReconstituted({ status: TASK_STATUS.IN_PROGRESS });
      const result = task.complete();
      assert.ok(result.ok);
      assert.equal(task.status, TASK_STATUS.COMPLETED);
    });

    it("fails when task is CANCELLED", () => {
      const task = makeReconstituted({ status: TASK_STATUS.CANCELLED });
      const result = task.complete();
      assert.ok(!result.ok);
      assert.ok(result.error.message.includes("cancelled"));
    });
  });

  describe("cancel", () => {
    it("sets status to CANCELLED", () => {
      const task = makeTask();
      const result = task.cancel();
      assert.ok(result.ok);
      assert.equal(task.status, TASK_STATUS.CANCELLED);
    });

    it("can cancel an IN_PROGRESS task", () => {
      const task = makeReconstituted({ status: TASK_STATUS.IN_PROGRESS });
      const result = task.cancel();
      assert.ok(result.ok);
      assert.equal(task.status, TASK_STATUS.CANCELLED);
    });

    it("fails when task is COMPLETED", () => {
      const task = makeReconstituted({ status: TASK_STATUS.COMPLETED });
      const result = task.cancel();
      assert.ok(!result.ok);
      assert.ok(result.error.message.includes("completed"));
    });
  });

  describe("updatePriority", () => {
    it("updates priority value", () => {
      const task = makeTask();
      const result = task.updatePriority(TASK_PRIORITY.HIGH);
      assert.ok(result.ok);
      assert.equal(task.priority, TASK_PRIORITY.HIGH);
    });

    it("updates updatedAt timestamp", () => {
      const task = makeReconstituted();
      const before = task.updatedAt;
      task.updatePriority(TASK_PRIORITY.LOW);
      assert.ok(task.updatedAt.getTime() >= before.getTime());
    });
  });

  describe("update", () => {
    it("updates title", () => {
      const task = makeTask();
      const result = task.update({ title: "New title" });
      assert.ok(result.ok);
      assert.equal(task.title, "New title");
    });

    it("rejects empty title in update", () => {
      const task = makeTask();
      const result = task.update({ title: "" });
      assert.ok(!result.ok);
    });

    it("rejects title over 200 chars in update", () => {
      const task = makeTask();
      const result = task.update({ title: "x".repeat(201) });
      assert.ok(!result.ok);
    });

    it("updates description", () => {
      const task = makeTask();
      const result = task.update({ description: "New description" });
      assert.ok(result.ok);
      assert.equal(task.description, "New description");
    });

    it("clears description to null when empty", () => {
      const task = makeTask();
      task.update({ description: "Something" });
      const result = task.update({ description: "" });
      assert.ok(result.ok);
      assert.equal(task.description, null);
    });

    it("updates assigneeId", () => {
      const task = makeTask();
      const result = task.update({ assigneeId: "member-002" });
      assert.ok(result.ok);
      assert.equal(task.assigneeId, "member-002");
    });

    it("clears assigneeId when empty string", () => {
      const task = makeTask();
      task.update({ assigneeId: "member-002" });
      const result = task.update({ assigneeId: "" });
      assert.ok(result.ok);
      assert.equal(task.assigneeId, null);
    });

    it("updates dueDate", () => {
      const futureDate = new Date(Date.now() + 86_400_000);
      const task = makeTask();
      const result = task.update({ dueDate: futureDate });
      assert.ok(result.ok);
      assert.deepEqual(task.dueDate, futureDate);
    });

    it("updates priority", () => {
      const task = makeTask();
      const result = task.update({ priority: TASK_PRIORITY.URGENT });
      assert.ok(result.ok);
      assert.equal(task.priority, TASK_PRIORITY.URGENT);
    });

    it("updates multiple fields at once", () => {
      const task = makeTask();
      const result = task.update({
        title: "Updated",
        priority: TASK_PRIORITY.HIGH,
      });
      assert.ok(result.ok);
      assert.equal(task.title, "Updated");
      assert.equal(task.priority, TASK_PRIORITY.HIGH);
    });
  });

  describe("softDelete", () => {
    it("sets deletedAt timestamp", () => {
      const task = makeTask();
      assert.equal(task.deletedAt, null);
      task.softDelete();
      assert.ok(task.deletedAt instanceof Date);
    });

    it("updates updatedAt", () => {
      const task = makeReconstituted();
      const before = task.updatedAt;
      task.softDelete();
      assert.ok(task.updatedAt.getTime() >= before.getTime());
    });
  });

  describe("toJSON", () => {
    it("returns plain object with all properties", () => {
      const task = makeTask();
      const json = task.toJSON();
      assert.equal(json.id, task.id);
      assert.equal(json.accountId, "account-001");
      assert.equal(json.title, "Review social media campaign");
      assert.equal(json.status, TASK_STATUS.OPEN);
      assert.equal(json.priority, TASK_PRIORITY.MEDIUM);
      assert.equal(json.createdById, "member-001");
      assert.ok(json.createdAt instanceof Date);
      assert.ok(json.updatedAt instanceof Date);
    });

    it("returns a copy (not a reference to internal state)", () => {
      const task = makeTask();
      const json1 = task.toJSON();
      const json2 = task.toJSON();
      assert.notEqual(json1, json2);
      assert.deepEqual(json1, json2);
    });
  });
});
