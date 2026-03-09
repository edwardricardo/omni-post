/**
 * Domain Layer - ProjectQueryRepository Port
 *
 * Part of R1-C: Read-model repositories for analytics consumers.
 * This is a FLAT DTO-based read repository (NOT the DDD entity-based
 * ProjectRepositoryPort that already exists).
 *
 * Consumers: ROICalculator, CrossPlatformAnalytics dataFetcher,
 *            PerformanceComparator.
 *
 * @module domain/repositories/ProjectQueryRepository
 */

import type {
  PostDto,
  PostContentDto,
  PostMediaDto,
  ProjectDto,
  AnalyticsDto,
} from "./ReadModelDtos.js";

/**
 * Pagination / ordering options used by several read methods.
 */
export interface ProjectQueryOptions {
  take?: number;
  skip?: number;
  /** Prisma-compatible orderBy expression */
  orderBy?: Record<string, "asc" | "desc">;
}

/**
 * Post with its localised content and media attachments.
 */
export type PostWithContent = PostDto & {
  contents: PostContentDto[];
  media: PostMediaDto[];
};

/**
 * Post with its analytics records (nested, ordered by capturedAt desc).
 */
export type PostWithAnalytics = PostDto & {
  analytics: AnalyticsDto[];
};

/**
 * Published post — same shape as PostWithContent but filtered to posts
 * that have a non-null publishedAt.
 */
export type PublishedPost = PostWithContent;

/**
 * ProjectQueryRepositoryPort — read-only flat-DTO access to project data.
 *
 * This port must NOT use domain entities (Project domain object, value
 * objects, etc.) — it returns plain DTOs so that analytics services
 * can use them directly without value-object overhead.
 */
export interface ProjectQueryRepositoryPort {
  /**
   * Return all post IDs belonging to a project.
   * Replaces the repeated post-ID-only query pattern across analytics services.
   */
  getPostIds(projectId: string): Promise<string[]>;

  /**
   * Return posts with their localised content and media for a project.
   */
  getPostsWithContent(projectId: string, options?: ProjectQueryOptions): Promise<PostWithContent[]>;

  /**
   * Return posts with their analytics records for a project.
   */
  getPostsWithAnalytics(
    projectId: string,
    options?: ProjectQueryOptions
  ): Promise<PostWithAnalytics[]>;

  /**
   * Return published posts (publishedAt IS NOT NULL) for a project.
   */
  getPublishedPosts(projectId: string, options?: ProjectQueryOptions): Promise<PublishedPost[]>;

  /**
   * Count all posts in a project.
   */
  countPosts(projectId: string): Promise<number>;

  /**
   * Return all projects belonging to an account, ordered by createdAt desc.
   */
  getByAccountId(accountId: string): Promise<ProjectDto[]>;

  /**
   * Return a single project by ID, or null if not found.
   */
  findById(projectId: string): Promise<ProjectDto | null>;
}
