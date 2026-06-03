/**
 * @file PrismaAccountRepository.ts
 * @description Prisma adapter implementing AccountRepositoryPort (write-side).
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import { Account, AccountId, EntityNotFoundError } from "@core/domain/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";

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
   * Hard-delete an account and all related data in the correct cascade order.
   * SUPER_ADMIN only — irreversible.
   *
   * Infrastructure-layer responsibility: manages FK constraint ordering so
   * callers do not need to know the database topology.
   */
  async hardDelete(id: AccountId): Promise<Result<void, EntityNotFoundError>> {
    // Use findFirst to detect the account even if it was soft-deleted
    const account = await this.prisma.account.findFirst({
      where: { id: id.value },
      select: { id: true },
    });
    if (!account) {
      return err(new EntityNotFoundError("Account", id.value));
    }

    const accountId = id.value;

    // Gather project IDs for cascading into project-scoped tables
    const projects = await this.prisma.project.findMany({
      where: { accountId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    if (projectIds.length > 0) {
      // 1. PublishLogs (references posts + channels)
      await this.prisma.publishLog.deleteMany({
        where: { post: { projectId: { in: projectIds } } },
      });
      // 2. Analytics
      await this.prisma.analytics.deleteMany({
        where: { post: { projectId: { in: projectIds } } },
      });
      // 3. PostMedia
      await this.prisma.postMedia.deleteMany({
        where: { post: { projectId: { in: projectIds } } },
      });
      // 4. PostContent
      await this.prisma.postContent.deleteMany({
        where: { post: { projectId: { in: projectIds } } },
      });
      // 5. ContentVersions
      await this.prisma.contentVersion.deleteMany({
        where: { post: { projectId: { in: projectIds } } },
      });
      // 6. Threads + Tweets
      const posts = await this.prisma.post.findMany({
        where: { projectId: { in: projectIds } },
        select: { id: true },
      });
      const postIds = posts.map((p) => p.id);
      if (postIds.length > 0) {
        await this.prisma.tweet.deleteMany({
          where: { thread: { postId: { in: postIds } } },
        });
        await this.prisma.thread.deleteMany({
          where: { postId: { in: postIds } },
        });
      }
      // 7. Posts
      await this.prisma.post.deleteMany({ where: { projectId: { in: projectIds } } });
      // 8. Channels (single connection model — covers tokens + display state)
      await this.prisma.channel.deleteMany({ where: { projectId: { in: projectIds } } });
      // 9. Misc project-scoped tables
      await this.prisma.contentTemplate.deleteMany({ where: { projectId: { in: projectIds } } });
      await this.prisma.instagramStoryProject.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await this.prisma.videoProcessingJob.deleteMany({ where: { projectId: { in: projectIds } } });
      await this.prisma.instagramAnalytics.deleteMany({ where: { projectId: { in: projectIds } } });
      await this.prisma.schedulingRule.deleteMany({ where: { projectId: { in: projectIds } } });
      await this.prisma.webhookEvent.deleteMany({ where: { projectId: { in: projectIds } } });
      await this.prisma.webhookSubscription.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await this.prisma.template.deleteMany({ where: { projectId: { in: projectIds } } });
      // 10. Projects
      await this.prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }

    // Account-level records
    await this.prisma.apiKey.deleteMany({ where: { accountId } });
    await this.prisma.contentTemplate.deleteMany({ where: { accountId } });
    await this.prisma.instagramStoryProject.deleteMany({ where: { accountId } });
    await this.prisma.videoProcessingJob.deleteMany({ where: { accountId } });
    await this.prisma.instagramAnalytics.deleteMany({ where: { accountId } });
    await this.prisma.schedulingRule.deleteMany({ where: { accountId } });
    await this.prisma.webhookEvent.deleteMany({ where: { accountId } });
    await this.prisma.webhookSubscription.deleteMany({ where: { accountId } });
    await this.prisma.template.deleteMany({ where: { accountId } });

    await this.prisma.account.delete({ where: { id: accountId } });
    return ok(undefined);
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
