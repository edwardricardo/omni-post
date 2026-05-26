/**
 * @file PrismaIntegrationSubscriptionRepository.ts
 * @description Infrastructure adapter implementing IntegrationSubscriptionRepository port
 *   using Prisma ORM. Maps between Prisma database types and IntegrationSubscription
 *   domain entities via reconstitute().
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { IntegrationSubscriptionRepository } from "@core/domain/repositories/IntegrationSubscriptionRepository.js";
import { IntegrationSubscription } from "@core/domain/entities/IntegrationSubscription.js";
import type { IntegrationPlatformValue } from "@core/domain/entities/IntegrationApiKey.js";

/**
 * Raw Prisma row shape for type-safe mapping
 */
interface PrismaIntegrationSubscriptionRow {
  id: string;
  accountId: string;
  platform: string;
  event: string;
  targetUrl: string;
  active: boolean;
  createdAt: Date;
}

/**
 * @class PrismaIntegrationSubscriptionRepository
 * @description Adapter for IntegrationSubscriptionRepository using Prisma.
 *   Converts between Prisma database records and IntegrationSubscription domain entities.
 */
export class PrismaIntegrationSubscriptionRepository implements IntegrationSubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a single subscription by its unique ID.
   */
  async findById(id: string): Promise<IntegrationSubscription | null> {
    const row = await this.prisma.integrationSubscription.findUnique({
      where: { id },
    });

    if (!row) {
      return null;
    }

    return this.toDomain(row);
  }

  /**
   * @method findActiveByEvent
   * @description Finds all active subscriptions for a given event type.
   *   Used by the event dispatcher to fan out webhook deliveries.
   */
  async findActiveByEvent(event: string): Promise<IntegrationSubscription[]> {
    const rows = await this.prisma.integrationSubscription.findMany({
      where: {
        event,
        active: true,
      },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * @method findActiveByEventAndPlatform
   * @description Finds all active subscriptions for a given event filtered by platform.
   */
  async findActiveByEventAndPlatform(
    event: string,
    platform: IntegrationPlatformValue
  ): Promise<IntegrationSubscription[]> {
    const rows = await this.prisma.integrationSubscription.findMany({
      where: {
        event,
        platform,
        active: true,
      },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * @method findByAccountId
   * @description Finds all subscriptions belonging to an account.
   */
  async findByAccountId(accountId: string): Promise<IntegrationSubscription[]> {
    const rows = await this.prisma.integrationSubscription.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * @method save
   * @description Persists a new or updated subscription via upsert on id.
   */
  async save(sub: IntegrationSubscription): Promise<Result<void, Error>> {
    try {
      await this.prisma.integrationSubscription.upsert({
        where: { id: sub.id },
        create: {
          id: sub.id,
          accountId: sub.accountId,
          platform: sub.platform,
          event: sub.event,
          targetUrl: sub.targetUrl,
          active: sub.active,
          createdAt: sub.createdAt,
        },
        update: {
          active: sub.active,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new Error(
          `Failed to save IntegrationSubscription: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row to an IntegrationSubscription domain entity via reconstitute.
   */
  private toDomain(row: PrismaIntegrationSubscriptionRow): IntegrationSubscription {
    return IntegrationSubscription.reconstitute({
      id: row.id,
      accountId: row.accountId,
      platform: row.platform as IntegrationPlatformValue,
      event: row.event,
      targetUrl: row.targetUrl,
      active: row.active,
      createdAt: row.createdAt,
    });
  }
}
