/**
 * @file types.ts
 * @description Public types for the task management hook module.
 * @layer infrastructure
 */

export type TaskStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface TaskDto {
  id: string;
  accountId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
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
  priority?: TaskPriority;
  dueDate?: string;
  postId?: string;
  createdById: string;
}

export interface UpdateTaskInput {
  accountId: string;
  title?: string;
  description?: string;
  assigneeId?: string;
  priority?: TaskPriority;
  dueDate?: string;
}

export interface ListTasksParams {
  accountId: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  limit?: number;
  offset?: number;
}
