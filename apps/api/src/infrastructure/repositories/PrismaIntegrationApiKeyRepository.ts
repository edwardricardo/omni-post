/**
 * @file PrismaIntegrationApiKeyRepository.ts
 * @description Infrastructure adapter implementing IntegrationApiKeyRepository port
 *   using Prisma ORM. Maps between Prisma database types and IntegrationApiKey
 *   domain entities via reconstitute().
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { IntegrationApiKeyRepository } from "@core/domain/repositories/IntegrationApiKeyRepository.js";
import {
  IntegrationApiKey,
  type IntegrationPlatformValue,
} from "@core/domain/entities/IntegrationApiKey.js";

/**
 * Raw Prisma row shape for type-safe mapping
 */
interface PrismaIntegrationApiKeyRow {
  id: string;
  accountId: string;
  platform: string;
  keyHash: string;
  keyPrefix: string;
  label: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

/**
 * @class PrismaIntegrationApiKeyRepository
 * @description Adapter for IntegrationApiKeyRepository using Prisma.
 *   Converts between Prisma database records and IntegrationApiKey domain entities.
 */
export class PrismaIntegrationApiKeyRepository implements IntegrationApiKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a single API key by its unique ID.
   */
  async findById(id: string): Promise<IntegrationApiKey | null> {
    const row = await this.prisma.integrationApiKey.findUnique({
      where: { id },
    });

    if (!row) {
      return null;
    }

    return this.toDomain(row);
  }

  /**
   * @method findActiveByAccountId
   * @description Finds all active (non-revoked) API keys belonging to an account.
   */
  async findActiveByAccountId(accountId: string): Promise<IntegrationApiKey[]> {
    const rows = await this.prisma.integrationApiKey.findMany({
      where: {
        accountId,
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * @method findByKeyPrefix
   * @description Finds API keys by their visible prefix.
   *   Used during authentication to narrow candidates before hash verification.
   */
  async findByKeyPrefix(prefix: string): Promise<IntegrationApiKey[]> {
    const rows = await this.prisma.integrationApiKey.findMany({
      where: {
        keyPrefix: prefix,
        revokedAt: null,
      },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * @method save
   * @description Persists a new or updated API key via upsert on id.
   */
  async save(key: IntegrationApiKey): Promise<Result<void, Error>> {
    try {
      await this.prisma.integrationApiKey.upsert({
        where: { id: key.id },
        create: {
          id: key.id,
          accountId: key.accountId,
          platform: key.platform,
          keyHash: key.keyHash,
          keyPrefix: key.keyPrefix,
          label: key.label,
          lastUsedAt: key.lastUsedAt,
          createdAt: key.createdAt,
          revokedAt: key.revokedAt,
        },
        update: {
          label: key.label,
          lastUsedAt: key.lastUsedAt,
          revokedAt: key.revokedAt,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new Error(
          `Failed to save IntegrationApiKey: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method countActiveByAccountId
   * @description Counts the number of active (non-revoked) keys for an account.
   */
  async countActiveByAccountId(accountId: string): Promise<number> {
    return this.prisma.integrationApiKey.count({
      where: {
        accountId,
        revokedAt: null,
      },
    });
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row to an IntegrationApiKey domain entity via reconstitute.
   */
  private toDomain(row: PrismaIntegrationApiKeyRow): IntegrationApiKey {
    return IntegrationApiKey.reconstitute({
      id: row.id,
      accountId: row.accountId,
      platform: row.platform as IntegrationPlatformValue,
      keyHash: row.keyHash,
      keyPrefix: row.keyPrefix,
      label: row.label,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
    });
  }
}
