/**
 * @file providerService.ts
 * @description Provider business logic service handling connection management, capability
 *              queries, and content validation with consistent error handling and logging.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { BaseService } from "../services/BaseService.js";
import { providerRegistry } from "./providerRegistry.js";
import type { Result, ProviderCapabilities } from "@shared/types";

export type ProviderCapability =
  | "publish"
  | "schedule"
  | "analytics"
  | "comments"
  | "replies"
  | "threading"
  | "stories"
  | "reels"
  | "carousel";

/** Shape returned by getConnectionsByProjectId */
export interface ProviderConnectionInfo {
  providerId: string;
  connected: boolean;
  accountName: string;
  connectedAt: string;
  lastUsed: string | null;
}

/**
 * Provider Service
 * Handles provider metadata, capabilities, and registry operations
 */
export class ProviderService extends BaseService {
  constructor(private readonly prisma: PrismaClient) {
    super("ProviderService");
  }

  /**
   * Get all registered providers
   */
  async getAllProviders() {
    return this.execute({ operation: "getAllProviders" }, async () => {
      const providers = providerRegistry.getAllProviders();
      return {
        providers,
        total: providers.length,
      };
    });
  }

  /**
   * Get only active providers
   */
  async getActiveProviders() {
    return this.execute({ operation: "getActiveProviders" }, async () => {
      const providers = providerRegistry.getActiveProviders();
      return {
        providers,
        total: providers.length,
      };
    });
  }

  /**
   * Get providers filtered by capability
   */
  async getProvidersByCapability(capability: ProviderCapability) {
    return this.execute(
      { operation: "getProvidersByCapability", metadata: { capability } },
      async () => {
        const providers = providerRegistry.getProvidersByCapability(
          capability as keyof ProviderCapabilities
        );
        return {
          capability,
          providers,
          total: providers.length,
        };
      }
    );
  }

  /**
   * Get single provider by ID
   * Returns null when the provider does not exist
   */
  async getProviderById(providerId: string) {
    return this.execute({ operation: "getProviderById", metadata: { providerId } }, async () => {
      const provider = providerRegistry.getProvider(providerId);
      return provider ?? null;
    });
  }

  /**
   * Validate provider constraints for content
   */
  async validateProviderConstraints(
    providerId: string,
    content: {
      text?: string;
      mediaCount?: number;
      mediaTypes?: string[];
    }
  ): Promise<Result<{ valid: boolean; errors?: string[] }, string>> {
    return this.executeWithErrorHandling(
      { operation: "validateProviderConstraints", metadata: { providerId } },
      async () => {
        const provider = providerRegistry.getProvider(providerId);

        if (!provider) {
          throw new Error(`Provider not found: ${providerId}`);
        }

        const errors: string[] = [];

        // Validate text length
        if (content.text && provider.limits?.maxChars) {
          if (content.text.length > provider.limits.maxChars) {
            errors.push(`Text exceeds maximum length of ${provider.limits.maxChars} characters`);
          }
        }

        // Validate media count
        if (content.mediaCount && provider.limits?.maxMediaPerPost) {
          if (content.mediaCount > provider.limits.maxMediaPerPost) {
            errors.push(`Media count exceeds maximum of ${provider.limits.maxMediaPerPost} files`);
          }
        }

        // Validate media types
        if (content.mediaTypes && provider.limits?.allowedMedia) {
          const unsupportedTypes = content.mediaTypes.filter(
            (type) => !provider.limits?.allowedMedia.includes(type)
          );
          if (unsupportedTypes.length > 0) {
            errors.push(`Unsupported media types: ${unsupportedTypes.join(", ")}`);
          }
        }

        return {
          valid: errors.length === 0,
          ...(errors.length > 0 && { errors }),
        };
      }
    );
  }

  /**
   * Get provider configuration and limits
   */
  async getProviderConfig(providerId: string) {
    return this.execute({ operation: "getProviderConfig", metadata: { providerId } }, async () => {
      const provider = providerRegistry.getProvider(providerId);

      if (!provider) {
        throw new Error(`Provider not found: ${providerId}`);
      }

      return {
        id: provider.id,
        name: provider.name,
        displayName: provider.displayName,
        capabilities: provider.capabilities,
        limits: provider.limits,
      };
    });
  }

  /**
   * Get provider connections for a project by querying the Channel table.
   * Each channel represents a connected social-media account for a provider.
   * Also fetches the most recent publish log per channel to populate lastUsed.
   */
  async getConnectionsByProjectId(projectId: string): Promise<ProviderConnectionInfo[]> {
    return this.execute(
      { operation: "getConnectionsByProjectId", metadata: { projectId } },
      async () => {
        const channels = await this.prisma.channel.findMany({
          where: { projectId, deletedAt: null },
          select: {
            id: true,
            provider: true,
            handle: true,
            createdAt: true,
            publishLogs: {
              select: { createdAt: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
          orderBy: { createdAt: "asc" },
        });

        return channels.map((ch) => {
          const lastLog = ch.publishLogs[0];
          return {
            providerId: ch.provider.toLowerCase(),
            connected: true,
            accountName: ch.handle,
            connectedAt: ch.createdAt.toISOString(),
            ...(lastLog ? { lastUsed: lastLog.createdAt.toISOString() } : { lastUsed: null }),
          };
        });
      }
    );
  }
}
