/**
 * @file PrismaApiKeyRepository.ts
 * @description Prisma adapter implementing ApiKeyRepository for API key management.
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  ApiKeyRepository,
  DomainApiKey,
  CreateApiKeyData,
} from "@core/domain/repositories/ApiKeyRepository.js";
import { ApiKeyNotFoundError } from "@core/domain/repositories/ApiKeyRepository.js";

// ─── Mapper ─────────────────────────────────────────────────────────────────

function toDomain(row: {
  id: string;
  accountId: string;
  name: string;
  prefix: string;
  keyHash: string;
  permissions: string[];
  rateLimit: number;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  isActive: boolean;
  rotationSchedule: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DomainApiKey {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    prefix: row.prefix,
    keyHash: row.keyHash,
    permissions: row.permissions,
    rateLimit: row.rateLimit,
    expiresAt: row.expiresAt ?? undefined,
    lastUsedAt: row.lastUsedAt ?? undefined,
    isActive: row.isActive,
    rotationSchedule: row.rotationSchedule ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Repository ──────────────────────────────────────────────────────────────

/**
 * PrismaApiKeyRepository — Adapter implementing ApiKeyRepository port
 *
 * This is the only place in the codebase that knows about the Prisma `ApiKey` model.
 */
export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Result<DomainApiKey, ApiKeyNotFoundError>> {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!row) return err(new ApiKeyNotFoundError(id));
    return ok(toDomain(row));
  }

  async findByAccountId(accountId: string): Promise<DomainApiKey[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { accountId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async findActiveByPrefix(prefix: string): Promise<DomainApiKey | null> {
    const row = await this.prisma.apiKey.findFirst({
      where: {
        prefix,
        isActive: true,
      },
    });
    return row ? toDomain(row) : null;
  }

  async create(data: CreateApiKeyData): Promise<DomainApiKey> {
    const row = await this.prisma.apiKey.create({
      data: {
        accountId: data.accountId,
        name: data.name,
        prefix: data.prefix,
        keyHash: data.keyHash,
        permissions: data.permissions,
        rateLimit: data.rateLimit,
        ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt }),
        ...(data.rotationSchedule !== undefined && { rotationSchedule: data.rotationSchedule }),
      },
    });
    return toDomain(row);
  }

  async recordUsage(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async deactivate(id: string): Promise<Result<void, ApiKeyNotFoundError>> {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) return err(new ApiKeyNotFoundError(id));

    await this.prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });
    return ok(undefined);
  }

  async rotate(
    id: string,
    newPrefix: string,
    newKeyHash: string
  ): Promise<Result<DomainApiKey, ApiKeyNotFoundError>> {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) return err(new ApiKeyNotFoundError(id));

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        prefix: newPrefix,
        keyHash: newKeyHash,
        updatedAt: new Date(),
      },
    });
    return ok(toDomain(updated));
  }

  async deleteByAccountId(accountId: string): Promise<void> {
    await this.prisma.apiKey.deleteMany({ where: { accountId } });
  }
}
