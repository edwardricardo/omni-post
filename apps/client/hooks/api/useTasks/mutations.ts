/**
 * @file mutations.ts
 * @description Mutation hooks for task management — create, update, complete,
 *              and cancel.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelTask, completeTask, createTask, updateTask } from "./api";
import type { UpdateTaskInput } from "./types";

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
