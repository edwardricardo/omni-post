"use client";

/**
 * @file AdminContentEditor.tsx
 * @description Rich content editor for admin post creation, wrapping the shared ContentEditorCore
 * with provider-specific constraints, media attachments, and real-time validation per platform.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ContentEditorCore,
  type ProviderConstraints,
  type ContentEditorContent,
  type ValidationResult,
  type ValidationPanelRenderProps,
} from "@packages/ui";
import { getProviderConfig } from "@shared/types";
import { cn } from "@packages/ui";

interface CanonicalPost {
  content: {
    text: string;
    title?: string;
    summary?: string;
  };
  media?: Array<{
    id: string;
    type: "image" | "video" | "gif";
    url: string;
    width?: number;
    height?: number;
    alt?: string;
    metadata?: {
      size?: number;
      duration?: number;
    };
  }>;
  publishConfig?: {
    scheduledAt?: Date;
    timezone?: string;
  };
}

interface AdminContentEditorProps {
  accountId: string;
  projectId: string;
  initialContent?: CanonicalPost;
  selectedProviders?: string[];
  onContentChange?: (content: CanonicalPost) => void;
  onValidationChange?: (results: Record<string, ValidationResult>) => void;
  onPublish?: (content: CanonicalPost, providers: string[]) => Promise<void>;
}

// Helper functions using centralized provider config
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
 * @component AdminContentEditor
 * @description Rich content editor for admin post creation, wrapping ContentEditorCore
 * with provider-specific constraints, media attachments, and real-time validation per platform.
 * @param props.selectedProviders - Target providers for validation and adaptation
 * @param props.onValidationChange - Callback with per-provider validation results
 */
