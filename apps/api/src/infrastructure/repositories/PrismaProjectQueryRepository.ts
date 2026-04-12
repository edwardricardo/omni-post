/**
 * @file PrismaProjectQueryRepository.ts
 * @description Prisma adapter implementing ProjectQueryRepositoryPort (read-side).
 *              Receives PrismaClient via constructor injection. Returns flat domain DTOs.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  ProjectQueryRepositoryPort,
  ProjectQueryOptions,
  PostWithContent,
  PostWithAnalytics,
  PublishedPost,
} from "../../domain/repositories/ProjectQueryRepository.js";
import type { ProjectDto } from "../../domain/repositories/ReadModelDtos.js";

/**
 * PrismaProjectQueryRepository
 *
 * Read-only Prisma adapter that returns flat domain DTOs.
 * Receives PrismaClient via constructor injection (DI-friendly).
 *
 * @example
 * const repo = new PrismaProjectQueryRepository(prisma);
 * const ids = await repo.getPostIds("proj-123");
 */
export class PrismaProjectQueryRepository implements ProjectQueryRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Return all post IDs belonging to a project.
   * Replaces the repeated `prisma.post.findMany({ select: { id: true } })` pattern.
   */
  async getPostIds(projectId: string): Promise<string[]> {
    const posts = await this.prisma.post.findMany({
      where: { projectId },
      select: { id: true },
    });
    return posts.map((p) => p.id);
  }

  /**
   * Return posts with their localised content and media for a project.
   */
  async getPostsWithContent(
    projectId: string,
    options: ProjectQueryOptions = {}
  ): Promise<PostWithContent[]> {
    const rows = await this.prisma.post.findMany({
      where: { projectId },
      include: {
        contents: true,
        media: true,
      },
      ...(options.take !== undefined && { take: options.take }),
      ...(options.skip !== undefined && { skip: options.skip }),
      orderBy: options.orderBy ?? { createdAt: "desc" },
    });
    // Prisma rows are structurally compatible with the domain DTOs — safe cast.
    return rows as unknown as PostWithContent[];
  }

  /**
   * Return posts with their analytics records (ordered by capturedAt desc) for a project.
   */
  async getPostsWithAnalytics(
    projectId: string,
    options: ProjectQueryOptions = {}
  ): Promise<PostWithAnalytics[]> {
    const rows = await this.prisma.post.findMany({
      where: { projectId },
      include: {
        analytics: {
          orderBy: { capturedAt: "desc" },
        },
      },
      ...(options.take !== undefined && { take: options.take }),
      ...(options.skip !== undefined && { skip: options.skip }),
      orderBy: options.orderBy ?? { createdAt: "desc" },
    });
    // Prisma enum values are identical string literals at runtime — safe cast.
    return rows as unknown as PostWithAnalytics[];
  }

  /**
   * Return published posts (publishedAt IS NOT NULL) for a project.
   */
  async getPublishedPosts(
    projectId: string,
    options: ProjectQueryOptions = {}
  ): Promise<PublishedPost[]> {
    const rows = await this.prisma.post.findMany({
      where: {
        projectId,
        publishedAt: { not: null },
      },
      include: {
        contents: true,
        media: true,
      },
      ...(options.take !== undefined && { take: options.take }),
      ...(options.skip !== undefined && { skip: options.skip }),
      orderBy: options.orderBy ?? { publishedAt: "desc" },
    });
    return rows as unknown as PublishedPost[];
  }

  /**
   * Count all posts in a project.
   */
  async countPosts(projectId: string): Promise<number> {
    return this.prisma.post.count({
      where: { projectId },
    });
  }

  /**
   * Return all projects belonging to an account, ordered by createdAt desc.
   */
  async getByAccountId(accountId: string): Promise<ProjectDto[]> {
    const rows = await this.prisma.project.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });
    // Prisma crisisModeHistory is JsonValue, compatible with domain JsonValue — safe cast.
    return rows as unknown as ProjectDto[];
  }

  /**
   * Return a single project by ID, or null if not found.
   */
  async findById(projectId: string): Promise<ProjectDto | null> {
    const row = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    return row ? (row as unknown as ProjectDto) : null;
  }
}
