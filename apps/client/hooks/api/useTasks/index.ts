/**
 * @file index.ts
 * @description Barrel export for the tasks hook module — preserves the
 *              public import path `@/hooks/api/useTasks` after the file split.
 * @layer infrastructure
 */

export type {
  CreateTaskInput,
  ListTasksParams,
  TaskDto,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from "./types.js";

export { useTask, useTasks } from "./queries.js";

export { useCancelTask, useCompleteTask, useCreateTask, useUpdateTask } from "./mutations.js";
