/**
 * @file PrismaChannelRepository.ts
 * @description Prisma adapter implementing ChannelRepository. Receives PrismaClient via
 *              constructor injection. Runtime status fields are reconstructed with safe
 *              defaults when loading from persistence.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
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
import type { ChannelCredentialsCrypto } from "../../security/ChannelCredentialsCrypto.js";

interface ChannelRow {
  id: string;
  projectId: string;
  provider: string;
  handle: string;
  providerAccountId: string | null;
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
  isPrimary: boolean;
  needsReauth: boolean;
  authFailedAt: Date | null;
  authFailureReason: string | null;
  accountName: string | null;
  profileImage: string | null;
  connectedAt: Date | null;
  expiredAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps a decrypted JSON credentials blob to the typed ChannelCredentials.
 */
function parseCredentials(blob: Record<string, unknown>): ChannelCredentials {
  return {
    accessToken: String(blob.accessToken ?? ""),
    ...(blob.refreshToken !== undefined && { refreshToken: String(blob.refreshToken) }),
    ...(blob.expiresAt !== undefined && { expiresAt: new Date(blob.expiresAt as string) }),
    ...(blob.tokenType !== undefined && { tokenType: String(blob.tokenType) }),
    ...(Array.isArray(blob.scope) && { scope: (blob.scope as unknown[]).map(String) }),
  };
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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly credentialsCrypto: ChannelCredentialsCrypto
  ) {}

  /**
   * Maps a Prisma Channel row to the Channel domain entity, decrypting
   * the credentials envelope through the injected crypto helper.
   */
  private toDomain(row: ChannelRow): Channel {
    const id = ChannelId.fromStringUnsafe(row.id);
    const projectId = ProjectId.fromStringUnsafe(row.projectId);
    const providerResult = Provider.fromString(row.provider);

    if (!providerResult.ok) {
      throw new Error(`Invalid provider value "${row.provider}" for channel ${row.id}`);
    }

    const decrypted = this.credentialsCrypto.decrypt(row, {
      recordId: row.id,
      caller: "PrismaChannelRepository.toDomain",
    });
    // Derive runtime status from persisted lifecycle flags. `expiredAt` is
    // the latest natural-expiry timestamp (kept as audit history);
    // `needsReauth` is admin-triggered. Both nullish = CONNECTED. Order
    // matters: needsReauth wins (admin intent overrides natural lifecycle).
    // Loose-equality `!= null` covers both production rows (null when unset)
    // and test fixtures (undefined when mocks don't set the column).
    const derivedStatus = row.needsReauth
      ? CONNECTION_STATUS.ERROR
      : row.expiredAt != null
        ? CONNECTION_STATUS.EXPIRED
        : CONNECTION_STATUS.CONNECTED;

    return Channel.reconstitute(id, {
      projectId,
      provider: providerResult.value,
      handle: row.handle,
      credentials: parseCredentials(decrypted),
      isPrimary: row.isPrimary,
      status: derivedStatus,
      errorCount: 0,
      needsReauth: row.needsReauth,
      ...(row.authFailedAt !== null && { authFailedAt: row.authFailedAt }),
      ...(row.authFailureReason !== null && { authFailureReason: row.authFailureReason }),
      ...(row.accountName !== null && { accountName: row.accountName }),
      ...(row.profileImage !== null && { profileImage: row.profileImage }),
      ...(row.connectedAt !== null && { connectedAt: row.connectedAt }),
      ...(row.expiredAt !== null && { expiredAt: row.expiredAt }),
      ...(row.lastUsedAt !== null && { lastUsedAt: row.lastUsedAt }),
      ...(row.providerAccountId !== null && { providerAccountId: row.providerAccountId }),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

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

    return ok(this.toDomain(row));
  }

  /**
   * Find all channels belonging to a project (excludes soft-deleted channels)
   */
  async findByProjectId(projectId: ProjectId): Promise<Channel[]> {
    const rows = await this.prisma.channel.findMany({
      where: { projectId: projectId.value, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((r) => this.toDomain(r));
  }

  /**
   * Lightweight ownership lookup — returns just the channel IDs without
   * touching credentials. Avoids the decryption work (and the failure mode
   * on placeholder fixtures) that toDomain() does for the full Channel.
   */
  async findIdsByProjectId(projectId: ProjectId): Promise<ChannelId[]> {
    const rows = await this.prisma.channel.findMany({
      where: { projectId: projectId.value, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => ChannelId.fromStringUnsafe(r.id));
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

    return rows.map((r) => this.toDomain(r));
  }

  /**
   * Resolve "existing Channel for this OAuth grant?" via the (projectId,
   * provider, providerAccountId) tuple. Used by the OAuth callback in
   * `apps/api/src/auth/providerOAuthFlow.ts`. Excludes soft-deleted rows so
   * a tenant can disconnect + reconnect to a fresh row rather than reviving
   * a deleted one.
   */
  async findByProjectProviderAccount(
    projectId: ProjectId,
    provider: Provider,
    providerAccountId: string
  ): Promise<Channel | null> {
    const row = await this.prisma.channel.findFirst({
      where: {
        projectId: projectId.value,
        provider: provider.type as import("@infra/prisma").Provider,
        providerAccountId,
        deletedAt: null,
      },
    });
    if (!row) return null;
    return this.toDomain(row);
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

    return ok(this.toDomain(row));
  }

  /**
   * Batch usage lookup: count successful (`LogStatus.OK`) PublishLog rows
   * grouped by channelId for the current calendar month (UTC). Single SQL
   * roundtrip via Prisma `groupBy` — avoids per-channel N+1 in list views.
   * Channels with zero posts this month are absent from the returned map.
   */
  async findUsageByChannelIds(
    channelIds: string[]
  ): Promise<Map<string, { postsThisMonth: number }>> {
    const result = new Map<string, { postsThisMonth: number }>();
    if (channelIds.length === 0) return result;

    const now = new Date();
    const startOfMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const grouped = await this.prisma.publishLog.groupBy({
      by: ["channelId"],
      where: {
        channelId: { in: channelIds },
        status: "OK",
        createdAt: { gte: startOfMonthUtc },
      },
      _count: { _all: true },
    });

    for (const row of grouped) {
      result.set(row.channelId, { postsThisMonth: row._count._all });
    }
    return result;
  }

  /**
   * Save a channel (create or update via upsert). Credentials are encrypted
   * before persistence — plaintext never touches the upsert payload.
   */
  async save(channel: Channel): Promise<Result<void, Error>> {
    try {
      const plaintextCreds: Record<string, unknown> = {
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
          scope: channel.credentials.scope,
        }),
      };
      const enc = this.credentialsCrypto.encrypt(plaintextCreds, {
        recordId: channel.id.value,
        caller: "PrismaChannelRepository.save",
      });

      await this.prisma.channel.upsert({
        where: { id: channel.id.value },
        create: {
          id: channel.id.value,
          projectId: channel.projectId.value,
          provider: channel.provider.type as import("@infra/prisma").Provider,
          handle: channel.handle,
          providerAccountId: channel.providerAccountId ?? null,
          credentialsCiphertext: enc.credentialsCiphertext,
          credentialsIv: enc.credentialsIv,
          credentialsAuthTag: enc.credentialsAuthTag,
          credentialsKeyVersion: enc.credentialsKeyVersion,
          isPrimary: channel.isPrimary,
          needsReauth: channel.needsReauth,
          authFailedAt: channel.authFailedAt ?? null,
          authFailureReason: channel.authFailureReason ?? null,
          accountName: channel.accountName ?? null,
          profileImage: channel.profileImage ?? null,
          connectedAt: channel.connectedAt ?? null,
          expiredAt: channel.expiredAt ?? null,
          lastUsedAt: channel.lastUsedAt ?? null,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt,
        },
        update: {
          handle: channel.handle,
          providerAccountId: channel.providerAccountId ?? null,
          credentialsCiphertext: enc.credentialsCiphertext,
          credentialsIv: enc.credentialsIv,
          credentialsAuthTag: enc.credentialsAuthTag,
          credentialsKeyVersion: enc.credentialsKeyVersion,
          isPrimary: channel.isPrimary,
          needsReauth: channel.needsReauth,
          authFailedAt: channel.authFailedAt ?? null,
          authFailureReason: channel.authFailureReason ?? null,
          accountName: channel.accountName ?? null,
          profileImage: channel.profileImage ?? null,
          connectedAt: channel.connectedAt ?? null,
          expiredAt: channel.expiredAt ?? null,
          lastUsedAt: channel.lastUsedAt ?? null,
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

  /**
   * Bulk-flag every active (non-soft-deleted) channel for a provider with
   * `needsReauth = true`, `authFailedAt = now`, `authFailureReason = reason`.
   * Documented exception to the per-entity markForReauth() pattern — see
   * ChannelRepository port docs.
   */
  async bulkMarkForReauthByProvider(
    provider: Provider,
    reason: string
  ): Promise<{ count: number; channelIds: string[] }> {
    const providerType = provider.type as import("@infra/prisma").Provider;
    const now = new Date();
    // updateManyAndReturn (Prisma 6.2.0+) uses Postgres RETURNING under the
    // hood — single SQL roundtrip + atomic, no race window between SELECT
    // and UPDATE. Replaces legacy findMany+updateMany 2-query pattern.
    const updated = await this.prisma.channel.updateManyAndReturn({
      where: { provider: providerType, deletedAt: null, needsReauth: false },
      data: {
        needsReauth: true,
        authFailedAt: now,
        authFailureReason: reason,
        updatedAt: now,
      },
      select: { id: true },
    });
    return { count: updated.length, channelIds: updated.map((r) => r.id) };
  }

  /**
   * Bulk-soft-delete every active channel for a provider (sets deletedAt).
   * Returns affected channelIds for audit. Destructive — tenants reconnect
   * from scratch on next session.
   */
  async bulkSoftDeleteByProvider(
    provider: Provider
  ): Promise<{ count: number; channelIds: string[] }> {
    const providerType = provider.type as import("@infra/prisma").Provider;
    const now = new Date();
    const updated = await this.prisma.channel.updateManyAndReturn({
      where: { provider: providerType, deletedAt: null },
      data: { deletedAt: now, updatedAt: now },
      select: { id: true },
    });
    return { count: updated.length, channelIds: updated.map((r) => r.id) };
  }
}
