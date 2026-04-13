/**
 * @file useTasks.ts
 * @description TanStack Query hooks for task management CRUD operations.
 * @layer client-hooks
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskDto {
  id: string;
  accountId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assigneeId: string | null;
  createdById: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  postId: string | null;
}

export interface CreateTaskInput {
  accountId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate?: string;
  postId?: string;
  createdById: string;
}

export interface UpdateTaskInput {
  accountId: string;
  title?: string;
  description?: string;
  assigneeId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchTasks(params: {
  accountId: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  limit?: number;
  offset?: number;
}): Promise<TaskDto[]> {
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
  const data = (await res.json()) as { ok: boolean; value?: TaskDto[] };
  return data.ok && data.value ? data.value : [];
}

async function fetchTask(taskId: string, accountId: string): Promise<TaskDto> {
  const res = await fetch(`/api/backend/tasks/${taskId}?accountId=${accountId}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch task");
  const data = (await res.json()) as { ok: boolean; value?: TaskDto };
  if (!data.ok || !data.value) throw new Error("Task not found");
  return data.value;
}

async function createTask(input: CreateTaskInput): Promise<{ id: string }> {
  const res = await fetch("/api/backend/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create task");
  const data = (await res.json()) as { ok: boolean; value?: { id: string } };
  if (!data.ok || !data.value) throw new Error("Create task failed");
  return data.value;
}

async function updateTask(taskId: string, input: UpdateTaskInput): Promise<void> {
  const res = await fetch(`/api/backend/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to update task");
}

async function completeTask(
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

async function cancelTask(taskId: string, accountId: string, cancelledById: string): Promise<void> {
  const res = await fetch(`/api/backend/tasks/${taskId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ accountId, cancelledById }),
  });
  if (!res.ok) throw new Error("Failed to cancel task");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * @hook useTasks
 * @description Fetches tasks for an account with optional status, priority, and assignee filters.
 * @param params - Filter options: accountId (required), status, priority, assigneeId
 * @returns TanStack Query result with task array
 */
export function useTasks(params: {
  accountId: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
}) {
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: () => fetchTasks(params),
    staleTime: 30_000,
    enabled: !!params.accountId,
  });
}

/**
 * @hook useTask
 * @description Fetches a single task by ID.
 * @param taskId - The task to fetch
 * @param accountId - The account the task belongs to
 * @returns TanStack Query result with task data
 */
export function useTask(taskId: string, accountId: string) {
  return useQuery({
    queryKey: ["tasks", taskId],
    queryFn: () => fetchTask(taskId, accountId),
    staleTime: 30_000,
    enabled: !!taskId && !!accountId,
  });
}

/**
 * @hook useCreateTask
 * @description Mutation hook for creating a new task.
 * @returns TanStack Query mutation that invalidates the tasks list on success
 */
export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/**
 * @hook useUpdateTask
 * @description Mutation hook for updating an existing task.
 * @returns TanStack Query mutation that invalidates the tasks list on success
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...input }: UpdateTaskInput & { taskId: string }) =>
      updateTask(taskId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/**
 * @hook useCompleteTask
 * @description Mutation hook for marking a task as completed.
 * @returns TanStack Query mutation that invalidates the tasks list on success
 */
export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      accountId,
      completedById,
    }: {
      taskId: string;
      accountId: string;
      completedById: string;
    }) => completeTask(taskId, accountId, completedById),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/**
 * @hook useCancelTask
 * @description Mutation hook for cancelling a task.
 * @returns TanStack Query mutation that invalidates the tasks list on success
 */
export function useCancelTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      accountId,
      cancelledById,
    }: {
      taskId: string;
      accountId: string;
      cancelledById: string;
    }) => cancelTask(taskId, accountId, cancelledById),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
