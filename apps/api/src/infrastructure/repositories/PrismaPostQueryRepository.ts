/**
 * @file PrismaPostQueryRepository.ts
 * @description Prisma adapter implementing PostQueryRepository (CQRS read-side).
 *              Receives PrismaClient via constructor injection. Queries flat data
 *              directly without aggregate reconstitution.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  PostQueryRepository,
  PostReadModel,
  PostReadModelWithThread,
  ThreadReadModel,
  GlobalPostFilter,
  PostFilterCriteria,
  PostSortField,
  PaginationParams,
  PaginatedResult,
  SortParams,
} from "@core/domain/index.js";
import { PostId, ProjectId } from "@core/domain/index.js";
import { EntityNotFoundError } from "@core/domain/index.js";
import type { PublishStatusValue } from "@core/domain/value-objects/PublishStatus.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Minimal shape of a Prisma post row as returned by the queries in this file.
 * Using an explicit interface avoids relying on `any` while keeping the mapper
 * decoupled from generated Prisma types.
 */
interface PostQueryRow {
  id: string;
  projectId: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contents: Array<{
    title: string | null;
    summary: string | null;
    body: string;
    locale: string;
    tags: string[];
  }>;
  _count: {
    media: number;
  };
}

/**
 * Minimal shape of a Prisma thread row with nested tweets.
 */
