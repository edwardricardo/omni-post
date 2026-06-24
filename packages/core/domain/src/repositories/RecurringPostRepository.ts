/**
 * @file RecurringPostRepository.ts
 * @description Port interface for RecurringPost persistence.
 *   Defines the contract for storing, retrieving, and querying
 *   recurring post schedules used to auto-create posts on a cron basis.
 * @layer domain
 */
import type { Result } from "@shared/types";
import type { DomainError } from "../errors/index.js";
import type { AccountId } from "../value-objects/EntityId.js";

/**
 * @interface RecurringPostData
 * @description Plain data transfer object representing a recurring post schedule.
 *   Used across layer boundaries without exposing domain internals.
 */
export interface RecurringPostData {
  id: string;
  projectId: string;
  templatePostId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  startDate: Date;
  endDate?: Date;
  maxOccurrences?: number;
  occurrenceCount: number;
  isActive: boolean;
  lastScheduledAt?: Date;
  nextScheduledAt?: Date;
  channels: string[];
  contentVariation: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @interface RecurringPostRepository
 * @description Repository port for RecurringPost aggregate persistence.
 *   Returns domain-level data, never raw Prisma types.
 */
export interface RecurringPostRepository {
  /**
   * @method save
   * @description Persists a recurring post (create or update via upsert on id).
   */
  save(post: RecurringPostData): Promise<Result<RecurringPostData, DomainError>>;

  /**
   * @method findById
   * @description Finds a recurring post by its unique identifier.
   */
  findById(id: string): Promise<Result<RecurringPostData, DomainError>>;

  /**
   * @method findByProjectId
   * @description Finds all recurring posts belonging to a project.
   *
   * When `callerAccountId` is provided, a `project: { accountId }` joined filter
   * is applied (CWE-639): RecurringPost is transitively tenant-scoped via
   * Project, so the `$extends` guard cannot auto-inject. A foreign `projectId`
   * returns an empty list rather than another tenant's schedules.
   */
  findByProjectId(
    projectId: string,
    callerAccountId?: AccountId
  ): Promise<Result<RecurringPostData[], DomainError>>;

  /**
   * @method findOwnerAccountId
   * @description Resolves the owning tenant of a recurring post via the
   *   `recurringPost -> project -> accountId` chain. Returns `null` when the
   *   schedule does not exist. Used by the use-case-level cross-tenant ownership
   *   gate (CWE-639) — a non-owner is rejected with NOT_FOUND (anti-enumeration).
   */
  findOwnerAccountId(id: string): Promise<AccountId | null>;

  /**
   * @method findActiveByNextScheduled
   * @description Finds active recurring posts whose nextScheduledAt is before the given date.
   */
  findActiveByNextScheduled(before: Date): Promise<Result<RecurringPostData[], DomainError>>;

  /**
   * @method delete
   * @description Removes a recurring post by its unique identifier.
   */
  delete(id: string): Promise<Result<void, DomainError>>;
}
