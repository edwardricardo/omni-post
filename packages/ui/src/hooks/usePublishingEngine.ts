"use client";

/**
 * @file usePublishingEngine.ts
 * @description Shared publishing engine hook unifying validation, threading, and scheduling
 *              logic for both client and admin apps.
 * @layer infrastructure
 */

import { useState, useMemo, useCallback } from "react";
import {
  getProviderConfig,
  validateContentForProvider,
  type ProviderMetadata,
} from "@shared/types";

export interface PublishResult {
  providerId: string;
  providerName: string;
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
  threadCount?: number;
}

export interface ValidationError {
  providerId: string;
  providerName: string;
  errors: string[];
}

export interface PublishingStats {
  totalProviders: number;
  threadsNeeded: number;
  totalPosts: number;
  estimatedTime: number;
  rateLimit: boolean;
}

export interface PublishingEngineOptions {
  content: string;
  mediaFiles: File[];
  selectedProviders: string[];
  scheduledDate?: Date;
  onProgress?: (progress: number, currentProvider: string) => void;
  onSuccess?: (results: PublishResult[]) => void;
  onError?: (error: Error) => void;
}

export interface PublishingEngineState {
  isPublishing: boolean;
  publishProgress: number;
  currentProvider: string;
  publishResults: PublishResult[];
  validationErrors: ValidationError[];
  publishingStats: PublishingStats;
}

/**
 * Hook for managing publishing workflow
 */
export function usePublishingEngine(options: PublishingEngineOptions) {
  const { content, mediaFiles, selectedProviders, scheduledDate, onProgress, onSuccess, onError } =
    options;

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(0);
  const [currentProvider, setCurrentProvider] = useState<string>("");
  const [publishResults, setPublishResults] = useState<PublishResult[]>([]);

  // ✅ Shared: Validate content for all selected providers
  const validationErrors = useMemo(() => {
    const errors: ValidationError[] = [];

    selectedProviders.forEach((providerId) => {
      const config = getProviderConfig(providerId);
      if (!config) return;

      const validation = validateContentForProvider(providerId, content, mediaFiles.length);
      if (!validation.valid) {
        errors.push({
          providerId,
          providerName: config.displayName || providerId,
          errors: validation.errors,
        });
      }
    });

    return errors;
  }, [selectedProviders, content, mediaFiles.length]);

  // ✅ Shared: Calculate publishing stats
  const publishingStats = useMemo((): PublishingStats => {
    const stats: PublishingStats = {
      totalProviders: selectedProviders.length,
      threadsNeeded: 0,
      totalPosts: 0,
      estimatedTime: 0,
      rateLimit: false,
    };

    selectedProviders.forEach((providerId) => {
      const config = getProviderConfig(providerId);
      if (!config) return;

      // Check if threading is needed
      if (config.capabilities.threading && content.length > config.limits.maxChars) {
        const segmentCount = Math.ceil(content.length / config.limits.maxChars);
        stats.threadsNeeded++;
        stats.totalPosts += segmentCount;
      } else {
        stats.totalPosts++;
      }

      // Check rate limits (simplified)
      if (config.limits.maxChars < 1000) {
        stats.rateLimit = true;
      }
    });

    // Estimate time based on provider count and complexity
    stats.estimatedTime = Math.ceil(
      stats.totalProviders * 2 + // 2 seconds per provider
        stats.threadsNeeded * 5 + // 5 extra seconds per thread
        (stats.rateLimit ? 30 : 0) // 30 seconds extra for rate limits
    );

    return stats;
  }, [selectedProviders, content]);

  // ✅ Shared: Publish to providers
  const publish = useCallback(
    async (apiEndpoint: string, postId?: string) => {
      if (validationErrors.length > 0) {
        const error = new Error("Please fix validation errors before publishing");
        onError?.(error);
        throw error;
      }

      if (selectedProviders.length === 0) {
        const error = new Error("Please select at least one platform to publish to");
        onError?.(error);
        throw error;
      }

      setIsPublishing(true);
      setPublishProgress(0);
      setPublishResults([]);

      const results: PublishResult[] = [];

      try {
        for (let i = 0; i < selectedProviders.length; i++) {
          const providerId = selectedProviders[i];
          if (!providerId) continue;

          const config = getProviderConfig(providerId);
          if (!config) continue;

          const providerDisplayName = config.displayName || providerId;
          setCurrentProvider(providerDisplayName);
          onProgress?.(Math.round(((i + 1) / selectedProviders.length) * 100), providerDisplayName);

          try {
            // Call publishing API
            const response = await fetch(apiEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                providerId,
                content,
                media: mediaFiles.map((f) => ({ name: f.name, type: f.type, size: f.size })),
                scheduledDate,
                postId,
              }),
            });

            const data = await response.json();

            if (response.ok && data.ok) {
              results.push({
                providerId,
                providerName: providerDisplayName,
                success: true,
                postId: data.postId,
                url: data.url,
                threadCount: data.threadCount,
              });
            } else {
              results.push({
                providerId,
                providerName: providerDisplayName,
                success: false,
                error: data.error || "Publishing failed",
              });
            }
          } catch (providerError) {
            results.push({
              providerId,
              providerName: providerDisplayName,
              success: false,
              error: providerError instanceof Error ? providerError.message : "Unknown error",
            });
          }

          // Update progress
          setPublishProgress(Math.round(((i + 1) / selectedProviders.length) * 100));
        }

        setPublishResults(results);
        onSuccess?.(results);
      } catch (error) {
        const publishError = error instanceof Error ? error : new Error("Publishing failed");
        onError?.(publishError);
        throw publishError;
      } finally {
        setIsPublishing(false);
        setCurrentProvider("");
      }
    },
    [
      validationErrors,
      selectedProviders,
      content,
      mediaFiles,
      scheduledDate,
      onProgress,
      onSuccess,
      onError,
    ]
  );

  // ✅ Shared: Get provider metadata
  const getSelectedProviderConfigs = useCallback((): ProviderMetadata[] => {
    return selectedProviders
      .map((id) => getProviderConfig(id))
      .filter((config): config is ProviderMetadata => config !== undefined);
  }, [selectedProviders]);

  // ✅ Shared: Check if ready to publish
  const canPublish = useMemo(() => {
    return (
      validationErrors.length === 0 &&
      selectedProviders.length > 0 &&
      content.trim().length > 0 &&
      !isPublishing
    );
  }, [validationErrors, selectedProviders, content, isPublishing]);

  return {
    // State
    isPublishing,
    publishProgress,
    currentProvider,
    publishResults,
    validationErrors,
    publishingStats,
    canPublish,

    // Actions
    publish,
    getSelectedProviderConfigs,

    // Utils
    reset: () => {
      setPublishProgress(0);
      setCurrentProvider("");
      setPublishResults([]);
    },
  };
}
