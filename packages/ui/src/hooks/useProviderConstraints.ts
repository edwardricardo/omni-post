"use client";

/**
 * @file useProviderConstraints.ts
 * @description React hook that resolves provider constraints (character/media limits) for admin
 *              or client contexts by fetching from the API or using locally enabled providers.
 * @layer infrastructure
 */
import { useState, useEffect, useMemo } from "react";
import { getProviderConfig } from "@shared/types";
import type { ProviderConstraints } from "../components/business/ContentEditorCore";

/**
 * Options for useProviderConstraints hook
 */
interface UseProviderConstraintsOptions {
  /**
   * For admin context: fetch from API using accountId and projectId
   */
  accountId?: string;
  projectId?: string;

  /**
   * For client context: provide enabled providers directly
   * (typically from useProviders() hook)
   */
  enabledProviders?: Array<{
    id: string;
    name: string;
    enabled: boolean;
  }>;

  /**
   * Optional provider registry for client context
   * (if not provided, will use getProviderConfig from @shared/types)
   */
  providerRegistry?: {
    getCharLimit: (providerId: string) => number;
    getMediaLimits: (providerId: string) => {
      maxFiles: number;
      supportedTypes: string[];
    };
    supportsFeature: (providerId: string, feature: string) => boolean;
  };
}

/**
 * Result from useProviderConstraints hook
 */
interface UseProviderConstraintsResult {
  providers: ProviderConstraints[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Helper functions for provider configuration
 * These centralize the logic previously duplicated across 4 components
 */
function getProviderMaxChars(providerId: string): number {
  const provider = getProviderConfig(providerId.toLowerCase());
  return provider?.limits.maxChars || 280;
}

function getProviderMaxMedia(providerId: string): number {
  const provider = getProviderConfig(providerId.toLowerCase());
  return provider?.limits.maxMediaPerPost || 1;
}

function getProviderAllowedMedia(providerId: string): string[] {
  const provider = getProviderConfig(providerId.toLowerCase());
  if (!provider) return ["image/*"];

  return provider.limits.allowedMedia.map((type: string) => {
    if (type === "gif") return "image/gif";
    return `${type}/*`;
  });
}

function hasThreadingCapability(providerId: string): boolean {
  const provider = getProviderConfig(providerId.toLowerCase());
  return provider?.capabilities.threading === true;
}

function hasSchedulingCapability(providerId: string): boolean {
  const provider = getProviderConfig(providerId.toLowerCase());
  return provider?.capabilities.schedule === true;
}

/**
 * Unified hook for fetching and transforming provider constraints.
 *
 * **Eliminates 120+ lines of duplicate code across 4 components:**
 * - AdminContentEditor
 * - UniversalContentEditor
 * - ClientContentEditor
 * - ContentEditor
 *
 * **Usage in Admin Context (API fetch):**
 * ```tsx
 * const { providers, isLoading } = useProviderConstraints({
 *   accountId: "123",
 *   projectId: "456"
 * });
 * ```
 *
 * **Usage in Client Context (with useProviders):**
 * ```tsx
 * const { enabledProviders } = useProviders();
 * const { providers, isLoading } = useProviderConstraints({
 *   enabledProviders,
 *   providerRegistry
 * });
 * ```
 *
 * @param options - Configuration for fetching provider constraints
 * @returns Provider constraints with loading/error states
 */
export function useProviderConstraints(
  options: UseProviderConstraintsOptions
): UseProviderConstraintsResult {
  const { accountId, projectId, enabledProviders, providerRegistry } = options;

  const [providers, setProviders] = useState<ProviderConstraints[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Admin context: Fetch from API
  useEffect(() => {
    if (accountId && projectId) {
      const fetchProviders = async () => {
        setIsLoading(true);
        setError(null);

        try {
          const response = await fetch(`/api/backend/auth/connections/${projectId}`);
          if (!response.ok) throw new Error("Failed to fetch providers");

          const data = await response.json();
          const providerConstraints: ProviderConstraints[] = data.connections.map(
            (conn: { providerId: string; providerName: string; status: string }) => ({
              id: conn.providerId.toLowerCase(),
              name: conn.providerId.toLowerCase(),
              displayName: conn.providerName,
              maxChars: getProviderMaxChars(conn.providerId),
              maxMediaFiles: getProviderMaxMedia(conn.providerId),
              allowedMediaTypes: getProviderAllowedMedia(conn.providerId),
              supportsThreading: hasThreadingCapability(conn.providerId),
              supportsScheduling: hasSchedulingCapability(conn.providerId),
              supportsHashtags: true, // Most providers support hashtags
              isConnected: conn.status === "CONNECTED",
            })
          );

          setProviders(providerConstraints);
        } catch (err) {
          const error = err instanceof Error ? err : new Error("Unknown error");
          setError(error);
        } finally {
          setIsLoading(false);
        }
      };

      fetchProviders();
    }
  }, [accountId, projectId]);

  // Client context: Transform from enabledProviders
  const clientProviders = useMemo(() => {
    if (!enabledProviders) return [];

    return enabledProviders.map((provider) => {
      const config = getProviderConfig(provider.name);

      // Use providerRegistry if provided, otherwise fall back to helper functions
      const charLimit = providerRegistry
        ? providerRegistry.getCharLimit(provider.name)
        : getProviderMaxChars(provider.name);

      const mediaLimits = providerRegistry
        ? providerRegistry.getMediaLimits(provider.name)
        : {
            maxFiles: getProviderMaxMedia(provider.name),
            supportedTypes: getProviderAllowedMedia(provider.name),
          };

      const supportsThreading = providerRegistry
        ? providerRegistry.supportsFeature(provider.name, "threads")
        : hasThreadingCapability(provider.name);

      const supportsScheduling = providerRegistry
        ? providerRegistry.supportsFeature(provider.name, "scheduling")
        : hasSchedulingCapability(provider.name);

      const supportsHashtags = providerRegistry
        ? providerRegistry.supportsFeature(provider.name, "hashtags")
        : true;

      return {
        id: provider.name,
        name: provider.name,
        displayName: config?.displayName || provider.name,
        ...(config?.color && { color: config.color }),
        maxChars: charLimit,
        maxMediaFiles: mediaLimits.maxFiles,
        allowedMediaTypes: mediaLimits.supportedTypes,
        supportsThreading,
        supportsScheduling,
        supportsHashtags,
        isConnected: true,
      };
    });
  }, [enabledProviders, providerRegistry]);

  // Return API-fetched providers if in admin context, otherwise client providers
  if (accountId && projectId) {
    return { providers, isLoading, error };
  }

  return { providers: clientProviders, isLoading: false, error: null };
}
