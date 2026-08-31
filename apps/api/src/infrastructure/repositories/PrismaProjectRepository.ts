/**
 * @file PrismaProjectRepository.ts
 * @description Prisma adapter implementing ProjectRepositoryPort (write-side).
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  Project,
  ProjectId,
  AccountId,
  ChannelId,
  PostId,
  EntityNotFoundError,
} from "@core/domain/index.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import { HARD_DELETE_TX_OPTIONS } from "../hardDeleteTransaction.js";
import type { ContentLocale } from "@core/domain/value-objects/Content.js";
import type {
  ProjectRepositoryPort,
  PublishLogView,
} from "@core/domain/repositories/ProjectRepository.js";
import type { HardDeleteContext } from "@core/domain/repositories/Repository.js";
import type { CrisisModeEntry } from "@core/domain/entities/Project.js";

/** Local type alias for Prisma transaction client */
type TxClient = Prisma.TransactionClient;

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
   * Find a project by its ID INCLUDING soft-deleted rows. The deliberate
   * counterpart to {@link findById}: it does NOT filter `deletedAt: null`,
   * because the restore path needs the stored `accountId` of a row that is by
   * definition soft-deleted. Reserved for the restore use case; every other read
   * path keeps the `deletedAt: null` sweep.
   */
  async findByIdIncludingDeleted(id: ProjectId): Promise<Result<Project, EntityNotFoundError>> {
    const row = await this.prisma.project.findFirst({
      where: { id: id.value },
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
   * Restore a soft-deleted project by clearing deletedAt = null, reversing the
   * soft delete so standard reads return it again.
   *
   * DELIBERATE soft-delete-sweep exception: the finder targets a row that IS
   * currently soft-deleted (`NOT: { deletedAt: null }`) — the one write path here
   * that does not filter `deletedAt: null`, because its whole purpose is to act
   * on a soft-deleted row. A row that is absent (never existed / hard-deleted) or
   * already active is not restorable and yields EntityNotFoundError, so "restore
   * a non-deleted row" is indistinguishable from "restore a row that does not
   * exist" (anti-enumeration). Under a customer tenant context the tenant guard
   * additionally injects `accountId`, so a foreign tenant's row is invisible here
   * as well (defense in depth over the use-case ownership gate).
   */
  async restore(id: ProjectId): Promise<Result<void, EntityNotFoundError>> {
    const softDeleted = await this.prisma.project.findFirst({
      where: { id: id.value, NOT: { deletedAt: null } },
      select: { id: true },
    });
    if (!softDeleted) {
      return err(new EntityNotFoundError("Project", id.value));
    }

    await this.prisma.project.update({
      where: { id: id.value },
      data: { deletedAt: null },
    });
    return ok(undefined);
  }

  /**
   * Hard-delete a project. SUPER_ADMIN only — irreversible.
   *
   * The delete order lives in the schema, not here. Every owned child —
   * posts with their content, media, threads, versions, comments and
   * approvals; channels with their inbox and analytics history; the
   * project-scoped Cascade children — is removed by `ON DELETE CASCADE`,
   * and every reference with its own lifetime (tasks, content templates,
   * webhook events, custom reports, media assets) detaches via
   * `ON DELETE SET NULL` (see docs/architecture/schema-conventions.md,
   * "Choosing the ON DELETE action").
   *
   * A tombstone (`DeletionRecord`) is written FIRST, from a snapshot read inside
   * the same transaction, so the only durable trace of the destroyed tenant data
   * cannot describe a row other than the one deleted. No tombstone, no delete:
   * a failed insert rolls the delete back with it.
   *
   * ATOMIC: two statements in one transaction, so a failure (e.g. the deliberate
   * RecurringPost.templatePost RESTRICT interlock) rolls everything back.
   * UoW-aware: an outer `executeInTransaction` is joined rather than nested.
   */
  async hardDelete(
    id: ProjectId,
    context: HardDeleteContext
  ): Promise<Result<void, EntityNotFoundError>> {
    // The existence probe lives INSIDE the transaction and doubles as the
    // tombstone snapshot: one read that cannot go stale between the check and
    // the delete. `findFirst` without `deletedAt` so an already soft-deleted
    // project is still reachable by the irreversible path.
    const doHardDelete = async (tx: TxClient): Promise<boolean> => {
      const snapshot = await tx.project.findFirst({
        where: { id: id.value },
        select: { id: true, accountId: true, name: true, createdAt: true },
      });
      if (!snapshot) {
        return false;
      }

      const tombstones = [
        {
          entityType: "PROJECT",
          entityId: snapshot.id,
          name: snapshot.name,
          accountId: snapshot.accountId,
          clientSince: snapshot.createdAt,
          clientUntil: new Date(),
          deletedBy: context.deletedBy,
        },
      ];
      const written = await tx.deletionRecord.createMany({ data: tombstones });

      // Assert the tombstone write rather than assume it: if `createMany`
      // inserted fewer rows than we handed it, the durable record of what is
      // about to be destroyed is incomplete, so we abort the whole transaction
      // (delete included) instead of destroying a row no tombstone describes.
      if (written.count !== tombstones.length) {
        throw new Error(
          `Tombstone integrity check failed for project ${id.value}: expected ` +
            `${tombstones.length} DeletionRecord row(s), createMany reported ${written.count}`
        );
      }

      await tx.project.delete({ where: { id: id.value } });
      return true;
    };

    const activeTx = PrismaUnitOfWork.getTransactionClient();
    // When an outer Unit of Work is active the delete JOINS it (the hard-delete
    // use case opens a Serializable UoW under `withSystemContext`, which is what
    // binds the `app.account_id` RLS GUC and pins the isolation level). Only the
    // standalone branch owns a transaction, so it carries the same bounds itself
    // (Serializable snapshot + explicit timeout) — direct callers and tests get
    // the same guarantees as the production path.
    const deleted = activeTx
      ? await doHardDelete(activeTx)
      : await this.prisma.$transaction(doHardDelete, HARD_DELETE_TX_OPTIONS);

    if (!deleted) {
      return err(new EntityNotFoundError("Project", id.value));
    }

    return ok(undefined);
  }

  /**
   * Estimate the blast radius of a hard delete: the number of posts the cascade
   * would destroy for this project. Posts are the dominant per-row cascade cost,
   * so the hard-delete use case uses this to refuse a project too large to remove
   * in one transaction before any destructive work begins. A single aggregate,
   * no rows materialized.
   */
  async countHardDeleteImpact(id: ProjectId): Promise<number> {
    return this.prisma.post.count({ where: { projectId: id.value } });
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
      where: { post: { projectId: id.value, deletedAt: null } },
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
