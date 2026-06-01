/**
 * @file PrismaProjectRepository.ts
 * @description Prisma adapter implementing ProjectRepositoryPort (write-side).
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  Project,
  ProjectId,
  AccountId,
  ChannelId,
  PostId,
  EntityNotFoundError,
} from "@core/domain/index.js";
import type { ContentLocale } from "@core/domain/value-objects/Content.js";
import type {
  ProjectRepositoryPort,
  PublishLogView,
} from "@core/domain/repositories/ProjectRepository.js";
import type { CrisisModeEntry } from "@core/domain/entities/Project.js";

/**
 * Minimal Prisma project row shape used by the mapper
 */
interface PrismaProjectRow {
  id: string;
  accountId: string;
  name: string;
  locale: string;
  isInCrisisMode: boolean;
  crisisStartedAt: Date | null;
  crisisReason: string | null;
  crisisModeHistory: unknown;
  createdAt: Date;
  updatedAt: Date;
  channels?: { id: string }[];
  posts?: { id: string }[];
}

/**
 * Maps a Prisma Project row to the Project domain entity
 */
function toDomain(row: PrismaProjectRow): Project {
  const id = ProjectId.fromStringUnsafe(row.id);
  const accountId = AccountId.fromStringUnsafe(row.accountId);
  const channelIds = (row.channels ?? []).map((c) => ChannelId.fromStringUnsafe(c.id));
  const postIds = (row.posts ?? []).map((p) => PostId.fromStringUnsafe(p.id));

  let crisisModeHistory: CrisisModeEntry[] = [];
  if (Array.isArray(row.crisisModeHistory)) {
    crisisModeHistory = (
      row.crisisModeHistory as Array<{
        reason: string;
        startedAt: string;
        endedAt?: string;
      }>
    ).map((entry) => ({
      reason: entry.reason,
      startedAt: new Date(entry.startedAt),
      ...(entry.endedAt !== undefined && { endedAt: new Date(entry.endedAt) }),
    }));
  }

  return Project.reconstitute(id, {
    accountId,
    name: row.name,
    locale: row.locale as ContentLocale,
    channelIds,
    postIds,
    isInCrisisMode: row.isInCrisisMode,
    ...(row.crisisStartedAt !== null && { crisisStartedAt: row.crisisStartedAt }),
    ...(row.crisisReason !== null && { crisisReason: row.crisisReason }),
    crisisModeHistory,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * PrismaProjectRepository - Implements ProjectRepositoryPort using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture - it implements
 * the repository PORT defined in the domain layer.
 *
 * @example
 * const repo = new PrismaProjectRepository(prisma);
 * const result = await repo.findById(ProjectId.fromString("..."));
 */
export class PrismaProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find a project by its ID (excludes soft-deleted projects)
   */
  async findById(id: ProjectId): Promise<Result<Project, EntityNotFoundError>> {
    const row = await this.prisma.project.findFirst({
      where: { id: id.value, deletedAt: null },
      include: {
        channels: { select: { id: true } },
        posts: { select: { id: true } },
      },
    });

    if (!row) {
      return err(new EntityNotFoundError("Project", id.value));
    }

    return ok(toDomain(row));
  }

  /**
   * Find all projects belonging to an account (excludes soft-deleted projects)
   */
  async findByAccountId(accountId: AccountId): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
      where: { accountId: accountId.value, deletedAt: null },
      include: {
        channels: { select: { id: true } },
        posts: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toDomain);
  }

  /**
   * Save a project (create or update via upsert)
   */
  async save(project: Project): Promise<Result<void, Error>> {
    try {
      const crisisModeHistory = project.crisisModeHistory.map((entry) => ({
        reason: entry.reason,
        startedAt: entry.startedAt.toISOString(),
        ...(entry.endedAt !== undefined && { endedAt: entry.endedAt.toISOString() }),
      }));

      await this.prisma.project.upsert({
        where: { id: project.id.value },
        create: {
          id: project.id.value,
          accountId: project.accountId.value,
          name: project.name,
          locale: project.locale,
          isInCrisisMode: project.isInCrisisMode,
          crisisStartedAt: project.crisisStartedAt ?? null,
          crisisReason: project.crisisReason ?? null,
          crisisModeHistory,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
        update: {
          name: project.name,
          locale: project.locale,
          isInCrisisMode: project.isInCrisisMode,
          crisisStartedAt: project.crisisStartedAt ?? null,
          crisisReason: project.crisisReason ?? null,
          crisisModeHistory,
          updatedAt: project.updatedAt,
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Soft-delete a project (sets deletedAt = now).
   * The project becomes invisible to all standard find queries.
   * Child data (posts, channels) remains intact for audit purposes.
   */
  async delete(id: ProjectId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.exists(id);
    if (!exists) {
      return err(new EntityNotFoundError("Project", id.value));
    }

    await this.prisma.project.update({
      where: { id: id.value },
      data: { deletedAt: new Date() },
    });
    return ok(undefined);
  }

  /**
   * Hard-delete a project and all related data in the correct cascade order.
   * SUPER_ADMIN only — irreversible.
   *
   * Infrastructure-layer responsibility: manages FK constraint ordering so
   * callers do not need to know the database topology.
   */
  async hardDelete(id: ProjectId): Promise<Result<void, EntityNotFoundError>> {
    // Use findFirst to detect the project even if it was soft-deleted
    const project = await this.prisma.project.findFirst({
      where: { id: id.value },
      select: { id: true },
    });
    if (!project) {
      return err(new EntityNotFoundError("Project", id.value));
    }

    const projectId = id.value;

    // Collect post IDs first for tweet/thread deletion
    const posts = await this.prisma.post.findMany({
      where: { projectId },
      select: { id: true },
    });
    const postIds = posts.map((p) => p.id);

    // 1. PublishLogs (references posts + channels)
    await this.prisma.publishLog.deleteMany({ where: { post: { projectId } } });
    // 2. Analytics (references posts + channels)
    await this.prisma.analytics.deleteMany({ where: { post: { projectId } } });
    // 3. PostMedia
    await this.prisma.postMedia.deleteMany({ where: { post: { projectId } } });
    // 4. PostContent
    await this.prisma.postContent.deleteMany({ where: { post: { projectId } } });
    // 5. ContentVersions
    await this.prisma.contentVersion.deleteMany({ where: { post: { projectId } } });
    // 6. Tweets → Threads
    if (postIds.length > 0) {
      await this.prisma.tweet.deleteMany({ where: { thread: { postId: { in: postIds } } } });
      await this.prisma.thread.deleteMany({ where: { postId: { in: postIds } } });
    }
    // 7. Posts
    await this.prisma.post.deleteMany({ where: { projectId } });
    // 8. Channels
    await this.prisma.channel.deleteMany({ where: { projectId } });
    // 9. Other project-level records
    await this.prisma.contentTemplate.deleteMany({ where: { projectId } });
    await this.prisma.instagramStoryProject.deleteMany({ where: { projectId } });
    await this.prisma.videoProcessingJob.deleteMany({ where: { projectId } });
    await this.prisma.instagramAnalytics.deleteMany({ where: { projectId } });
    await this.prisma.schedulingRule.deleteMany({ where: { projectId } });
    await this.prisma.webhookEvent.deleteMany({ where: { projectId } });
    await this.prisma.webhookSubscription.deleteMany({ where: { projectId } });
    await this.prisma.template.deleteMany({ where: { projectId } });
    // 10. Project itself
    await this.prisma.project.delete({ where: { id: projectId } });

    return ok(undefined);
  }

  /**
   * Check whether an active (non-deleted) project with the given ID exists
   */
  async exists(id: ProjectId): Promise<boolean> {
    const count = await this.prisma.project.count({
      where: { id: id.value, deletedAt: null },
    });
    return count > 0;
  }

  /**
   * Find a project by account ID and name (for duplicate name validation).
   * Only considers active (non-deleted) projects.
   * Returns null when no matching project is found.
   */
  async findByName(accountId: AccountId, name: string): Promise<Project | null> {
    const row = await this.prisma.project.findFirst({
      where: { accountId: accountId.value, name, deletedAt: null },
      include: {
        channels: { select: { id: true } },
        posts: { select: { id: true } },
      },
    });
    return row ? toDomain(row) : null;
  }

  /**
   * Return the publish history for all posts in a project.
   * Limited to the 100 most recent entries, ordered by creation date descending.
   */
  async findPublishLogsByProjectId(id: ProjectId): Promise<PublishLogView[]> {
    const logs = await this.prisma.publishLog.findMany({
      where: { post: { projectId: id.value } },
      include: {
        channel: { select: { id: true, handle: true, provider: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return logs
      .filter((log) => log.postId !== null)
      .map((log) => ({
        id: log.id,
        postId: log.postId as string,
        channelId: log.channelId,
        status: log.status,
        provider: log.provider,
        channel: {
          id: log.channel.id,
          name: log.channel.handle,
          provider: log.channel.provider,
        },
        createdAt: log.createdAt,
      }));
  }
}
