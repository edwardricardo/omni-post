/**
 * @file ApprovalWorkflow.ts
 * @description Domain entity representing a multi-level approval workflow.
 *   Defines the ordered levels that content must pass through before publication.
 *   Validates structural invariants: non-empty name, 1-10 levels, sequential ordering.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError, InvariantViolationError } from "../errors/index.js";

/**
 * Represents a single level within an approval workflow
 */
export interface WorkflowLevel {
  readonly id: string;
  readonly order: number;
  readonly role?: string;
  readonly assigneeId?: string;
  readonly requireAll: boolean;
}

/**
 * Input for creating a new workflow level (no id required)
 */
export interface WorkflowLevelInput {
  readonly order: number;
  readonly role?: string;
  readonly assigneeId?: string;
  readonly requireAll?: boolean;
}

/**
 * Input for creating a new approval workflow
 */
export interface CreateApprovalWorkflowInput {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  levels: WorkflowLevel[];
  isDefault?: boolean;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * @class ApprovalWorkflow
 * @description Domain entity for multi-level approval workflows.
 *   Each workflow defines an ordered sequence of approval levels that
 *   content must pass through. Levels can optionally specify a required
 *   role, a specific assignee, and whether all approvers at the level
 *   must approve (requireAll) or just one suffices.
 */
export class ApprovalWorkflow {
  private constructor(
    private readonly _id: string,
    private readonly _accountId: string,
    private readonly _name: string,
    private readonly _description: string | undefined,
    private readonly _levels: WorkflowLevel[],
    private readonly _isDefault: boolean,
    private readonly _isActive: boolean,
    private readonly _createdAt: Date,
    private readonly _updatedAt: Date
  ) {}

  // --- Getters ---

  get id(): string {
    return this._id;
  }

  get accountId(): string {
    return this._accountId;
  }

  get name(): string {
    return this._name;
  }

  get description(): string | undefined {
    return this._description;
  }

  get levels(): readonly WorkflowLevel[] {
    return [...this._levels];
  }

  get isDefault(): boolean {
    return this._isDefault;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // --- Factory ---

  /**
   * @method create
   * @description Creates a new ApprovalWorkflow after validating all invariants.
   * @param input - Creation parameters including levels
   * @returns Result containing the workflow on success, domain error on failure
   */
  static create(
    input: CreateApprovalWorkflowInput
  ): Result<ApprovalWorkflow, InvalidValueError | InvariantViolationError> {
    // Validate name
    if (!input.name || input.name.trim().length === 0) {
      return err(new InvalidValueError("name", input.name, "Workflow name is required"));
    }

    if (input.name.trim().length > 200) {
      return err(
        new InvalidValueError("name", input.name, "Workflow name must not exceed 200 characters")
      );
    }

    // Validate levels count
    if (!input.levels || input.levels.length === 0) {
      return err(new InvariantViolationError("Workflow must have at least 1 level"));
    }

    if (input.levels.length > 10) {
      return err(new InvariantViolationError("Workflow must not have more than 10 levels"));
    }

    // Validate sequential orders starting at 1
    const sortedLevels = [...input.levels].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sortedLevels.length; i++) {
      const level = sortedLevels[i];
      if (!level) {
        return err(new InvariantViolationError("Invalid level at index " + String(i)));
      }
      if (level.order !== i + 1) {
        return err(
          new InvariantViolationError(
            `Level orders must be sequential starting at 1. Expected order ${String(i + 1)} but got ${String(level.order)}`
          )
        );
      }
    }

    // Validate accountId
    if (!input.accountId || input.accountId.trim().length === 0) {
      return err(new InvalidValueError("accountId", input.accountId, "Account ID is required"));
    }

    const now = new Date();

    return ok(
      new ApprovalWorkflow(
        input.id,
        input.accountId,
        input.name.trim(),
        input.description !== undefined ? input.description : undefined,
        sortedLevels,
        input.isDefault ?? false,
        input.isActive ?? true,
        input.createdAt ?? now,
        input.updatedAt ?? now
      )
    );
  }

  // --- Behavior ---

  /**
   * @method isComplete
   * @description Determines whether the given level number exceeds the total levels,
   *   indicating the workflow is fully approved.
   * @param currentLevel - The current approval level (1-indexed)
   * @returns true if currentLevel is beyond the last level
   */
  isComplete(currentLevel: number): boolean {
    return currentLevel > this._levels.length;
  }

  /**
   * @method getLevel
   * @description Returns the workflow level at the given order number.
   * @param order - The 1-indexed order number
   * @returns The WorkflowLevel at that order, or undefined if out of range
   */
  getLevel(order: number): WorkflowLevel | undefined {
    return this._levels.find((l) => l.order === order);
  }

  /**
   * @method getLevelCount
   * @description Returns the total number of levels in this workflow.
   * @returns The number of levels
   */
  getLevelCount(): number {
    return this._levels.length;
  }

  /**
   * @method toJSON
   * @description Serializes the workflow to a plain object.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this._id,
      accountId: this._accountId,
      name: this._name,
      ...(this._description !== undefined && { description: this._description }),
      levels: this._levels.map((l) => ({
        id: l.id,
        order: l.order,
        ...(l.role !== undefined && { role: l.role }),
        ...(l.assigneeId !== undefined && { assigneeId: l.assigneeId }),
        requireAll: l.requireAll,
      })),
      isDefault: this._isDefault,
      isActive: this._isActive,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
