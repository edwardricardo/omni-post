"use client";

/**
 * @file useProviders.ts
 * @description Custom hooks for accessing social media provider data, including content validation, feature detection, optimal posting times, and status styling helpers.
 */

import { useQuery } from "@tanstack/react-query";
import { providerRegistry, type ProviderConfig } from "@/lib/providers/registry";

interface Provider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface UseProvidersResult {
  providers: Provider[];
  providerConfigs: ProviderConfig[];
  isLoading: boolean;
  error: Error | null;
  enabledProviders: Provider[];
  getProviderConfig: (providerId: string) => ProviderConfig | undefined;
  validateContent: (
    providerId: string,
    content: string,
    media?: File[]
  ) => {
    valid: boolean;
    errors: string[];
  };
  supportsFeature: (providerId: string, feature: keyof ProviderConfig["features"]) => boolean;
  getOptimalTimes: (providerId: string, date: Date) => string[];
}

export function useProviders(): UseProvidersResult {
  const {
    data: providers = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["providers"],
    queryFn: async () => {
      const response = await fetch("/api/providers");
      if (!response.ok) {
        throw new Error("Failed to fetch providers");
      }
      return response.json();
    },
  });

  // Get all available provider configurations
  const providerConfigs = providerRegistry.getAllProviders();

  // Filter enabled providers
  const enabledProviders = providers.filter((provider: Provider) => provider.enabled);

  // Helper functions
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
    error,
    enabledProviders,
    getProviderConfig,
    validateContent,
    supportsFeature,
    getOptimalTimes,
  };
}

// Custom hook to get provider status color
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

// Custom hook to get provider status label
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