export function AdminContentEditor({
  accountId,
  projectId,
  initialContent,
  selectedProviders: initialSelectedProviders = [],
  onContentChange,
  onValidationChange,
  onPublish,
}: AdminContentEditorProps) {
  const [providers, setProviders] = useState<ProviderConstraints[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<string[]>(initialSelectedProviders);
  const [isPublishing, setIsPublishing] = useState(false);

  // Fetch connected providers
  useEffect(() => {
    async function fetchProviders() {
      try {
        const response = await fetch(`/api/backend/auth/connections/${projectId}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to fetch providers");

        const data = (await response.json()) as {
          connections: Array<{ providerId: string; providerName: string; status: string }>;
        };
        const providerConstraints: ProviderConstraints[] = data.connections.map((conn) => ({
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
        }));

        setProviders(providerConstraints);
      } catch {
        // Failed to fetch providers — editor will show without provider constraints
      }
    }

    fetchProviders();
  }, [accountId, projectId]);

  // Convert initial content to editor format
  const editorInitialContent = useMemo(() => {
    return initialContent?.content.text || "";
  }, [initialContent]);

  const editorInitialTitle = useMemo(() => {
    return initialContent?.content.title;
  }, [initialContent]);

  const editorInitialMedia = useMemo(() => {
    return initialContent?.media || [];
  }, [initialContent]);

  // Handle content change
  const handleContentChange = useCallback(
    (content: ContentEditorContent) => {
      const canonicalPost: CanonicalPost = {
        content: {
          text: content.text,
          ...(content.title && { title: content.title }),
        },
        ...(content.media && content.media.length > 0 && { media: content.media }),
      };

      onContentChange?.(canonicalPost);
    },
    [onContentChange]
  );

  // Handle validation change
  const handleValidationChange = useCallback(
    (results: Record<string, ValidationResult>) => {
      onValidationChange?.(results);
    },
    [onValidationChange]
  );

  // Handle publish
  const handlePublish = useCallback(
    async (content: ContentEditorContent) => {
      if (!onPublish || selectedProviders.length === 0) return;

      const canonicalPost: CanonicalPost = {
        content: {
          text: content.text,
          ...(content.title && { title: content.title }),
        },
        ...(content.media && content.media.length > 0 && { media: content.media }),
      };

      setIsPublishing(true);
      try {
        await onPublish(canonicalPost, selectedProviders);
      } catch {
        // Publish error is propagated to the parent via onPublish rejection
      } finally {
        setIsPublishing(false);
      }
    },
    [onPublish, selectedProviders]
  );

  // Custom validation panel renderer with admin-specific styling
  const renderValidationPanel = useCallback(
    ({
      validationResults,
      providers: validationProviders,
      showAdaptationSuggestions,
    }: ValidationPanelRenderProps) => {
      const overallValid = Object.values(validationResults).every((result) => result.valid);

      return (
        <div className="mt-6" role="region" aria-labelledby="platform-compat-heading">
          <h3 id="platform-compat-heading" className="text-lg font-semibold mb-3">
            Platform Compatibility
          </h3>
          <div className="space-y-3" aria-live="polite" aria-atomic="false">
            {Object.entries(validationResults).map(([providerId, result]) => {
              const provider = validationProviders.find((p) => p.id === providerId);
              if (!provider) return null;

              return (
                <div
                  key={providerId}
                  className={cn(
                    "p-4 rounded-lg border",
                    result.valid ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">{provider.displayName}</h4>
                    <span
                      className={cn(
                        "px-2 py-1 rounded-sm text-xs font-medium",
                        result.valid ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      )}
                    >
                      {result.valid ? "Compatible" : "Needs Adaptation"}
                    </span>
                  </div>

                  {/* Validation Errors */}
                  {result.errors.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {result.errors.map((error, index) => (
                        <p
                          key={index}
                          className={cn(
                            "text-sm",
                            error.severity === "error"
                              ? "text-red-600"
                              : error.severity === "warning"
                                ? "text-yellow-600"
                                : "text-blue-600"
                          )}
                        >
                          {error.severity === "error" && "✗ "}
                          {error.severity === "warning" && "⚠ "}
                          {error.severity === "info" && "ℹ "}
                          {error.message}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Adaptation Suggestions */}
                  {showAdaptationSuggestions &&
                    result.suggestions &&
                    result.suggestions.length > 0 && (
                      <div className="mt-2 space-y-1 bg-white/50 rounded-sm p-2">
                        <p className="text-xs font-medium text-gray-700 mb-1">Suggestions:</p>
                        {result.suggestions.map((suggestion, index) => (
                          <p key={index} className="text-sm text-gray-600">
                            💡 {suggestion.message}
                          </p>
                        ))}
                      </div>
                    )}
                </div>
              );
            })}
          </div>

          {/* Overall Status */}
          <div
            className={cn(
              "mt-4 p-4 rounded-lg border",
              overallValid
                ? "border-green-300 bg-green-100 text-green-800"
                : "border-yellow-300 bg-yellow-100 text-yellow-800"
            )}
          >
            <p className="font-medium">
              {overallValid
                ? "✓ Content is compatible with all selected platforms"
                : "⚠ Content requires adaptation for some platforms"}
            </p>
          </div>
        </div>
      );
    },
    []
  );

  return (
    <div className="universal-content-editor max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Universal Content Editor</h1>
        <p className="text-gray-600">Create content that adapts to all your connected platforms</p>
      </div>

      {/* Content Editor Core with Admin Features */}
      <ContentEditorCore
        providers={providers}
        selectedProviders={selectedProviders}
        onProviderSelectionChange={setSelectedProviders}
        initialContent={editorInitialContent}
        {...(editorInitialTitle && { initialTitle: editorInitialTitle })}
        initialMedia={editorInitialMedia}
        onContentChange={handleContentChange}
        onValidationChange={handleValidationChange}
        features={{
          richText: false, // Admin uses plain text
          media: true,
          validation: true,
          advancedValidation: true, // Admin-specific enhanced validation
          analytics: false, // Future: admin analytics
          toolbar: false, // No rich text toolbar for admin
          characterCount: true,
          providerSelection: true,
          dragAndDrop: true,
        }}
        placeholder="What's on your mind? Your content will automatically adapt to each platform's requirements..."
        validateOnChange={true}
        renderValidationPanel={renderValidationPanel}
      />

      {/* Publish Button */}
      {onPublish && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => {
              const currentContent: ContentEditorContent = {
                text: editorInitialContent,
                ...(editorInitialTitle && { title: editorInitialTitle }),
                ...(editorInitialMedia.length > 0 && { media: editorInitialMedia }),
              };
              handlePublish(currentContent);
            }}
            disabled={isPublishing || selectedProviders.length === 0}
            className={`
              px-6 py-2 rounded-lg font-medium transition-colors
              ${
                selectedProviders.length > 0 && !isPublishing
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }
            `}
          >
            {isPublishing ? "Publishing..." : "Publish Now"}
          </button>
        </div>
      )}
    </div>
  );
}
