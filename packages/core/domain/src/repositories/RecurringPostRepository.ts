/**
 * @file RecurringPostRepository.ts
 * @description Port interface for RecurringPost persistence.
 *   Defines the contract for storing, retrieving, and querying
 *   recurring post schedules used to auto-create posts on a cron basis.
 * @layer domain
 */
import type { Result } from "@shared/types";
import type { DomainError } from "../errors/index.js";

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
   */
  findByProjectId(projectId: string): Promise<Result<RecurringPostData[], DomainError>>;

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
