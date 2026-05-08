"use client";

/**
 * @file useProviders.ts
 * @description Canonical provider hook for the client app. Wraps the typed
 *              `apiClient.getProviders()` call (proxied through Next.js so
 *              auth cookies are forwarded correctly) and augments the raw
 *              backend response with domain-level helpers from the local
 *              provider registry — content validation, feature detection,
 *              optimal posting times, and provider config lookup.
 *
 *              This is the single canonical `useProviders` import path for
 *              components that need any of those helpers; `useApiProviders`
 *              in `lib/api/hooks.ts` remains available for callers that only
 *              need raw TanStack data without the helpers.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { Provider } from "@/lib/api/types";
import { providerRegistry, type ProviderConfig } from "@/lib/providers/registry";

/**
 * @interface UseProvidersResult
 * @description Public shape returned by `useProviders()`. Combines the live
 *              backend provider list with locally-known config from
 *              `providerRegistry`, plus convenience helpers commonly used by
 *              editor/publishing UI.
 */
interface UseProvidersResult {
  /** Backend providers as returned by `GET /providers`. */
  providers: Provider[];
  /** Static provider configs known by the local registry. */
  providerConfigs: ProviderConfig[];
  isLoading: boolean;
  error: Error | null;
  /** Subset of `providers` whose `isActive` flag is true. */
  enabledProviders: Provider[];
  /** Look up a registry config by provider id. */
  getProviderConfig: (providerId: string) => ProviderConfig | undefined;
  /** Validate content/media against a provider's registered constraints. */
  validateContent: (
    providerId: string,
    content: string,
    media?: File[]
  ) => {
    valid: boolean;
    errors: string[];
  };
  /** Whether a provider supports a given feature flag in its registry config. */
  supportsFeature: (providerId: string, feature: keyof ProviderConfig["features"]) => boolean;
  /** Optimal posting times for a provider on a given date. */
  getOptimalTimes: (providerId: string, date: Date) => string[];
}

/**
 * @hook useProviders
 * @description Fetches providers from the backend (through the proxy) and
 *              augments them with local registry helpers. See
 *              `UseProvidersResult` for the returned shape.
 */
export function useProviders(): UseProvidersResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ["providers"],
    queryFn: () => apiClient.getProviders(),
  });

  const providers: Provider[] = data?.providers ?? [];
  const providerConfigs = providerRegistry.getAllProviders();
  const enabledProviders = providers.filter((provider) => provider.isActive);

  const getProviderConfig = (providerId: string): ProviderConfig | undefined => {
    return providerRegistry.getProvider(providerId);
  };

  const validateContent = (providerId: string, content: string, media: File[] = []) => {
    return providerRegistry.validateContent(providerId, content, media);
  };

  const supportsFeature = (
    providerId: string,
    feature: keyof ProviderConfig["features"]
  ): boolean => {
    return providerRegistry.supportsFeature(providerId, feature);
  };

  const getOptimalTimes = (providerId: string, date: Date): string[] => {
    return providerRegistry.getOptimalTimes(providerId, date);
  };

  return {
    providers,
    providerConfigs,
    isLoading,
    error: error as Error | null,
    enabledProviders,
    getProviderConfig,
    validateContent,
    supportsFeature,
    getOptimalTimes,
  };
}

/**
 * @hook useProviderStatusColor
 * @description Tailwind class string for a registry-status badge color.
 */
export function useProviderStatusColor(status: "active" | "beta" | "coming_soon" | "maintenance") {
  switch (status) {
    case "active":
      return "text-green-600 bg-green-50 border-green-200";
    case "beta":
      return "text-blue-600 bg-blue-50 border-blue-200";
    case "coming_soon":
      return "text-gray-600 bg-gray-50 border-gray-200";
    case "maintenance":
      return "text-yellow-600 bg-yellow-50 border-yellow-200";
    default:
      return "text-gray-600 bg-gray-50 border-gray-200";
  }
}

/**
 * @hook useProviderStatusLabel
 * @description Human-readable label for a registry-status badge.
 */
export function useProviderStatusLabel(status: "active" | "beta" | "coming_soon" | "maintenance") {
  switch (status) {
    case "active":
      return "Active";
    case "beta":
      return "Beta";
    case "coming_soon":
      return "Coming Soon";
    case "maintenance":
      return "Maintenance";
    default:
      return "Unknown";
  }
}
