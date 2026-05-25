/**
 * @file ThreadReadRepository.ts
 * @description Repository port for flat DTO-based thread reads — provides thread
 *              metrics, engagement-trend, and strategy-comparison queries for the
 *              thread analytics service. Returns Prisma-free DTOs.
 * @layer domain
 */

import type { ThreadWithRelations, ThreadWithTweets } from "./ReadModelDtos.js";

/**
 * ThreadReadRepositoryPort — read-only flat-DTO access to thread data.
 *
 * This port must NOT use domain entities or Prisma types — it returns plain
 * DTOs so that the thread analytics service can consume them directly without
 * value-object overhead. Threads are always eagerly joined with their ordered
 * tweets (and, for the timeframe/by-id variants, their parent post + project).
 */
export interface ThreadReadRepositoryPort {
  /**
   * Return a single thread with its post, project, and ordered tweets, or null
   * if the thread does not exist.
   */
  getById(threadId: string): Promise<ThreadWithRelations | null>;

  /**
   * Return multiple threads (with post, project, and ordered tweets) for a set
   * of thread IDs in a single query. N+1-safe — replaces per-thread lookups.
   */
  getByIds(threadIds: string[]): Promise<ThreadWithRelations[]>;

  /**
   * Return threads created within [start, end) for a project, with post,
   * project, and ordered tweets, ordered by createdAt desc.
   */
  getByProjectIdAndTimeframe(
    projectId: string,
    start: Date,
    end: Date
  ): Promise<ThreadWithRelations[]>;

  /**
   * Return threads created within [start, end) for an account (across all of
   * its projects), with post, project, and ordered tweets, ordered by
   * createdAt desc.
   */
  getByAccountIdAndTimeframe(
    accountId: string,
    start: Date,
    end: Date
  ): Promise<ThreadWithRelations[]>;

  /**
   * Return all threads for a project with their tweets (no post/project join).
   * Used by strategy comparison which only needs strategy + tweet status.
   */
  getByProjectId(projectId: string): Promise<ThreadWithTweets[]>;

  /**
   * Return all threads for an account (across all of its projects) with their
   * tweets (no post/project join). Used by strategy comparison.
   */
  getByAccountId(accountId: string): Promise<ThreadWithTweets[]>;

  /**
   * Count all threads belonging to a project.
   */
  countByProjectId(projectId: string): Promise<number>;
}
