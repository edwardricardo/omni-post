/**
 * @file PrismaChannelRepository.ts
 * @description Prisma adapter implementing ChannelRepository. Receives PrismaClient via
 *              constructor injection. Runtime status fields are reconstructed with safe
 *              defaults when loading from persistence.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  Channel,
  ChannelId,
  ProjectId,
  Provider,
  EntityNotFoundError,
} from "../../domain/index.js";
import type { ChannelCredentials } from "../../domain/entities/Channel.js";
import { CONNECTION_STATUS } from "../../domain/entities/Channel.js";
import type { ChannelRepository } from "../../domain/repositories/ChannelRepository.js";

/**
 * Maps a raw JSON credentials blob from Prisma to the typed ChannelCredentials
 */
function parseCredentials(raw: unknown): ChannelCredentials {
  const blob = raw as Record<string, unknown>;
  return {
    accessToken: String(blob.accessToken ?? ""),
    ...(blob.refreshToken !== undefined && { refreshToken: String(blob.refreshToken) }),
    ...(blob.expiresAt !== undefined && { expiresAt: new Date(blob.expiresAt as string) }),
    ...(blob.tokenType !== undefined && { tokenType: String(blob.tokenType) }),
    ...(Array.isArray(blob.scope) && { scope: (blob.scope as unknown[]).map(String) }),
  };
}

/**
 * Maps a Prisma Channel row to the Channel domain entity
 */
function toDomain(row: {
  id: string;
  projectId: string;
  provider: string;
  handle: string;
  credentials: unknown;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Channel {
  const id = ChannelId.fromStringUnsafe(row.id);
  const projectId = ProjectId.fromStringUnsafe(row.projectId);
  const providerResult = Provider.fromString(row.provider);

  if (!providerResult.ok) {
    // If provider is unknown, use a placeholder so the channel can still be loaded.
    // This is defensive — the DB enforces a valid Provider enum so this path is unlikely.
    throw new Error(`Invalid provider value "${row.provider}" for channel ${row.id}`);
  }

  return Channel.reconstitute(id, {
    projectId,
    provider: providerResult.value,
    handle: row.handle,
    credentials: parseCredentials(row.credentials),
    isPrimary: row.isPrimary,
    // Status, errorCount, etc. are not persisted — default to healthy state
    status: CONNECTION_STATUS.CONNECTED,
    errorCount: 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * PrismaChannelRepository - Implements ChannelRepository using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture — it implements
 * the repository PORT defined in the domain layer.
 *
 * @example
 * const repo = new PrismaChannelRepository(prisma);
 * const result = await repo.findById(ChannelId.fromString("..."));
 */
export class PrismaChannelRepository implements ChannelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find a channel by its ID (excludes soft-deleted channels)
   */
  async findById(id: ChannelId): Promise<Result<Channel, EntityNotFoundError>> {
    const row = await this.prisma.channel.findFirst({
      where: { id: id.value, deletedAt: null },
    });

    if (!row) {
      return err(new EntityNotFoundError("Channel", id.value));
    }

    return ok(toDomain(row));
  }

  /**
   * Find all channels belonging to a project (excludes soft-deleted channels)
   */
  async findByProjectId(projectId: ProjectId): Promise<Channel[]> {
    const rows = await this.prisma.channel.findMany({
      where: { projectId: projectId.value, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDomain);
  }

  /**
   * Find all channels for a specific (project, provider) pair (excludes soft-deleted)
   */
  async findByProjectAndProvider(projectId: ProjectId, provider: Provider): Promise<Channel[]> {
    const rows = await this.prisma.channel.findMany({
      where: {
        projectId: projectId.value,
        provider: provider.type as import("@infra/prisma").Provider,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDomain);
  }

  /**
   * Find the primary channel for a (project, provider) pair, or NotFound when none exists
   */
  async findPrimaryByProjectAndProvider(
    projectId: ProjectId,
    provider: Provider
  ): Promise<Result<Channel, EntityNotFoundError>> {
    const row = await this.prisma.channel.findFirst({
      where: {
        projectId: projectId.value,
        provider: provider.type as import("@infra/prisma").Provider,
        isPrimary: true,
        deletedAt: null,
      },
    });

    if (!row) {
      return err(new EntityNotFoundError("Channel", `${projectId.value}/${provider.type}/primary`));
    }

    return ok(toDomain(row));
  }

  /**
   * Save a channel (create or update via upsert)
   */
  async save(channel: Channel): Promise<Result<void, Error>> {
    try {
      const credentialsData: Record<string, Prisma.InputJsonValue> = {
        accessToken: channel.credentials.accessToken,
        ...(channel.credentials.refreshToken !== undefined && {
          refreshToken: channel.credentials.refreshToken,
        }),
        ...(channel.credentials.expiresAt !== undefined && {
          expiresAt: channel.credentials.expiresAt.toISOString(),
        }),
        ...(channel.credentials.tokenType !== undefined && {
          tokenType: channel.credentials.tokenType,
        }),
        ...(channel.credentials.scope !== undefined && {
          scope: channel.credentials.scope as Prisma.InputJsonValue,
        }),
      };
      const credentials = credentialsData as Prisma.InputJsonValue;

      await this.prisma.channel.upsert({
        where: { id: channel.id.value },
        create: {
          id: channel.id.value,
          projectId: channel.projectId.value,
          provider: channel.provider.type as import("@infra/prisma").Provider,
          handle: channel.handle,
          credentials,
          isPrimary: channel.isPrimary,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt,
        },
        update: {
          handle: channel.handle,
          credentials,
          isPrimary: channel.isPrimary,
          updatedAt: channel.updatedAt,
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Soft-delete a channel (sets deletedAt = now).
   * The channel becomes invisible to all standard find queries.
   */
  async delete(id: ChannelId): Promise<Result<void, EntityNotFoundError>> {
    const row = await this.prisma.channel.findFirst({
      where: { id: id.value, deletedAt: null },
      select: { id: true },
    });

    if (!row) {
      return err(new EntityNotFoundError("Channel", id.value));
    }

    await this.prisma.channel.update({
      where: { id: id.value },
      data: { deletedAt: new Date() },
    });
    return ok(undefined);
  }

  /**
   * Hard-delete a channel and all its data (irreversible).
   * SUPER_ADMIN only. Cascades to publishLogs, analytics.
   */
  async hardDelete(id: ChannelId): Promise<Result<void, EntityNotFoundError>> {
    // Use findFirst to detect even soft-deleted channels
    const row = await this.prisma.channel.findFirst({
      where: { id: id.value },
      select: { id: true },
    });

    if (!row) {
      return err(new EntityNotFoundError("Channel", id.value));
    }

    const channelId = id.value;

    // Cascade in FK-safe order
    await this.prisma.publishLog.deleteMany({ where: { channelId } });
    await this.prisma.analytics.deleteMany({ where: { channelId } });
    await this.prisma.channel.delete({ where: { id: channelId } });

    return ok(undefined);
  }
}
