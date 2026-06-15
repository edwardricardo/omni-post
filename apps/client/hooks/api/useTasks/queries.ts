/**
 * @file queries.ts
 * @description Read-only hooks for task management.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchTask, fetchTasks } from "./api";

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