interface ThreadQueryRow {
  id: string;
  postId: string;
  strategy: string;
  createdAt: Date;
  updatedAt: Date;
  tweets: Array<{
    id: string;
    threadId: string;
    sequenceNumber: number;
    content: string;
    media: unknown;
    tweetId: string | null;
    parentTweetId: string | null;
    status: string;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

/**
 * PrismaPostQueryRepository — Read-optimized CQRS query adapter.
 *
 * Always filters `deletedAt: null` for soft-delete awareness.
 * Uses `include` with `{ take: 1 }` on contents instead of loading full aggregates.
 * Returns flat PostReadModel DTOs — zero domain object construction overhead.
 *
 * @example
 * const repo = new PrismaPostQueryRepository(prisma);
 * const result = await repo.getById(PostId.fromStringUnsafe("..."));
 */
export class PrismaPostQueryRepository implements PostQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get a post read model by ID.
   * Returns EntityNotFoundError when the post does not exist or is soft-deleted.
   */
  async getById(id: PostId): Promise<Result<PostReadModel, EntityNotFoundError>> {
    const post = await this.prisma.post.findFirst({
      where: { id: id.value, deletedAt: null },
      include: {
        contents: { take: 1 },
        _count: { select: { media: true } },
      },
    });

    if (!post) {
      return err(new EntityNotFoundError("Post", id.value));
    }

    return ok(this.toReadModel(post as PostQueryRow));
  }

  /**
   * List posts for a project with optional pagination, sorting, and filters.
   * Defaults: page 1, limit 20, ordered by createdAt descending.
   *
   * Filter semantics:
   * - `status`: single value or array (uses Prisma `in` for arrays).
   * - Date ranges (`scheduledBefore`/`scheduledAfter`, `createdBefore`/`createdAfter`):
   *   inclusive bounds (`gte`/`lte`).
   * - `hasMedia`: `true` → at least one PostMedia, `false` → none.
   * - `tags` + `searchText`: both apply through `contents.some` filter; combined
   *   with AND semantics (a single content row must match all conditions).
   *
   * The filter's own `projectId` is ignored — the explicit `projectId` arg is
   * authoritative for scope (prevents cross-project leakage).
   */
  async listByProject(
    projectId: ProjectId,
    pagination?: PaginationParams,
    sort?: SortParams<PostSortField>,
    filter?: PostFilterCriteria
  ): Promise<PaginatedResult<PostReadModel>> {
    const page = pagination?.page ?? DEFAULT_PAGE;
    const limit = Math.min(pagination?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where = this.buildWhereClause(projectId, filter);
    const orderBy = sort ? { [sort.field]: sort.direction } : { createdAt: "desc" as const };

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          contents: { take: 1 },
          _count: { select: { media: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: (posts as PostQueryRow[]).map((p) => this.toReadModel(p)),
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  }

  /**
   * Build a Prisma `where` clause from a project scope and optional filter.
   * Always pins `projectId` and `deletedAt: null`. Filters `archivedAt: null`
   * by default unless `filter.includeArchived === true` (explicit Archive view).
   */
  private buildWhereClause(
    projectId: ProjectId,
    filter?: PostFilterCriteria
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {
      projectId: projectId.value,
      deletedAt: null,
    };

    if (!filter?.includeArchived) {
      where["archivedAt"] = null;
    }

    if (!filter) return where;

    if (filter.status !== undefined) {
      where["status"] = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
    }

    if (filter.scheduledBefore || filter.scheduledAfter) {
      const range: { gte?: Date; lte?: Date } = {};
      if (filter.scheduledAfter) range.gte = filter.scheduledAfter;
      if (filter.scheduledBefore) range.lte = filter.scheduledBefore;
      where["scheduledAt"] = range;
    }

    if (filter.createdBefore || filter.createdAfter) {
      const range: { gte?: Date; lte?: Date } = {};
      if (filter.createdAfter) range.gte = filter.createdAfter;
      if (filter.createdBefore) range.lte = filter.createdBefore;
      where["createdAt"] = range;
    }

    if (filter.hasMedia === true) {
      where["media"] = { some: {} };
    } else if (filter.hasMedia === false) {
      where["media"] = { none: {} };
    }

    const contentConditions: Record<string, unknown> = {};
    if (filter.tags && filter.tags.length > 0) {
      contentConditions["tags"] = { hasSome: filter.tags };
    }
    if (filter.searchText) {
      contentConditions["OR"] = [
        { title: { contains: filter.searchText, mode: "insensitive" } },
        { body: { contains: filter.searchText, mode: "insensitive" } },
      ];
    }
    if (Object.keys(contentConditions).length > 0) {
      where["contents"] = { some: contentConditions };
    }

    return where;
  }

  /**
   * Search posts by text within a project.
   * Performs case-insensitive contains match on PostContent title and body fields.
   */
  async search(
    projectId: ProjectId,
    searchText: string,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<PostReadModel>> {
    const page = pagination?.page ?? DEFAULT_PAGE;
    const limit = Math.min(pagination?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where = {
      projectId: projectId.value,
      deletedAt: null,
      contents: {
        some: {
          OR: [
            { title: { contains: searchText, mode: "insensitive" as const } },
            { body: { contains: searchText, mode: "insensitive" as const } },
          ],
        },
      },
    };

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          contents: { take: 1 },
          _count: { select: { media: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: (posts as PostQueryRow[]).map((p) => this.toReadModel(p)),
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  }

  /**
   * Get upcoming scheduled posts for a project ordered by scheduledAt ascending.
   * Returns only posts with status SCHEDULED and scheduledAt in the future.
   */
  async getUpcoming(projectId: ProjectId, limit = 10): Promise<PostReadModel[]> {
    const posts = await this.prisma.post.findMany({
      where: {
        projectId: projectId.value,
        deletedAt: null,
        status: "SCHEDULED",
        scheduledAt: { gte: new Date() },
      },
      include: {
        contents: { take: 1 },
        _count: { select: { media: true } },
      },
      orderBy: { scheduledAt: "asc" },
      take: Math.min(limit, MAX_LIMIT),
    });

    return (posts as PostQueryRow[]).map((p) => this.toReadModel(p));
  }

  /**
   * Get recently published posts for a project ordered by publishedAt descending.
   * Returns only posts with status PUBLISHED and a non-null publishedAt.
   */
  async getRecentlyPublished(projectId: ProjectId, limit = 10): Promise<PostReadModel[]> {
    const posts = await this.prisma.post.findMany({
      where: {
        projectId: projectId.value,
        deletedAt: null,
        status: "PUBLISHED",
        publishedAt: { not: null },
      },
      include: {
        contents: { take: 1 },
        _count: { select: { media: true } },
      },
      orderBy: { publishedAt: "desc" },
      take: Math.min(limit, MAX_LIMIT),
    });

    return (posts as PostQueryRow[]).map((p) => this.toReadModel(p));
  }

  /**
   * Get a post by ID enriched with thread data (tweets ordered by sequence).
   * Returns the standard PostReadModel plus an optional `thread` property.
   */
  async getByIdWithThread(
    id: PostId
  ): Promise<Result<PostReadModelWithThread, EntityNotFoundError>> {
    const post = await this.prisma.post.findFirst({
      where: { id: id.value, deletedAt: null },
      include: {
        contents: { take: 1 },
        _count: { select: { media: true } },
        thread: {
          include: {
            tweets: { orderBy: { sequenceNumber: "asc" } },
          },
        },
      },
    });

    if (!post) {
      return err(new EntityNotFoundError("Post", id.value));
    }

    const readModel = this.toReadModel(post as PostQueryRow);

    const threadData = (post as PostQueryRow & { thread?: ThreadQueryRow }).thread;
    if (threadData) {
      const thread: ThreadReadModel = {
        id: threadData.id,
        postId: threadData.postId,
        strategy: threadData.strategy,
        createdAt: threadData.createdAt,
        updatedAt: threadData.updatedAt,
        tweets: threadData.tweets.map((t) => ({
          id: t.id,
          threadId: t.threadId,
          sequenceNumber: t.sequenceNumber,
          content: t.content,
          media: t.media,
          tweetId: t.tweetId ?? null,
          parentTweetId: t.parentTweetId ?? null,
          status: t.status,
          publishedAt: t.publishedAt ?? null,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      };
      return ok({ ...readModel, thread });
    }

    return ok(readModel);
  }

  /**
   * List posts globally (across all projects) with optional status filter.
   * Defaults: page 1, limit 20, ordered by createdAt descending.
   */
  async listGlobal(
    filter?: GlobalPostFilter,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<PostReadModel>> {
    const page = pagination?.page ?? DEFAULT_PAGE;
    const limit = Math.min(pagination?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (filter?.status) {
      where["status"] = filter.status;
    }

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          contents: { take: 1 },
          _count: { select: { media: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: (posts as PostQueryRow[]).map((p) => this.toReadModel(p)),
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  }

  /**
   * Map a Prisma post row to a flat PostReadModel DTO.
   * Uses the first content record for title, body, locale, and tags.
   * Optional fields (title, scheduledAt, publishedAt) are conditionally spread
   * to comply with exactOptionalPropertyTypes: true.
   */
  private toReadModel(post: PostQueryRow): PostReadModel {
    const content = post.contents[0];
    return {
      id: post.id,
      projectId: post.projectId,
      ...(content?.title ? { title: content.title } : {}),
      ...(content?.summary ? { summary: content.summary } : {}),
      body: content?.body ?? "",
      status: post.status as PublishStatusValue,
      locale: content?.locale ?? "en",
      tags: content?.tags ?? [],
      mediaCount: post._count?.media ?? 0,
      ...(post.scheduledAt ? { scheduledAt: post.scheduledAt } : {}),
      ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }
}
