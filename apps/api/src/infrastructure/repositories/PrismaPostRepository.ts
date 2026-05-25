/**
 * @file PrismaPostRepository.ts
 * @description Prisma adapter implementing PostRepository (write-side). Receives PrismaClient
 *              via constructor injection. Persists PostAggregate with outbox event writing.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  type PostRepository,
  type PostFilterCriteria,
  type PostSortField,
  type PaginationParams,
  type PaginatedResult,
  type SortParams,
  PostAggregate,
  PostId,
  ProjectId,
  AccountId,
  type PublishStatusValue,
  PUBLISH_STATUS,
  EntityNotFoundError,
  VersionConflictError,
} from "@core/domain/index.js";
import type { OutboxWriter } from "@core/domain/repositories/OutboxWriter.js";
import {
  PostAggregateMapper,
  type PrismaPostWithRelations,
} from "./mappers/PostAggregateMapper.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";

/** Local type alias for Prisma transaction client */
type TxClient = Prisma.TransactionClient;

/**
 * Default pagination settings
 */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * PrismaPostRepository - Implements PostRepository using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture - it implements
 * the repository PORT defined in the domain layer.
 */
export class PrismaPostRepository implements PostRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outboxWriter?: OutboxWriter
  ) {}

  /**
   * Find a post by ID (excludes soft-deleted posts)
   */
  async findById(id: PostId): Promise<Result<PostAggregate, EntityNotFoundError>> {
    const post = await this.prisma.post.findFirst({
      where: { id: id.value, deletedAt: null },
      include: {
        contents: true,
        media: true,
        contentVersions: {
          orderBy: { version: "desc" },
        },
      },
    });

    if (!post) {
      return err(new EntityNotFoundError("Post", id.value));
    }

    return ok(PostAggregateMapper.toDomain(post as PrismaPostWithRelations));
  }

  /**
   * Save a post aggregate (create or update)
   */
  async save(aggregate: PostAggregate): Promise<Result<void, Error>> {
    try {
      const exists = await this.exists(aggregate.id);

      if (exists) {
        await this.update(aggregate);
      } else {
        await this.create(aggregate);
      }

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Soft-delete a post (sets deletedAt = now).
   * The post becomes invisible to all standard find queries.
   * Child data (contents, media, publishLogs) remains intact for audit purposes.
   */
  async delete(id: PostId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.exists(id);

    if (!exists) {
      return err(new EntityNotFoundError("Post", id.value));
    }

    await this.prisma.post.update({
      where: { id: id.value },
      data: { deletedAt: new Date() },
    });

    return ok(undefined);
  }

  /**
   * Hard-delete a post and all its data (irreversible).
   * SUPER_ADMIN only. Cascades to contents, media, publishLogs, contentVersions.
   * Es UoW-aware: si hay una transacción activa en el contexto, la usa directamente.
   */
  async hardDelete(id: PostId): Promise<Result<void, EntityNotFoundError>> {
    // Use findFirst to detect even soft-deleted posts
    const post = await this.prisma.post.findFirst({
      where: { id: id.value },
      select: { id: true },
    });

    if (!post) {
      return err(new EntityNotFoundError("Post", id.value));
    }

    const doHardDelete = async (tx: TxClient): Promise<void> => {
      // Delete publish logs (FK constraint: publishLog.postId → post.id)
      await tx.publishLog.deleteMany({ where: { postId: id.value } });
      // Delete analytics
      await tx.analytics.deleteMany({ where: { postId: id.value } });
      // Delete content versions
      await tx.contentVersion.deleteMany({ where: { postId: id.value } });
      // Delete media
      await tx.postMedia.deleteMany({ where: { postId: id.value } });
      // Delete tweets and threads
      await tx.tweet.deleteMany({ where: { thread: { postId: id.value } } });
      await tx.thread.deleteMany({ where: { postId: id.value } });
      // Delete content
      await tx.postContent.deleteMany({ where: { postId: id.value } });
      // Delete the post
      await tx.post.delete({ where: { id: id.value } });
    };

    const activeTx = PrismaUnitOfWork.getTransactionClient();
    if (activeTx) {
      await doHardDelete(activeTx);
    } else {
      await this.prisma.$transaction(doHardDelete);
    }

    return ok(undefined);
  }

  /**
   * Check if an active (non-deleted) post exists
   */
  async exists(id: PostId): Promise<boolean> {
    const count = await this.prisma.post.count({
      where: { id: id.value, deletedAt: null },
    });
    return count > 0;
  }

  /**
   * Find all posts for a project
   */
  async findByProjectId(
    projectId: ProjectId,
    pagination?: PaginationParams,
    sort?: SortParams<PostSortField>
  ): Promise<PaginatedResult<PostAggregate>> {
    const { page, limit } = this.normalizePagination(pagination);
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: { projectId: projectId.value, deletedAt: null },
        include: {
          contents: true,
          media: true,
          contentVersions: {
            orderBy: { version: "desc" },
          },
        },
        orderBy: this.buildOrderBy(sort),
        skip,
        take: limit,
      }),
      this.prisma.post.count({
        where: { projectId: projectId.value, deletedAt: null },
      }),
    ]);

    const items = posts.map((p) => PostAggregateMapper.toDomain(p as PrismaPostWithRelations));

    return this.buildPaginatedResult(items, total, page, limit);
  }

  /**
   * Find posts by status
   */
  async findByStatus(
    status: PublishStatusValue | PublishStatusValue[],
    pagination?: PaginationParams
  ): Promise<PaginatedResult<PostAggregate>> {
    const { page, limit } = this.normalizePagination(pagination);
    const skip = (page - 1) * limit;

    const statusArray = Array.isArray(status) ? status : [status];
    const where: Prisma.PostWhereInput = {
      status: { in: statusArray },
      deletedAt: null,
    };

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          contents: true,
          media: true,
          contentVersions: {
            orderBy: { version: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);

    const items = posts.map((p) => PostAggregateMapper.toDomain(p as PrismaPostWithRelations));

    return this.buildPaginatedResult(items, total, page, limit);
  }

  /**
   * Find posts ready for publishing (scheduled time has passed)
   */
  async findReadyForPublishing(limit = 100): Promise<PostAggregate[]> {
    const posts = await this.prisma.post.findMany({
      where: {
        status: PUBLISH_STATUS.SCHEDULED,
        scheduledAt: { lte: new Date() },
        deletedAt: null,
      },
      include: {
        contents: true,
        media: true,
        contentVersions: {
          orderBy: { version: "desc" },
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
    });

    return posts.map((p) => PostAggregateMapper.toDomain(p as PrismaPostWithRelations));
  }

  /**
   * Find posts with filters
   */
  async findWithFilters(
    filters: PostFilterCriteria,
    pagination?: PaginationParams,
    sort?: SortParams<PostSortField>
  ): Promise<PaginatedResult<PostAggregate>> {
    const { page, limit } = this.normalizePagination(pagination);
    const skip = (page - 1) * limit;

    const where = this.buildWhereClause(filters);

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          contents: true,
          media: true,
          contentVersions: {
            orderBy: { version: "desc" },
          },
        },
        orderBy: this.buildOrderBy(sort),
        skip,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);

    const items = posts.map((p) => PostAggregateMapper.toDomain(p as PrismaPostWithRelations));

    return this.buildPaginatedResult(items, total, page, limit);
  }

  /**
   * Count active (non-deleted) posts by project
   */
  async countByProjectId(projectId: ProjectId): Promise<number> {
    return this.prisma.post.count({
      where: { projectId: projectId.value, deletedAt: null },
    });
  }

  /**
   * Count active (non-deleted) posts by status within a project
   */
  async countByStatus(projectId: ProjectId, status: PublishStatusValue): Promise<number> {
    return this.prisma.post.count({
      where: {
        projectId: projectId.value,
        status,
        deletedAt: null,
      },
    });
  }

  /**
   * Get post statistics for a project (excludes soft-deleted posts)
   */
  async getProjectStats(projectId: ProjectId): Promise<{
    total: number;
    drafts: number;
    scheduled: number;
    published: number;
    failed: number;
  }> {
    const base = { projectId: projectId.value, deletedAt: null };
    const [total, drafts, scheduled, published, failed] = await Promise.all([
      this.prisma.post.count({ where: base }),
      this.prisma.post.count({ where: { ...base, status: PUBLISH_STATUS.DRAFT } }),
      this.prisma.post.count({ where: { ...base, status: PUBLISH_STATUS.SCHEDULED } }),
      this.prisma.post.count({ where: { ...base, status: PUBLISH_STATUS.PUBLISHED } }),
      this.prisma.post.count({ where: { ...base, status: PUBLISH_STATUS.FAILED } }),
    ]);

    return { total, drafts, scheduled, published, failed };
  }

  /**
   * Bulk update status for multiple posts
   */
  async bulkUpdateStatus(
    postIds: PostId[],
    status: PublishStatusValue
  ): Promise<Result<void, Error>> {
    try {
      await this.prisma.post.updateMany({
        where: {
          id: { in: postIds.map((id) => id.value) },
          deletedAt: null,
        },
        data: { status },
      });

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Bulk archive — stamp archivedAt for every non-deleted, non-archived post
   * in the input set. Returns the row count whose archivedAt transitioned
   * from null to a timestamp in this call.
   */
  async bulkArchive(postIds: PostId[]): Promise<Result<number, Error>> {
    if (postIds.length === 0) return ok(0);
    try {
      const result = await this.prisma.post.updateMany({
        where: {
          id: { in: postIds.map((id) => id.value) },
          deletedAt: null,
          archivedAt: null,
        },
        data: { archivedAt: new Date() },
      });
      return ok(result.count);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Bulk hard-delete — physically remove rows for every postId. Prisma cascades
   * to dependent rows (contents, media, publishLogs, etc.) per the schema
   * relation onDelete behaviour.
   */
  async bulkHardDelete(postIds: PostId[]): Promise<Result<number, Error>> {
    if (postIds.length === 0) return ok(0);
    try {
      const result = await this.prisma.post.deleteMany({
        where: { id: { in: postIds.map((id) => id.value) } },
      });
      return ok(result.count);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Filter input postIds to only those owned by accountId (joined via
   * Project.accountId). Cross-tenant isolation gate for bulk mutating
   * use cases per CWE-639.
   */
  async filterIdsByAccount(postIds: PostId[], accountId: AccountId): Promise<PostId[]> {
    if (postIds.length === 0) return [];
    const rows = await this.prisma.post.findMany({
      where: {
        id: { in: postIds.map((id) => id.value) },
        deletedAt: null,
        project: { accountId: accountId.value },
      },
      select: { id: true },
    });
    return rows.map((r) => PostId.fromStringUnsafe(r.id));
  }

  /**
   * Lookup the accountId that owns this post via the Project relationship.
   * Returns null if the post does not exist or is soft-deleted.
   */
  async findOwnerAccountId(postId: PostId): Promise<AccountId | null> {
    const row = await this.prisma.post.findFirst({
      where: { id: postId.value, deletedAt: null },
      select: { project: { select: { accountId: true } } },
    });
    if (!row) return null;
    return AccountId.fromStringUnsafe(row.project.accountId);
  }

  // Private helper methods

  /**
   * Create a new post in the database.
   * Es UoW-aware: si hay una transacción activa en el contexto, la usa directamente.
   */
  private async create(aggregate: PostAggregate): Promise<void> {
    const data = PostAggregateMapper.toPrismaCreate(aggregate);
    const activeTx = PrismaUnitOfWork.getTransactionClient();

    if (activeTx) {
      await this.doCreate(activeTx, data, aggregate);
    } else {
      await this.prisma.$transaction(async (tx) => {
        await this.doCreate(tx, data, aggregate);
      });
    }
  }

  /**
   * Lógica interna de creación de post — opera sobre un cliente de transacción.
   */
  private async doCreate(
    tx: TxClient,
    data: ReturnType<typeof PostAggregateMapper.toPrismaCreate>,
    aggregate: PostAggregate
  ): Promise<void> {
    // Create post
    await tx.post.create({
      data: {
        id: data.post.id,
        projectId: data.post.projectId,
        status: data.post.status,
        scheduledAt: data.post.scheduledAt,
        publishedAt: data.post.publishedAt,
      },
    });

    // Create content
    await tx.postContent.create({
      data: data.content,
    });

    // Create media
    if (data.media.length > 0) {
      await tx.postMedia.createMany({
        data: data.media,
      });
    }

    // Persist domain events atomically (Transactional Outbox)
    if (this.outboxWriter) {
      await this.outboxWriter.writeEvents(tx, aggregate.domainEvents);
    }
  }

  /**
   * Update an existing post in the database.
   * Es UoW-aware: si hay una transacción activa en el contexto, la usa directamente.
   */
  private async update(aggregate: PostAggregate): Promise<void> {
    const data = PostAggregateMapper.toPrismaUpdate(aggregate);
    const activeTx = PrismaUnitOfWork.getTransactionClient();

    if (activeTx) {
      await this.doUpdate(activeTx, data, aggregate);
    } else {
      await this.prisma.$transaction(async (tx) => {
        await this.doUpdate(tx, data, aggregate);
      });
    }
  }

  /**
   * Lógica interna de actualización de post — opera sobre un cliente de transacción.
   */
  private async doUpdate(
    tx: TxClient,
    data: ReturnType<typeof PostAggregateMapper.toPrismaUpdate>,
    aggregate: PostAggregate
  ): Promise<void> {
    const postId = aggregate.id.value;
    const expectedVersion = aggregate.version;

    // OCC update (Azure saga §15-20). The WHERE clause includes the version
    // so concurrent writers are rejected — Prisma throws P2025 when no row
    // matches. We translate that to VersionConflictError so the use case
    // layer can surface a meaningful conflict response to the caller.
    try {
      await tx.post.update({
        where: { id: postId, version: expectedVersion },
        data: { ...data.post, version: { increment: 1 } },
      });
      // Reflect the new version in the aggregate so subsequent operations on
      // the same instance see the post-commit value.
      aggregate.incrementVersion();
    } catch (error) {
      const isPrismaNotFound =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2025";
      if (isPrismaNotFound) {
        const current = await tx.post.findUnique({
          where: { id: postId },
          select: { version: true },
        });
        throw new VersionConflictError("Post", postId, expectedVersion, current?.version ?? null);
      }
      throw error;
    }

    // Update or create content (upsert for default locale)
    await tx.postContent.upsert({
      where: {
        postId_locale_revision: {
          postId,
          locale: data.content.locale,
          revision: 1,
        },
      },
      create: {
        postId,
        ...data.content,
        revision: 1,
      },
      update: data.content,
    });

    // Sync media - delete existing and recreate
    const currentMedia = aggregate.media;
    const existingMediaIds = await tx.postMedia
      .findMany({
        where: { postId },
        select: { id: true },
      })
      .then((m) => m.map((x) => x.id));

    const newMediaIds = currentMedia.map((m) => m.id.value);

    // Delete removed media
    const toDelete = existingMediaIds.filter((id) => !newMediaIds.includes(id));
    if (toDelete.length > 0) {
      await tx.postMedia.deleteMany({
        where: { id: { in: toDelete } },
      });
    }

    // Upsert current media
    for (const media of currentMedia) {
      await tx.postMedia.upsert({
        where: { id: media.id.value },
        create: {
          id: media.id.value,
          postId,
          type: media.type as "image" | "video" | "gif",
          url: media.url,
          width: media.width ?? null,
          height: media.height ?? null,
          durationMs: media.durationMs ?? null,
          alt: media.altText ?? null,
          hash: media.hash ?? null,
        },
        update: {
          url: media.url,
          width: media.width ?? null,
          height: media.height ?? null,
          durationMs: media.durationMs ?? null,
          alt: media.altText ?? null,
          hash: media.hash ?? null,
        },
      });
    }

    // Persist domain events atomically (Transactional Outbox)
    if (this.outboxWriter) {
      await this.outboxWriter.writeEvents(tx, aggregate.domainEvents);
    }
  }

  /**
   * Normalize pagination parameters
   */
  private normalizePagination(pagination?: PaginationParams): { page: number; limit: number } {
    return {
      page: Math.max(DEFAULT_PAGE, pagination?.page ?? DEFAULT_PAGE),
      limit: Math.min(MAX_LIMIT, Math.max(1, pagination?.limit ?? DEFAULT_LIMIT)),
    };
  }

  /**
   * Build order by clause for Prisma
   */
  private buildOrderBy(sort?: SortParams<PostSortField>): Prisma.PostOrderByWithRelationInput {
    if (!sort) {
      return { createdAt: "desc" };
    }

    const direction = sort.direction === "asc" ? "asc" : "desc";

    switch (sort.field) {
      case "createdAt":
        return { createdAt: direction };
      case "updatedAt":
        return { updatedAt: direction };
      case "scheduledAt":
        return { scheduledAt: direction };
      case "publishedAt":
        return { publishedAt: direction };
      case "status":
        return { status: direction };
      default:
        return { createdAt: "desc" };
    }
  }

  /**
   * Build where clause from filters
   */
  private buildWhereClause(filters: PostFilterCriteria): Prisma.PostWhereInput {
    const where: Prisma.PostWhereInput = { deletedAt: null };

    if (filters.projectId) {
      where.projectId = filters.projectId.value;
    }

    if (filters.status) {
      const statusArray = Array.isArray(filters.status) ? filters.status : [filters.status];
      where.status = { in: statusArray };
    }

    if (filters.scheduledBefore || filters.scheduledAfter) {
      where.scheduledAt = {};
      if (filters.scheduledBefore) {
        where.scheduledAt.lte = filters.scheduledBefore;
      }
      if (filters.scheduledAfter) {
        where.scheduledAt.gte = filters.scheduledAfter;
      }
    }

    if (filters.createdBefore || filters.createdAfter) {
      where.createdAt = {};
      if (filters.createdBefore) {
        where.createdAt.lte = filters.createdBefore;
      }
      if (filters.createdAfter) {
        where.createdAt.gte = filters.createdAfter;
      }
    }

    if (filters.hasMedia !== undefined) {
      if (filters.hasMedia) {
        where.media = { some: {} };
      } else {
        where.media = { none: {} };
      }
    }

    if (filters.searchText) {
      where.OR = [
        {
          contents: {
            some: {
              body: { contains: filters.searchText, mode: "insensitive" },
            },
          },
        },
        {
          contents: {
            some: {
              title: { contains: filters.searchText, mode: "insensitive" },
            },
          },
        },
      ];
    }

    return where;
  }

  /**
   * Build paginated result
   */
  private buildPaginatedResult<T>(
    items: T[],
    total: number,
    page: number,
    limit: number
  ): PaginatedResult<T> {
    const totalPages = Math.ceil(total / limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  }
}
