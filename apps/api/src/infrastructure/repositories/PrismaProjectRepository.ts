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
import { DELETION_RECORD_LAWFUL_BASIS, computeRetainUntil } from "./deletionRecordRetention.js";
import { recordHardDeleteImpact } from "../../metrics/deletionMetrics.js";
import { env } from "../../config/env.js";
import type { ContentLocale } from "@core/domain/value-objects/Content.js";
import type {
  ProjectRepositoryPort,
  PublishLogView,
} from "@core/domain/repositories/ProjectRepository.js";
import type { HardDeleteContext, HardDeleteImpact } from "@core/domain/repositories/Repository.js";
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

      const clientUntil = new Date();
      const tombstones = [
        {
          entityType: "PROJECT",
          entityId: snapshot.id,
          name: snapshot.name,
          accountId: snapshot.accountId,
          clientSince: snapshot.createdAt,
          clientUntil,
          deletedBy: context.deletedBy,
          // The operator's justification is written in the SAME transaction as
          // the destruction it justifies. Kept on the row rather than only in
          // AuditLog, which is written outside this transaction and can
          // therefore survive a rolled-back delete or be lost with a committed
          // one — either way describing a history that did not happen.
          reason: context.reason,
          retainUntil: computeRetainUntil(clientUntil, env.DELETION_RECORD_RETENTION_YEARS),
          lawfulBasis: DELETION_RECORD_LAWFUL_BASIS,
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
   * Measure the blast radius of a hard delete in BOTH dimensions the transaction
   * budget is spent on. Posts alone were never the whole cost: PostgreSQL fires one
   * referential trigger per destroyed row per referencing table, so the real cost is
   * posts MULTIPLIED BY the rows that reference them, and a project with few posts
   * and a large child population sails past a posts-only ceiling and then cannot
   * finish inside the budget.
   *
   * `Task` and `WebhookEvent` are the child populations counted here because they
   * are the two that (a) carry `projectId` themselves, so an index answers the count
   * without joining through the posts we are trying not to touch, and (b) measured
   * as the largest per-post triggers in the cascade. The rest of `Post`'s children
   * carry no tenant column; see `HardDeleteImpact` for what that leaves uncounted.
   *
   * Cheap by construction: three indexed aggregates, no rows materialized. They run
   * concurrently rather than in one batched transaction because this is a pre-flight
   * estimate that never needs a consistent snapshot — and because a batch
   * `$transaction` here would nest if a caller ever ran the use case inside a Unit
   * of Work.
   */
  async countHardDeleteImpact(id: ProjectId): Promise<HardDeleteImpact> {
    const projectId = id.value;
    const [posts, tasks, webhookEvents] = await Promise.all([
      this.prisma.post.count({ where: { projectId } }),
      this.prisma.task.count({ where: { projectId } }),
      this.prisma.webhookEvent.count({ where: { projectId } }),
    ]);
    const impact: HardDeleteImpact = { posts, childRows: tasks + webhookEvents };
    // Published here, at the measurement, rather than at the ceiling check: the counts are
    // otherwise discarded on every attempt that stays under the limits, which is exactly
    // the population that shows a project approaching them.
    recordHardDeleteImpact("project", impact);
    return impact;
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
