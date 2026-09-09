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
  type TenantScope,
  PUBLISH_STATUS,
  EntityNotFoundError,
  VersionConflictError,
} from "@core/domain/index.js";
import { withGucBoundTransaction } from "@infra/prisma/extensions/tenantGuc.js";
import type { OutboxWriter } from "@core/domain/repositories/OutboxWriter.js";
import {
  PostAggregateMapper,
  type PrismaPostWithRelations,
} from "./mappers/PostAggregateMapper.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import { getAmbientGucScope } from "../../security/tenantContext.js";

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
   * @method activeClient
   * @description The client a statement must be issued on. Inside a unit of work that is
   *   the transaction's OWN client, and the distinction is load-bearing rather than
   *   stylistic: the unit of work issues `set_config('app.account_id', …, true)` on THAT
   *   connection and then holds the marker that tells the per-operation binding to stand
   *   down. A statement issued on the injected client instead runs on a second pooled
   *   connection where the tenant was never bound and where nothing will bind it — outside
   *   the caller's rollback, and invisible for as long as the connecting role bypassed row
   *   security. Once `tenant_isolation` covers `Post`, the same statement simply matches no
   *   row, so a soft delete of a post the caller owns reports failure.
   * @returns The active transaction client when a unit of work is open, otherwise the
   *   injected client, whose per-operation binding wraps and binds each statement itself.
   */
  private activeClient(): TxClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * Soft-delete a post (sets deletedAt = now).
   * The post becomes invisible to all standard find queries.
   * Child data (contents, media, publishLogs) remains intact for audit purposes.
   *
   * Both statements go through {@link activeClient}: the existence probe and the update
   * must observe the same tenant binding, and inside a unit of work that binding lives on
   * the transaction's connection.
   */
  async delete(id: PostId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.exists(id);

    if (!exists) {
      return err(new EntityNotFoundError("Post", id.value));
    }

    await this.activeClient().post.update({
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
    // DELIBERATE soft-delete-sweep exception: the hard-delete probe must detect
    // even soft-deleted posts.
    //
    // Through {@link activeClient} for the reason `exists()` is: this probe decides
    // whether the destructive block below runs at all, and an answer read on a
    // connection the enclosing unit of work never bound describes a different tenant
    // scope than the delete that follows it. Left on the injected client it reported
    // the caller's OWN post as absent once `Post` carried row security.
    const post = await this.activeClient().post.findFirst({
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
      await withGucBoundTransaction(this.prisma, getAmbientGucScope(), doHardDelete);
    }

    return ok(undefined);
  }

  /**
   * Check if an active (non-deleted) post exists.
   *
   * Issued through {@link activeClient} because this probe decides what `save` and
   * `delete` do next: read on a connection the enclosing unit of work never bound and the
   * answer describes a different tenant scope than the write that follows it.
   */
  async exists(id: PostId): Promise<boolean> {
    const count = await this.activeClient().post.count({
      where: { id: id.value, deletedAt: null },
    });
    return count > 0;
  }

  /**
   * Find all posts for a project, inside an explicit tenant scope.
   *
   * `scope.accountId` goes into the `where` EXPLICITLY rather than being left to
   * the guard's injection. The guard would supply it, but then the query would
   * only be as scoped as the context happened to be; stated here, the guard
   * VALIDATES it against the bound context instead and disagreement becomes a
   * mismatch error rather than a silently different result set.
   */
  async findByProjectId(
    scope: TenantScope,
    projectId: ProjectId,
    pagination?: PaginationParams,
    sort?: SortParams<PostSortField>
  ): Promise<PaginatedResult<PostAggregate>> {
    const { page, limit } = this.normalizePagination(pagination);
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: { projectId: projectId.value, accountId: scope.accountId, deletedAt: null },
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
        where: { projectId: projectId.value, accountId: scope.accountId, deletedAt: null },
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
  async countByProjectId(scope: TenantScope, projectId: ProjectId): Promise<number> {
    return this.prisma.post.count({
      where: { projectId: projectId.value, accountId: scope.accountId, deletedAt: null },
    });
  }

  /**
   * Count active (non-deleted) posts by status within a project
   */
  async countByStatus(
    scope: TenantScope,
    projectId: ProjectId,
    status: PublishStatusValue
  ): Promise<number> {
    return this.prisma.post.count({
      where: {
        projectId: projectId.value,
        accountId: scope.accountId,
        status,
        deletedAt: null,
      },
    });
  }

  /**
   * Get post statistics for a project (excludes soft-deleted posts)
   */
  async getProjectStats(
    scope: TenantScope,
    projectId: ProjectId
  ): Promise<{
    total: number;
    drafts: number;
    scheduled: number;
    published: number;
    failed: number;
  }> {
    const base = { projectId: projectId.value, accountId: scope.accountId, deletedAt: null };
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
   * Bulk update status for multiple posts.
   *
   * Issued through {@link activeClient}. `updateMany` reports success on a statement
   * that matched NOTHING, so this method's `ok` says only that the database accepted
   * the query — never that a row moved. On the injected client inside a unit of work
   * the statement runs on a connection the transaction never bound, matches nothing,
   * and this returns `ok` over a status change that did not happen.
   */
  async bulkUpdateStatus(
    postIds: PostId[],
    status: PublishStatusValue
  ): Promise<Result<void, Error>> {
    try {
      await this.activeClient().post.updateMany({
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
   *
   * Issued through {@link activeClient}. `ArchivePostsBatchUseCase` receives a
   * UnitOfWork from the composition root, so this always runs inside a transaction
   * in production; on the injected client that transaction's tenant binding lives on
   * a different connection, the update matches nothing, and `PATCH /posts/batch/archive`
   * answers 200 with `archived: 0` for a caller archiving its own post.
   */
  async bulkArchive(postIds: PostId[]): Promise<Result<number, Error>> {
    if (postIds.length === 0) return ok(0);
    try {
      const result = await this.activeClient().post.updateMany({
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
   *
   * Issued through {@link activeClient}, the same reach as its archive sibling and
   * for the same reason: `HardDeletePostsBatchUseCase` wraps this in a unit of work,
   * and an irreversible delete that silently matches no row is the worst shape this
   * class of defect takes — the caller is told the posts are gone while they remain.
   */
  async bulkHardDelete(postIds: PostId[]): Promise<Result<number, Error>> {
    if (postIds.length === 0) return ok(0);
    try {
      const result = await this.activeClient().post.deleteMany({
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
   *
   * Issued through {@link activeClient} even though both batch use cases call it
   * BEFORE they open their transaction, which is what keeps it working today. That
   * ordering is load-bearing by accident, not by design: the `project: { accountId }`
   * join meets `Project`'s row security, so inside a unit of work this read returns an
   * EMPTY set on the injected client and every id is dropped as unowned — a gate that
   * refuses the caller's own posts. Measured to fail that way with the trio's own RLS
   * migration reverted, so it is not this enrollment's doing; reaching for the active
   * client closes it here rather than leaving the fix to be whoever moves this call.
   */
  async filterIdsByAccount(postIds: PostId[], accountId: AccountId): Promise<PostId[]> {
    if (postIds.length === 0) return [];
    const rows = await this.activeClient().post.findMany({
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
   * Returns null if the post does not exist, is soft-deleted, or its owning
   * project is not visible to the caller.
   *
   * The third case used to be the ORDINARY one, and saying what changed matters
   * more than the check itself. `Project` was covered by row security while `Post`
   * was not, so a caller whose scope excluded the project still saw the post row
   * and got `project: null` from the join — measured directly against PostgreSQL
   * as `omnipost_app`. `Post` now carries `tenant_isolation` too, so that caller no
   * longer sees the post row at all and lands on the FIRST case instead: the whole
   * read resolves to null one table earlier.
   *
   * The check stays because it is the only thing standing between a divergence in
   * what the two policies admit and a TypeError the route reports as a 500 —
   * Prisma types the relation as non-nullable because the schema declares it
   * required, so an empty join is a shape the compiler cannot warn about. Failing
   * closed here costs one comparison; the alternative fails open into a 500 on a
   * read whose whole job is to decide ownership. Ownership that cannot be
   * established is NOT ownership: it collapses onto the same null the missing-post
   * case returns, which is what keeps a foreign id indistinguishable from a
   * nonexistent one at the gate above.
   */
  async findOwnerAccountId(postId: PostId): Promise<AccountId | null> {
    const row = await this.prisma.post.findFirst({
      where: { id: postId.value, deletedAt: null },
      select: { project: { select: { accountId: true } } },
    });
    if (!row?.project) return null;
    return AccountId.fromStringUnsafe(row.project.accountId);
  }

  /**
   * @method findProjectOwnerAccountId
   * @description Resolves the tenant that owns a project, through the guarded
   *   client. Under a bound tenant context the guard injects `accountId` into the
   *   `where`, so another tenant's project does not resolve and this returns null
   *   — indistinguishable, by construction, from a project that does not exist.
   * @param projectId - The project a post would be created under
   * @returns The owning accountId, or null when the project is absent or invisible
   */
  async findProjectOwnerAccountId(projectId: ProjectId): Promise<AccountId | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId.value, deletedAt: null },
      select: { accountId: true },
    });
    if (!project) return null;
    return AccountId.fromStringUnsafe(project.accountId);
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
      await withGucBoundTransaction(this.prisma, getAmbientGucScope(), async (tx) => {
        await this.doCreate(tx, data, aggregate);
      });
    }
  }

  /**
   * @method resolveProjectTenant
   * @description Reads the owning tenant of a post's project from the project row
   *   itself, through the SAME transaction client the write will use. This is the
   *   only source of a new post's `accountId`: the value is never taken from the
   *   caller, from the aggregate, or from the request.
   *
   *   Under a bound tenant context the guard injects `accountId` into this read's
   *   `where`, so a project belonging to another tenant simply does not resolve and
   *   the write is refused before it is attempted. Under an explicit
   *   `withSystemContext(reason)` the guard steps aside and this read returns the
   *   project's true owner, which is what lets a server-side sweep write on behalf
   *   of a tenant it derived rather than one it was handed.
   *
   *   Soft-deleted projects are excluded deliberately. The composite FK would accept
   *   one (a soft delete is a column update, so the referenced row still exists), but
   *   a post created inside a deleted project is a defect either way, and refusing it
   *   here fails closed instead of relying on the caller having checked.
   * @param tx - The transaction client the post write runs on
   * @param projectId - The project the post will belong to
   * @returns The project's `accountId`
   */
  private async resolveProjectTenant(tx: TxClient, projectId: string): Promise<string> {
    const project = await tx.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { accountId: true },
    });
    if (!project) {
      // Indistinguishable by construction from "no such project": a foreign
      // project and a nonexistent one must not be tellable apart from outside.
      throw new EntityNotFoundError("Project", projectId);
    }
    return project.accountId;
  }

  /**
   * Lógica interna de creación de post — opera sobre un cliente de transacción.
   */
  private async doCreate(
    tx: TxClient,
    data: ReturnType<typeof PostAggregateMapper.toPrismaCreate>,
    aggregate: PostAggregate
  ): Promise<void> {
    const accountId = await this.resolveProjectTenant(tx, data.post.projectId);

    // Create post
    await tx.post.create({
      data: {
        id: data.post.id,
        projectId: data.post.projectId,
        accountId,
        status: data.post.status,
        scheduledAt: data.post.scheduledAt,
        publishedAt: data.post.publishedAt,
      },
    });

    // Create content — the child inherits the parent's tenant, never its own lookup.
    await tx.postContent.create({
      data: { ...data.content, accountId },
    });

    // Create media
    if (data.media.length > 0) {
      await tx.postMedia.createMany({
        data: data.media.map((media) => ({ ...media, accountId })),
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
      await withGucBoundTransaction(this.prisma, getAmbientGucScope(), async (tx) => {
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
    // The tenant of any child row created below comes from the parent row this
    // update just wrote — read back from the database rather than recomputed, so
    // a child can never land in a tenant its parent is not in.
    let accountId: string;
    try {
      const updated = await tx.post.update({
        where: { id: postId, version: expectedVersion },
        data: { ...data.post, version: { increment: 1 } },
        select: { accountId: true },
      });
      accountId = updated.accountId;
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
        // DELIBERATE soft-delete-sweep exception: version-conflict recovery must
        // read the row even after a concurrent soft delete to report its version.
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
        accountId,
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
          accountId,
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
