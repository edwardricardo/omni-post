/**
 * @file PrismaAccountRepository.ts
 * @description Prisma adapter implementing AccountRepositoryPort (write-side).
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import { Account, AccountId, EntityNotFoundError } from "@core/domain/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { HardDeleteContext } from "@core/domain/repositories/Repository.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import { HARD_DELETE_TX_OPTIONS } from "../hardDeleteTransaction.js";

/** Local type alias for Prisma transaction client */
type TxClient = Prisma.TransactionClient;

/**
 * Maps a Prisma Account row to the Account domain entity
 */
function toDomain(row: {
  id: string;
  email: string;
  name: string;
  maxProjects: number;
  isOnTrial: boolean;
  trialStartDate: Date;
  trialEndDate: Date | null;
  autoRenewal: boolean;
  billingCycle: string;
  nextBillingDate: Date | null;
  lastBillingDate: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { projects: number };
}): Account {
  const id = AccountId.fromStringUnsafe(row.id);

  return Account.reconstitute(id, {
    email: row.email,
    name: row.name,
    maxProjects: row.maxProjects,
    isOnTrial: row.isOnTrial,
    trialStartDate: row.trialStartDate,
    ...(row.trialEndDate !== null && { trialEndDate: row.trialEndDate }),
    autoRenewal: row.autoRenewal,
    billingCycle: row.billingCycle as "monthly" | "yearly",
    ...(row.nextBillingDate !== null && { nextBillingDate: row.nextBillingDate }),
    ...(row.lastBillingDate !== null && { lastBillingDate: row.lastBillingDate }),
    ...(row.stripeCustomerId !== null && { stripeCustomerId: row.stripeCustomerId }),
    ...(row.stripeSubscriptionId !== null && { stripeSubscriptionId: row.stripeSubscriptionId }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    projectCount: row._count?.projects ?? 0,
  });
}

/**
 * PrismaAccountRepository - Implements AccountRepositoryPort using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture - it implements
 * the repository PORT defined in the domain layer.
 *
 * @example
 * const repo = new PrismaAccountRepository(prisma);
 * const result = await repo.findById(AccountId.fromString("..."));
 */
export class PrismaAccountRepository implements AccountRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find an account by its ID (excludes soft-deleted accounts)
   */
  async findById(id: AccountId): Promise<Result<Account, EntityNotFoundError>> {
    const row = await this.prisma.account.findFirst({
      where: { id: id.value, deletedAt: null },
      include: { _count: { select: { projects: { where: { deletedAt: null } } } } },
    });

    if (!row) {
      return err(new EntityNotFoundError("Account", id.value));
    }

    return ok(toDomain(row));
  }

  /**
   * Find an account by email address (excludes soft-deleted accounts)
   */
  async findByEmail(email: string): Promise<Account | null> {
    const row = await this.prisma.account.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
      include: { _count: { select: { projects: { where: { deletedAt: null } } } } },
    });

    if (!row) {
      return null;
    }

    return toDomain(row);
  }

  /**
   * Save an account (create or update via upsert)
   */
  async save(account: Account): Promise<Result<void, Error>> {
    try {
      await this.prisma.account.upsert({
        where: { id: account.id.value },
        create: {
          id: account.id.value,
          email: account.email,
          name: account.name,
          maxProjects: account.maxProjects,
          isOnTrial: account.isOnTrial,
          trialStartDate: account.trialStartDate,
          ...(account.trialEndDate !== undefined && { trialEndDate: account.trialEndDate }),
          autoRenewal: account.autoRenewal,
          billingCycle: account.billingCycle,
          ...(account.nextBillingDate !== undefined && {
            nextBillingDate: account.nextBillingDate,
          }),
          ...(account.lastBillingDate !== undefined && {
            lastBillingDate: account.lastBillingDate,
          }),
          ...(account.stripeCustomerId !== undefined && {
            stripeCustomerId: account.stripeCustomerId,
          }),
          ...(account.stripeSubscriptionId !== undefined && {
            stripeSubscriptionId: account.stripeSubscriptionId,
          }),
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        },
        update: {
          email: account.email,
          name: account.name,
          maxProjects: account.maxProjects,
          isOnTrial: account.isOnTrial,
          trialStartDate: account.trialStartDate,
          trialEndDate: account.trialEndDate ?? null,
          autoRenewal: account.autoRenewal,
          billingCycle: account.billingCycle,
          nextBillingDate: account.nextBillingDate ?? null,
          lastBillingDate: account.lastBillingDate ?? null,
          stripeCustomerId: account.stripeCustomerId ?? null,
          stripeSubscriptionId: account.stripeSubscriptionId ?? null,
          updatedAt: account.updatedAt,
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Soft-delete an account by marking deletedAt = now.
   * The account becomes invisible to all standard find queries.
   * Child data (projects, channels, posts) remains intact for audit purposes.
   */
  async delete(id: AccountId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.exists(id);
    if (!exists) {
      return err(new EntityNotFoundError("Account", id.value));
    }

    await this.prisma.account.update({
      where: { id: id.value },
      data: { deletedAt: new Date() },
    });
    return ok(undefined);
  }

  /**
   * Restore a soft-deleted account by clearing deletedAt = null, reversing the
   * soft delete so standard reads return it again.
   *
   * DELIBERATE soft-delete-sweep exception: the finder targets a row that IS
   * currently soft-deleted (`NOT: { deletedAt: null }`) — the one query in this
   * adapter that does not filter `deletedAt: null`, because its whole purpose is
   * to act on a soft-deleted row. A row that is absent (never existed or
   * hard-deleted) or already active is not restorable and yields
   * EntityNotFoundError, so "restore a non-deleted row" is indistinguishable from
   * "restore a row that does not exist" (anti-enumeration).
   */
  async restore(id: AccountId): Promise<Result<void, EntityNotFoundError>> {
    const softDeleted = await this.prisma.account.findFirst({
      where: { id: id.value, NOT: { deletedAt: null } },
      select: { id: true },
    });
    if (!softDeleted) {
      return err(new EntityNotFoundError("Account", id.value));
    }

    await this.prisma.account.update({
      where: { id: id.value },
      data: { deletedAt: null },
    });
    return ok(undefined);
  }

  /**
   * Hard-delete an account and everything it owns. SUPER_ADMIN only —
   * irreversible.
   *
   * The delete order lives in the schema, not here: every owned child
   * cascades from Account (projects and their subtrees, channels, users,
   * subscriptions with their price history, api keys, templates, ...), and
   * survivor records detach via `ON DELETE SET NULL` (invoices, billing
   * events, DSAR requests, admin role history, referral usage rows — see
   * docs/architecture/schema-conventions.md, "Choosing the ON DELETE
   * action").
   *
   * The one explicit step left is GDPR erasure of inbound webhook payloads
   * (tenant social data): their FKs are SET NULL so they survive narrower
   * deletions as audit records, but account erasure keeps destroying them.
   *
   * Tombstones (`DeletionRecord`) are written FIRST — one for the account and
   * one for every project the cascade drags along — from snapshots read inside
   * the same transaction. The projects have to be captured BEFORE the delete:
   * afterwards there is nothing left to read them from. No tombstone, no
   * delete: a failed insert rolls the destruction back with it.
   *
   * ATOMIC: runs inside one transaction. UoW-aware: an outer
   * `executeInTransaction` is joined rather than nested.
   */
  async hardDelete(
    id: AccountId,
    context: HardDeleteContext
  ): Promise<Result<void, EntityNotFoundError>> {
    const accountId = id.value;

    // The existence probe lives INSIDE the transaction and doubles as the
    // tombstone snapshot: one read that cannot go stale between the check and
    // the delete. `findFirst` without `deletedAt` so an already soft-deleted
    // account is still reachable by the irreversible path.
    const doHardDelete = async (tx: TxClient): Promise<boolean> => {
      const account = await tx.account.findFirst({
        where: { id: accountId },
        select: { id: true, name: true, createdAt: true },
      });
      if (!account) {
        return false;
      }

      // Soft-deleted projects are included on purpose: the cascade destroys
      // them too, so a tombstone owes them the same record.
      const projects = await tx.project.findMany({
        where: { accountId },
        select: { id: true, name: true, createdAt: true },
      });
      const projectIds = projects.map((p) => p.id);

      const clientUntil = new Date();
      const tombstones = [
        {
          entityType: "ACCOUNT",
          entityId: account.id,
          name: account.name,
          accountId,
          clientSince: account.createdAt,
          clientUntil,
          deletedBy: context.deletedBy,
        },
        ...projects.map((project) => ({
          entityType: "PROJECT",
          entityId: project.id,
          name: project.name,
          accountId,
          clientSince: project.createdAt,
          clientUntil,
          deletedBy: context.deletedBy,
        })),
      ];
      const written = await tx.deletionRecord.createMany({ data: tombstones });

      // Assert the tombstone write rather than assume it: one row for the account
      // plus one per project it drags along. If `createMany` inserted fewer than
      // that, the durable record of what is about to be destroyed is incomplete,
      // so we abort the whole transaction (delete included) instead of destroying
      // rows no tombstone describes.
      if (written.count !== tombstones.length) {
        throw new Error(
          `Tombstone integrity check failed for account ${accountId}: expected ` +
            `${tombstones.length} DeletionRecord row(s) (1 account + ${projects.length} ` +
            `project(s)), createMany reported ${written.count}`
        );
      }

      await tx.webhookEvent.deleteMany({
        where: {
          OR: [
            { accountId },
            ...(projectIds.length > 0 ? [{ projectId: { in: projectIds } }] : []),
          ],
        },
      });

      await tx.account.delete({ where: { id: accountId } });
      return true;
    };

    const activeTx = PrismaUnitOfWork.getTransactionClient();
    // When an outer Unit of Work is active the delete JOINS it (the hard-delete
    // use case opens a Serializable UoW under `withSystemContext`, which is what
    // binds the `app.account_id` RLS GUC and pins the isolation level so the
    // tombstone snapshot cannot miss a concurrently inserted project). Only the
    // standalone branch owns a transaction, so it carries the same bounds itself.
    const deleted = activeTx
      ? await doHardDelete(activeTx)
      : await this.prisma.$transaction(doHardDelete, HARD_DELETE_TX_OPTIONS);

    if (!deleted) {
      return err(new EntityNotFoundError("Account", accountId));
    }

    return ok(undefined);
  }

  /**
   * Estimate the blast radius of a hard delete: the number of posts the cascade
   * would destroy across every project of the account (soft-deleted projects
   * included — the cascade takes them too). Posts are the dominant per-row
   * cascade cost, so the hard-delete use case uses this to refuse a tenant too
   * large to remove in one transaction before any destructive work begins. A
   * single aggregate, no rows materialized.
   */
  async countHardDeleteImpact(id: AccountId): Promise<number> {
    return this.prisma.post.count({ where: { project: { accountId: id.value } } });
  }

  /**
   * Check whether an active (non-deleted) account with the given ID exists
   */
  async exists(id: AccountId): Promise<boolean> {
    const count = await this.prisma.account.count({
      where: { id: id.value, deletedAt: null },
    });
    return count > 0;
  }

  /**
   * Return all active accounts ordered by creation date descending.
   * The returned Account entities include projectCount from the DB aggregate.
   */
  async findAll(): Promise<Account[]> {
    const rows = await this.prisma.account.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { projects: { where: { deletedAt: null } } } } },
    });
    return rows.map(toDomain);
  }
}
