/**
 * @file PrismaThreadReadRepository.ts
 * @description Prisma adapter implementing ThreadReadRepositoryPort (read-side).
 *              Receives PrismaClient via constructor injection. Returns flat domain DTOs.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { ThreadReadRepositoryPort } from "../../domain/repositories/ThreadReadRepository.js";
import type {
  ThreadWithRelations,
  ThreadWithTweets,
} from "../../domain/repositories/ReadModelDtos.js";

/**
 * Eager-include shape for thread reads that need the parent post + project.
 * Tweets are always ordered by sequenceNumber ascending.
 */
const THREAD_WITH_RELATIONS_INCLUDE = {
  post: {
    include: {
      project: true,
    },
  },
  tweets: {
    orderBy: { sequenceNumber: "asc" },
  },
} as const;

/**
 * Eager-include shape for thread reads that need only the tweets.
 */
const THREAD_WITH_TWEETS_INCLUDE = {
  tweets: {
    orderBy: { sequenceNumber: "asc" },
  },
} as const;

/**
 * PrismaThreadReadRepository
 *
 * Read-only Prisma adapter that returns flat domain DTOs. Receives PrismaClient
 * via constructor injection (DI-friendly).
 *
 * @example
 * const repo = new PrismaThreadReadRepository(prisma);
 * const thread = await repo.getById("thread-123");
 */
export class PrismaThreadReadRepository implements ThreadReadRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Return a single thread with its post, project, and ordered tweets, or null.
   */
  async getById(threadId: string): Promise<ThreadWithRelations | null> {
    const row = await this.prisma.thread.findUnique({
      where: { id: threadId },
      include: THREAD_WITH_RELATIONS_INCLUDE,
    });
    // Prisma enum values are identical string literals at runtime — safe cast.
    return row ? (row as unknown as ThreadWithRelations) : null;
  }

  /**
   * Return multiple threads (with post, project, ordered tweets) in one query.
   */
  async getByIds(threadIds: string[]): Promise<ThreadWithRelations[]> {
    const rows = await this.prisma.thread.findMany({
      where: { id: { in: threadIds } },
      include: THREAD_WITH_RELATIONS_INCLUDE,
    });
    return rows as unknown as ThreadWithRelations[];
  }

  /**
   * Return threads created within [start, end) for a project, ordered by
   * createdAt desc, with post, project, and ordered tweets.
   */
  async getByProjectIdAndTimeframe(
    projectId: string,
    start: Date,
    end: Date
  ): Promise<ThreadWithRelations[]> {
    const rows = await this.prisma.thread.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        post: { projectId },
      },
      include: THREAD_WITH_RELATIONS_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows as unknown as ThreadWithRelations[];
  }

  /**
   * Return threads created within [start, end) for an account (across all of
   * its projects), ordered by createdAt desc, with post, project, and tweets.
   */
  async getByAccountIdAndTimeframe(
    accountId: string,
    start: Date,
    end: Date
  ): Promise<ThreadWithRelations[]> {
    const rows = await this.prisma.thread.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        post: { project: { accountId } },
      },
      include: THREAD_WITH_RELATIONS_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows as unknown as ThreadWithRelations[];
  }

  /**
   * Return all threads for a project with their ordered tweets (no post join).
   */
  async getByProjectId(projectId: string): Promise<ThreadWithTweets[]> {
    const rows = await this.prisma.thread.findMany({
      where: { post: { projectId } },
      include: THREAD_WITH_TWEETS_INCLUDE,
    });
    return rows as unknown as ThreadWithTweets[];
  }

  /**
   * Return all threads for an account with their ordered tweets (no post join).
   */
  async getByAccountId(accountId: string): Promise<ThreadWithTweets[]> {
    const rows = await this.prisma.thread.findMany({
      where: { post: { project: { accountId } } },
      include: THREAD_WITH_TWEETS_INCLUDE,
    });
    return rows as unknown as ThreadWithTweets[];
  }

  /**
   * Count all threads belonging to a project.
   */
  async countByProjectId(projectId: string): Promise<number> {
    return this.prisma.thread.count({
      where: { post: { projectId } },
    });
  }
}
