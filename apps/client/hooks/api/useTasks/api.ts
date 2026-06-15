/**
 * @file api.ts
 * @description Internal fetch helpers for task endpoints.
 * @layer infrastructure
 */

import type { CreateTaskInput, ListTasksParams, TaskDto, UpdateTaskInput } from "./types";

export async function fetchTasks(params: ListTasksParams): Promise<TaskDto[]> {
  const searchParams = new URLSearchParams();
  searchParams.set("accountId", params.accountId);
  if (params.status) searchParams.set("status", params.status);
  if (params.priority) searchParams.set("priority", params.priority);
  if (params.assigneeId) searchParams.set("assigneeId", params.assigneeId);
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  const res = await fetch(`/api/backend/tasks?${searchParams.toString()}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch tasks");
  const body = (await res.json()) as { ok: boolean; data?: TaskDto[] };
  return body.ok && body.data ? body.data : [];
}

export async function fetchTask(taskId: string, accountId: string): Promise<TaskDto> {
  const res = await fetch(`/api/backend/tasks/${taskId}?accountId=${accountId}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch task");
  const body = (await res.json()) as { ok: boolean; data?: TaskDto };
  if (!body.ok || !body.data) throw new Error("Task not found");
  return body.data;
}

export async function createTask(input: CreateTaskInput): Promise<{ id: string }> {
  const res = await fetch("/api/backend/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create task");
  const body = (await res.json()) as { ok: boolean; data?: { id: string } };
  if (!body.ok || !body.data) throw new Error("Create task failed");
  return body.data;
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<void> {
  const res = await fetch(`/api/backend/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to update task");
}

export async function completeTask(
  taskId: string,
  accountId: string,
  completedById: string
): Promise<void> {
  const res = await fetch(`/api/backend/tasks/${taskId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ accountId, completedById }),
  });
  if (!res.ok) throw new Error("Failed to complete task");
}

export async function cancelTask(
  taskId: string,
  accountId: string,
  cancelledById: string
): Promise<void> {
  const res = await fetch(`/api/backend/tasks/${taskId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ accountId, cancelledById }),
  });
  if (!res.ok) throw new Error("Failed to cancel task");
}
