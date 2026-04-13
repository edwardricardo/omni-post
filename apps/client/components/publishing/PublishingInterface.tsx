"use client";

/**
 * @file PublishingInterface.tsx
 * @component PublishingInterface
 * @description Publishing execution component that validates content per provider,
 * displays progress during multi-platform publishing, and shows per-provider results.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Separator } from "@packages/ui";
import { Progress } from "@packages/ui";
import { Alert, AlertDescription } from "@packages/ui";
import {
  Clock,
  Send,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Eye,
  BarChart3,
  ExternalLink,
} from "lucide-react";
import { useProviders } from "@/lib/hooks/useProviders";
import { providerRegistry } from "@/lib/providers/registry";
import { useToast } from "@packages/ui";
import { apiClient } from "@/lib/api";

interface PublishingInterfaceProps {
  content: string;
  mediaFiles: File[];
  selectedProviders: string[];
  scheduledDate?: Date;
  postId?: string;
  onPublishSuccess?: (results: PublishResult[]) => void;
  onPublishError?: (error: Error) => void;
}

interface PublishResult {
  providerId: string;
  providerName: string;
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
  threadCount?: number;
}

interface ValidationError {
  providerId: string;
  providerName: string;
  errors: string[];
}

export function PublishingInterface({
  content,
  mediaFiles,
  selectedProviders,
  scheduledDate,
  postId,
  onPublishSuccess,
  onPublishError,
}: PublishingInterfaceProps) {
  const { enabledProviders: _enabledProviders, getProviderConfig } = useProviders();
  const { success, error: showError, info } = useToast();

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(0);
  const [currentProvider, setCurrentProvider] = useState<string>("");
  const [publishResults, setPublishResults] = useState<PublishResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Validate content for all selected providers
  const validationResults = useMemo(() => {
    const errors: ValidationError[] = [];

    selectedProviders.forEach((providerId) => {
      const config = getProviderConfig(providerId);
      if (!config) return;

      const validation = providerRegistry.validateContent(providerId, content, mediaFiles);
      if (!validation.valid) {
        errors.push({
          providerId,
          providerName: config.displayName,
          errors: validation.errors,
        });
      }
    });

    return errors;
  }, [selectedProviders, content, mediaFiles, getProviderConfig]);

  // Calculate publishing stats
  const publishingStats = useMemo(() => {
    const stats = {
      totalProviders: selectedProviders.length,
      threadsNeeded: 0,
      totalPosts: 0,
      estimatedTime: 0,
      rateLimit: false,
    };

    selectedProviders.forEach((providerId) => {
      const config = getProviderConfig(providerId);
      if (!config) return;

      if (providerRegistry.needsThreading(providerId, content)) {
        const segments = providerRegistry.getThreadSegments(providerId, content);
        stats.threadsNeeded++;
        stats.totalPosts += segments.length;
      } else {
        stats.totalPosts++;
      }

      // Check rate limits
      const rateLimit = providerRegistry.getRateLimit(providerId);
      const now = new Date();
      const _hour = now.getHours();

      // Simple rate limit check (in real app, this would check actual usage)
      if (rateLimit.postsPerHour < 10) {
        stats.rateLimit = true;
      }
    });

    // Estimate time based on provider count and rate limits
    stats.estimatedTime = Math.ceil(stats.totalProviders * 2 + (stats.rateLimit ? 30 : 0));

    return stats;
  }, [selectedProviders, content, getProviderConfig]);

  const handlePublish = async () => {
    if (validationResults.length > 0) {
      showError({ description: "Please fix validation errors before publishing." });
      return;
    }

    if (selectedProviders.length === 0) {
      showError({ description: "Please select at least one platform to publish to." });
      return;
    }

    setIsPublishing(true);
    setPublishProgress(0);
    setPublishResults([]);
    setShowResults(false);

    const results: PublishResult[] = [];

    try {
      for (let i = 0; i < selectedProviders.length; i++) {
        const providerId = selectedProviders[i];
        if (!providerId) continue;
        const config = getProviderConfig(providerId);
        if (!config) continue;

        setCurrentProvider(config.displayName);
        setPublishProgress(((i + 0.5) / selectedProviders.length) * 100);

        try {
          // Check if content needs threading
          const needsThreading = providerRegistry.needsThreading(providerId, content);
          const segments = needsThreading
            ? providerRegistry.getThreadSegments(providerId, content)
            : [content];

          // Publish via real API
          const publishResponse = await apiClient.publishPost(postId ?? "", {
            channelIds: [providerId],
            ...(scheduledDate && { scheduledAt: scheduledDate.toISOString() }),
          });

          const responseData = publishResponse.data as Record<string, unknown> | undefined;

          results.push({
            providerId,
            providerName: config.displayName,
            success: true,
            ...(responseData?.postId !== undefined && { postId: String(responseData.postId) }),
            ...(responseData?.url !== undefined && { url: String(responseData.url) }),
            ...(segments.length > 1 && { threadCount: segments.length }),
          });

          info({
            description: `Successfully ${scheduledDate ? "scheduled" : "published"} to ${config.displayName}`,
          });
        } catch (error) {
          results.push({
            providerId,
            providerName: config.displayName,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error occurred",
          });
        }

        setPublishProgress(((i + 1) / selectedProviders.length) * 100);
      }

      setPublishResults(results);
      setShowResults(true);

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;

      if (successCount === results.length) {
        success({
          description: `Successfully ${scheduledDate ? "scheduled" : "published"} to all ${successCount} platforms!`,
        });
        onPublishSuccess?.(results);
      } else if (successCount > 0) {
        info({
          description: `Published to ${successCount}/${results.length} platforms. ${failureCount} failed.`,
        });
        onPublishSuccess?.(results);
      } else {
        showError({
          description:
            "Failed to publish to any platforms. Please check your settings and try again.",
        });
        onPublishError?.(new Error("All publishing attempts failed"));
      }
    } catch (error) {
      showError({ description: "An unexpected error occurred during publishing." });
      onPublishError?.(error instanceof Error ? error : new Error("Unknown error"));
    } finally {
      setIsPublishing(false);
      setCurrentProvider("");
      setPublishProgress(0);
    }
  };

  const canPublish =
    validationResults.length === 0 && selectedProviders.length > 0 && content.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* Publishing Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Publishing Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {publishingStats.totalProviders}
              </div>
              <div className="text-sm text-muted-foreground">Platforms</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{publishingStats.totalPosts}</div>
              <div className="text-sm text-muted-foreground">Total Posts</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {publishingStats.threadsNeeded}
              </div>
              <div className="text-sm text-muted-foreground">Threads</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                ~{publishingStats.estimatedTime}s
              </div>
              <div className="text-sm text-muted-foreground">Est. Time</div>
            </div>
          </div>

          {publishingStats.rateLimit && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Some platforms have strict rate limits. Publishing may take longer than usual.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Validation Errors */}
      {validationResults.length > 0 && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Validation Errors
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {validationResults.map((result) => (
              <div key={result.providerId} className="space-y-2">
                <div className="font-medium">{result.providerName}</div>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  {result.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
                {result.providerId !==
                  validationResults[validationResults.length - 1]?.providerId && <Separator />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Selected Providers Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Publishing to {selectedProviders.length} Platform
            {selectedProviders.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedProviders.map((providerId) => {
              const config = getProviderConfig(providerId);
              if (!config) return null;

              const needsThreading = providerRegistry.needsThreading(providerId, content);
              const segments = needsThreading
                ? providerRegistry.getThreadSegments(providerId, content)
                : [content];
              const charLimit = providerRegistry.getCharLimit(providerId);
              const mediaLimits = providerRegistry.getMediaLimits(providerId);

              return (
                <div key={providerId} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-xs" style={{ backgroundColor: config.color }} />
                    <span className="font-medium">{config.displayName}</span>
                    {needsThreading && (
                      <Badge variant="secondary">Thread ({segments.length} parts)</Badge>
                    )}
                  </div>

                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>
                      Character limit: {content.length}/{charLimit}
                    </div>
                    <div>
                      Media files: {mediaFiles.length}/{mediaLimits.maxFiles}
                    </div>
                    {needsThreading && (
                      <div className="text-orange-600">
                        Will be split into {segments.length} posts
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Publishing Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium">
                {scheduledDate ? "Schedule" : "Publish"} {scheduledDate ? "for" : "immediately"}
              </div>
              {scheduledDate && (
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {scheduledDate.toLocaleString()}
                </div>
              )}
              {isPublishing && currentProvider && (
                <div className="text-sm text-muted-foreground">
                  Publishing to {currentProvider}...
                </div>
              )}
            </div>

            <Button
              onClick={handlePublish}
              disabled={!canPublish || isPublishing}
              size="lg"
              className="min-w-[120px]"
            >
              {isPublishing ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  {scheduledDate ? (
                    <Calendar className="h-4 w-4 mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {scheduledDate ? "Schedule" : "Publish"} Now
                </>
              )}
            </Button>
          </div>

          {isPublishing && (
            <div className="mt-4 space-y-2">
              <Progress value={publishProgress} className="w-full" />
              <div className="text-sm text-muted-foreground text-center">
                {Math.round(publishProgress)}% complete
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Publishing Results */}
      {showResults && publishResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Publishing Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {publishResults.map((result) => (
              <div
                key={result.providerId}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  result.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  {result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                  <div>
                    <div className="font-medium">{result.providerName}</div>
                    {result.success ? (
                      <div className="text-sm text-muted-foreground">
                        {scheduledDate ? "Scheduled successfully" : "Published successfully"}
                        {result.threadCount && ` as ${result.threadCount}-part thread`}
                      </div>
                    ) : (
                      <div className="text-sm text-red-600">{result.error}</div>
                    )}
                  </div>
                </div>

                {result.success && result.url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={result.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1" />
                      View
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tips and Information */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 text-blue-500" />
              <div className="text-sm text-muted-foreground">
                <strong>Pro tip:</strong> Content that exceeds character limits will automatically
                be split into threads for supported platforms.
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 text-blue-500" />
              <div className="text-sm text-muted-foreground">
                Publishing may take a few seconds per platform due to API rate limits and processing
                time.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
