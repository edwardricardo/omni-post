/**
 * @file CredentialManager.ts
 * @description Manages secure storage, retrieval, and refresh of provider credentials
 *              with credential status validation.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import type { ProviderId } from "../providers/providerAdapter.interface";
import { OrchestrationResult } from "@shared/orchestration";

interface ProviderCredentials {
  channelId: string;
  providerId: ProviderId;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

interface CredentialStatus {
  isValid: boolean;
  isExpired: boolean;
  expiresIn?: number;
  needsRefresh: boolean;
  lastValidated: Date;
}

export class CredentialManager {
  private prisma: PrismaClient;
  private redis: Redis;
  private credentialCache = new Map<string, ProviderCredentials>();

  constructor(dependencies: { prisma: PrismaClient; redis: Redis }) {
    this.prisma = dependencies.prisma;
    this.redis = dependencies.redis;
  }

  /**
   * Get credentials for a specific channel
   */
  async getCredentials(
    channelId: string,
    providerId: ProviderId
  ): Promise<OrchestrationResult<ProviderCredentials>> {
    try {
      const cacheKey = this.getCacheKey(channelId, providerId);

      // Check in-memory cache first
      const cached = this.credentialCache.get(cacheKey);
      if (cached) {
        return { ok: true, value: cached };
      }

      // Check Redis cache
      const redisKey = `credentials:${cacheKey}`;
      const cachedJson = await this.redis.get(redisKey);
      if (cachedJson) {
        const credentials = JSON.parse(cachedJson) as ProviderCredentials;
        this.credentialCache.set(cacheKey, credentials);
        return { ok: true, value: credentials };
      }

      // Fetch from database
      const channel = await this.prisma.channel.findUnique({
        where: {
          id: channelId,
        },
      });

      if (!channel) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Channel not found: ${channelId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Convert provider enum to ProviderId format (lowercase)
      const channelProviderId = channel.provider.toLowerCase() as ProviderId;
      if (channelProviderId !== providerId) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Provider mismatch: expected ${providerId}, got ${channelProviderId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Parse credentials from JSON field
      const credentialsData = channel.credentials as Record<string, unknown>;
      const accessToken =
        typeof credentialsData.accessToken === "string" ? credentialsData.accessToken : "";
      const refreshToken =
        typeof credentialsData.refreshToken === "string" ? credentialsData.refreshToken : undefined;
      const expiresAt =
        credentialsData.expiresAt instanceof Date
          ? credentialsData.expiresAt
          : typeof credentialsData.expiresAt === "string"
            ? new Date(credentialsData.expiresAt)
            : undefined;

      const credentials: ProviderCredentials = {
        channelId: channel.id,
        providerId: channelProviderId,
        accessToken,
        ...(refreshToken !== undefined && { refreshToken }),
        ...(expiresAt !== undefined && { expiresAt }),
        ...(credentialsData.metadata && typeof credentialsData.metadata === "object"
          ? { metadata: credentialsData.metadata as Record<string, unknown> }
          : {}),
      };

      // Cache the credentials
      await this.cacheCredentials(cacheKey, credentials);

      return { ok: true, value: credentials };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to get credentials: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Update credentials for a channel
   */
  async updateCredentials(
    channelId: string,
    updates: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: Date;
      scopes?: string[];
    }
  ): Promise<OrchestrationResult<void>> {
    try {
      // Get current channel data
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
      });

      if (!channel) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Channel not found: ${channelId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Merge with existing credentials
      const currentCredentials = channel.credentials as Record<string, unknown>;
      const updatedCredentials = {
        ...currentCredentials,
        ...(updates.accessToken !== undefined && { accessToken: updates.accessToken }),
        ...(updates.refreshToken !== undefined && { refreshToken: updates.refreshToken }),
        ...(updates.expiresAt !== undefined && { expiresAt: updates.expiresAt.toISOString() }),
        ...(updates.scopes !== undefined && { scopes: updates.scopes }),
      };

      // Update in database
      await this.prisma.channel.update({
        where: { id: channelId },
        data: {
          credentials: updatedCredentials,
        },
      });

      // Invalidate cache
      const channelProviderId = channel.provider.toLowerCase() as ProviderId;
      const cacheKey = this.getCacheKey(channelId, channelProviderId);
      this.credentialCache.delete(cacheKey);
      await this.redis.del(`credentials:${cacheKey}`);

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to update credentials: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Validate credentials status
   */
  async validateCredentials(
    channelId: string,
    providerId: ProviderId
  ): Promise<OrchestrationResult<CredentialStatus>> {
    try {
      const credentialsResult = await this.getCredentials(channelId, providerId);
      if (!credentialsResult.ok) {
        return {
          ok: false,
          error: credentialsResult.error,
        };
      }

      const credentials = credentialsResult.value;
      const now = new Date();
      const isExpired = credentials.expiresAt ? credentials.expiresAt <= now : false;
      const expiresIn = credentials.expiresAt
        ? Math.max(0, credentials.expiresAt.getTime() - now.getTime())
        : undefined;

      // Consider credentials needing refresh if they expire in less than 5 minutes
      const needsRefresh = expiresIn !== undefined && expiresIn < 300000;

      const status: CredentialStatus = {
        isValid: !isExpired && credentials.accessToken.length > 0,
        isExpired,
        ...(expiresIn !== undefined && { expiresIn }),
        needsRefresh,
        lastValidated: now,
      };

      return { ok: true, value: status };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to validate credentials: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Refresh credentials if supported by provider
   */
  async refreshCredentials(
    channelId: string,
    providerId: ProviderId
  ): Promise<OrchestrationResult<ProviderCredentials>> {
    try {
      const credentialsResult = await this.getCredentials(channelId, providerId);
      if (!credentialsResult.ok) {
        return {
          ok: false,
          error: credentialsResult.error,
        };
      }

      const credentials = credentialsResult.value;

      if (!credentials.refreshToken) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "No refresh token available",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Note: Actual refresh implementation would call provider OAuth endpoints
      // This is a placeholder that would be implemented per provider
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: "Credential refresh not implemented for this provider",
          retryable: false,
          occurredAt: new Date(),
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to refresh credentials: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Invalidate cached credentials
   */
  async invalidateCredentials(
    channelId: string,
    providerId: ProviderId
  ): Promise<OrchestrationResult<void>> {
    try {
      const cacheKey = this.getCacheKey(channelId, providerId);
      this.credentialCache.delete(cacheKey);
      await this.redis.del(`credentials:${cacheKey}`);

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to invalidate credentials: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Private methods
   */

  private getCacheKey(channelId: string, providerId: ProviderId): string {
    return `${channelId}:${providerId}`;
  }

  private async cacheCredentials(
    cacheKey: string,
    credentials: ProviderCredentials
  ): Promise<void> {
    // Store in memory
    this.credentialCache.set(cacheKey, credentials);

    // Store in Redis with 5 minute TTL
    await this.redis.setex(`credentials:${cacheKey}`, 300, JSON.stringify(credentials));
  }

  private generateId(): string {
    return `cred_${Date.now()}_${crypto.randomUUID().slice(0, 9)}`;
  }
}
