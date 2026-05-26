/**
 * @file Task.ts
 * @description Domain entity representing a task assignment within an account.
 *   Tasks can be assigned to team members, linked to posts and projects,
 *   and follow a status lifecycle: OPEN -> IN_PROGRESS -> COMPLETED | CANCELLED.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";

/**
 * Task status values matching Prisma TaskStatus enum.
 */
export const TASK_STATUS = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type TaskStatusValue = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

/**
 * Task priority values matching Prisma TaskPriority enum.
 */
export const TASK_PRIORITY = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;

export type TaskPriorityValue = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];

/**
 * Properties that fully describe a Task entity.
 */
export interface TaskProps {
  readonly id: string;
  readonly accountId: string;
  readonly projectId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatusValue;
  readonly priority: TaskPriorityValue;
  readonly assigneeId: string | null;
  readonly createdById: string;
  readonly dueDate: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly postId: string | null;
}

/**
 * Input required to create a new Task.
 */
export interface CreateTaskInput {
  accountId: string;
  projectId?: string;
  title: string;
  description?: string;
  assigneeId?: string;
  createdById: string;
  dueDate?: Date;
  priority?: TaskPriorityValue;
  postId?: string;
}

/**
 * Input for updating mutable task fields.
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  assigneeId?: string;
  dueDate?: Date;
  priority?: TaskPriorityValue;
}

const MAX_TITLE_LENGTH = 200;

/**
 * @class Task
 * @description Domain entity for task assignments. Enforces status lifecycle
 *   invariants and field validations via the Result pattern.
 */
export class Task {
  private props: TaskProps;

  private constructor(props: TaskProps) {
    this.props = props;
  }

  // --- Getters ---

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get projectId(): string | null {
    return this.props.projectId;
  }
  get title(): string {
    return this.props.title;
  }
  get description(): string | null {
    return this.props.description;
  }
  get status(): TaskStatusValue {
    return this.props.status;
  }
  get priority(): TaskPriorityValue {
    return this.props.priority;
  }
  get assigneeId(): string | null {
    return this.props.assigneeId;
  }
  get createdById(): string {
    return this.props.createdById;
  }
  get dueDate(): Date | null {
    return this.props.dueDate;
  }
  get completedAt(): Date | null {
    return this.props.completedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }
  get postId(): string | null {
    return this.props.postId;
  }

  // --- Factory ---

  /**
   * @method create
   * @description Creates a new Task entity with validation.
   * @param input - Creation parameters
   * @returns Result with the new entity on success, Error on validation failure
   */
  static create(input: CreateTaskInput): Result<Task, Error> {
    const titleTrimmed = input.title.trim();

    if (!titleTrimmed) {
      return err(new Error("Task title cannot be empty"));
    }
    if (titleTrimmed.length > MAX_TITLE_LENGTH) {
      return err(new Error(`Task title cannot exceed ${MAX_TITLE_LENGTH} characters`));
    }
    if (input.dueDate) {
      const now = new Date();
      // Allow same-minute granularity: compare dates truncated to minute
      const dueDateMinute = new Date(input.dueDate);
      dueDateMinute.setSeconds(0, 0);
      const nowMinute = new Date(now);
      nowMinute.setSeconds(0, 0);
      if (dueDateMinute.getTime() < nowMinute.getTime()) {
        return err(new Error("Due date cannot be in the past"));
      }
    }

    const now = new Date();
    return ok(
      new Task({
        id: crypto.randomUUID(),
        accountId: input.accountId,
        projectId: input.projectId ?? null,
        title: titleTrimmed,
        description: input.description?.trim() ?? null,
        status: TASK_STATUS.OPEN,
        priority: input.priority ?? TASK_PRIORITY.MEDIUM,
        assigneeId: input.assigneeId ?? null,
        createdById: input.createdById,
        dueDate: input.dueDate ?? null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        postId: input.postId ?? null,
      })
    );
  }

  // --- Reconstitution ---

  /**
   * @method reconstitute
   * @description Rebuilds a Task entity from persisted data without validation.
   * @param props - The full property set from the database
   * @returns A Task instance
   */
  static reconstitute(props: TaskProps): Task {
    return new Task(props);
  }

  // --- Behavior ---

  /**
   * @method assign
   * @description Assigns the task to a team member and transitions to IN_PROGRESS.
   * @param assigneeId - The ID of the team member to assign
   * @returns Result<void, Error>
   */
  assign(assigneeId: string): Result<void, Error> {
    if (!assigneeId.trim()) {
      return err(new Error("Assignee ID cannot be empty"));
    }
    this.props = {
      ...this.props,
      assigneeId,
      status: TASK_STATUS.IN_PROGRESS,
      updatedAt: new Date(),
    };
    return ok(undefined);
  }

  /**
   * @method complete
   * @description Marks the task as completed. Cannot complete a cancelled task.
   * @returns Result<void, Error>
   */
  complete(): Result<void, Error> {
    if (this.props.status === TASK_STATUS.CANCELLED) {
      return err(new Error("Cannot complete a cancelled task"));
    }
    const now = new Date();
    this.props = {
      ...this.props,
      status: TASK_STATUS.COMPLETED,
      completedAt: now,
      updatedAt: now,
    };
    return ok(undefined);
  }

  /**
   * @method cancel
   * @description Marks the task as cancelled. Cannot cancel a completed task.
   * @returns Result<void, Error>
   */
  cancel(): Result<void, Error> {
    if (this.props.status === TASK_STATUS.COMPLETED) {
      return err(new Error("Cannot cancel a completed task"));
    }
    this.props = {
      ...this.props,
      status: TASK_STATUS.CANCELLED,
      updatedAt: new Date(),
    };
    return ok(undefined);
  }

  /**
   * @method updatePriority
   * @description Updates the task priority.
   * @param priority - The new priority value
   * @returns Result<void, Error>
   */
  updatePriority(priority: TaskPriorityValue): Result<void, Error> {
    this.props = {
      ...this.props,
      priority,
      updatedAt: new Date(),
    };
    return ok(undefined);
  }

  /**
   * @method update
   * @description Updates mutable task fields (title, description, dueDate, priority, assigneeId).
   * @param data - Fields to update
   * @returns Result<void, Error>
   */
  update(data: UpdateTaskInput): Result<void, Error> {
    if (data.title !== undefined) {
      const titleTrimmed = data.title.trim();
      if (!titleTrimmed) {
        return err(new Error("Task title cannot be empty"));
      }
      if (titleTrimmed.length > MAX_TITLE_LENGTH) {
        return err(new Error(`Task title cannot exceed ${MAX_TITLE_LENGTH} characters`));
      }
      this.props = { ...this.props, title: titleTrimmed };
    }

    if (data.description !== undefined) {
      this.props = { ...this.props, description: data.description.trim() || null };
    }

    if (data.assigneeId !== undefined) {
      this.props = { ...this.props, assigneeId: data.assigneeId || null };
    }

    if (data.dueDate !== undefined) {
      this.props = { ...this.props, dueDate: data.dueDate };
    }

    if (data.priority !== undefined) {
      this.props = { ...this.props, priority: data.priority };
    }

    this.props = { ...this.props, updatedAt: new Date() };
    return ok(undefined);
  }

  /**
   * @method softDelete
   * @description Marks this task as deleted without physical removal.
   */
  softDelete(): void {
    const now = new Date();
    this.props = { ...this.props, deletedAt: now, updatedAt: now };
  }

  /**
   * @method toJSON
   * @description Serialises the entity to a plain object.
   */
  toJSON(): TaskProps {
    return { ...this.props };
  }
}
