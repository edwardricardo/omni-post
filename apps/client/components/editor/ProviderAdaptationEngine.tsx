"use client";

/**
 * @file ProviderAdaptationEngine.tsx
 * @description Content adaptation engine that transforms canonical posts into provider-specific
 * formats, applying character limits, media constraints, threading, and hashtag optimizations.
 */

import React, { useCallback, useMemo } from "react";

// Types for adaptation engine
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
    alt?: string;
  }>;
}

interface ProviderConstraints {
  maxChars: number;
  maxMediaPerPost: number;
  allowedMedia: string[];
  capabilities: {
    threading: boolean;
    scheduling: boolean;
    hashtags: boolean;
    mentions: boolean;
  };
  formatting: {
    supportsMarkdown: boolean;
    supportsHTML: boolean;
    supportsEmojis: boolean;
    supportsLinks: boolean;
  };
}

interface AdaptedContent {
  providerId: string;
  content: {
    text: string;
    media?: Array<{
      id: string;
      type: string;
      url: string;
      optimized?: boolean;
    }>;
  };
  metadata: {
    isAdapted: boolean;
    changes: string[];
    warnings: string[];
    threading?: {
      isThreaded: boolean;
      threadCount: number;
      posts: string[];
    };
  };
}

interface ProviderAdaptationEngineProps {
  content: CanonicalPost;
  providers: Record<string, ProviderConstraints>;
  onAdaptationComplete: (adaptations: Record<string, AdaptedContent>) => void;
  enableAutoAdaptation?: boolean;
}

/**
 * @component ProviderAdaptationEngine
 * @description Adapts canonical post content into provider-specific formats, applying
 * character limits, media constraints, threading, and hashtag optimizations.
 * @param props.enableAutoAdaptation - Automatically re-adapt when content changes
 */
export function ProviderAdaptationEngine({
  content,
  providers,
  onAdaptationComplete,
  enableAutoAdaptation = true,
}: ProviderAdaptationEngineProps) {
  // Thread creation function
  const createThread = useCallback((text: string, maxChars: number): string[] => {
    const posts: string[] = [];
    const words = text.split(" ");
    let currentPost = "";

    for (const word of words) {
      const testPost = currentPost ? `${currentPost} ${word}` : word;

      if (testPost.length <= maxChars - 10) {
        // Reserve space for thread indicator
        currentPost = testPost;
      } else {
        if (currentPost) {
          posts.push(currentPost);
          currentPost = word;
        } else {
          // Word is too long, split it
          posts.push(word.substring(0, maxChars - 10));
          currentPost = word.substring(maxChars - 10);
        }
      }
    }

    if (currentPost) {
      posts.push(currentPost);
    }

    // Add thread indicators
    return posts.map((post, index) => {
      if (posts.length > 1) {
        return `${post} (${index + 1}/${posts.length})`;
      }
      return post;
    });
  }, []);

  // Text optimization functions
  const optimizeText = useCallback(
    (
      text: string,
      constraints: ProviderConstraints
    ): {
      optimizedText: string;
      changes: string[];
      needsThreading: boolean;
      threadPosts?: string[];
    } => {
      let optimizedText = text;
      const changes: string[] = [];
      let needsThreading = false;
      let threadPosts: string[] = [];

      // Remove excessive whitespace
      if (text !== text.trim()) {
        optimizedText = optimizedText.trim();
        changes.push("Removed leading/trailing whitespace");
      }

      // Normalize line breaks
      optimizedText = optimizedText.replace(/\n{3,}/g, "\n\n");

      // Handle character limit
      if (optimizedText.length > constraints.maxChars) {
        if (constraints.capabilities.threading) {
          // Split into thread
          threadPosts = createThread(optimizedText, constraints.maxChars);
          needsThreading = true;
          optimizedText = threadPosts[0] || optimizedText;
          changes.push(`Split into ${threadPosts.length} thread posts`);
        } else {
          // Truncate
          const truncateAt = constraints.maxChars - 3; // Reserve space for "..."
          const lastSpace = optimizedText.lastIndexOf(" ", truncateAt);
          const cutPoint = lastSpace > truncateAt * 0.8 ? lastSpace : truncateAt;

          optimizedText = optimizedText.substring(0, cutPoint) + "...";
          changes.push(`Truncated text (${text.length - optimizedText.length + 3} chars removed)`);
        }
      }

      // Format hashtags for platform
      if (constraints.capabilities.hashtags) {
        // Ensure hashtags are properly formatted
        optimizedText = optimizedText.replace(/#(\w+)/g, (match, tag) => {
          return `#${tag}`;
        });
      } else {
        // Remove hashtags if not supported
        const hashtagCount = (optimizedText.match(/#\w+/g) || []).length;
        if (hashtagCount > 0) {
          optimizedText = optimizedText.replace(/#\w+/g, "");
          optimizedText = optimizedText.replace(/\s+/g, " ").trim();
          changes.push(`Removed ${hashtagCount} hashtags (not supported)`);
        }
      }

      // Handle mentions
      if (!constraints.capabilities.mentions) {
        const mentionCount = (optimizedText.match(/@\w+/g) || []).length;
        if (mentionCount > 0) {
          optimizedText = optimizedText.replace(/@(\w+)/g, "$1");
          changes.push(`Converted ${mentionCount} mentions to plain text`);
        }
      }

      // Handle links based on platform support
      if (!constraints.formatting.supportsLinks) {
        const linkCount = (optimizedText.match(/https?:\/\/[^\s]+/g) || []).length;
        if (linkCount > 0) {
          optimizedText = optimizedText.replace(/https?:\/\/[^\s]+/g, "[link]");
          changes.push(`Replaced ${linkCount} links with placeholders`);
        }
      }

      // Format text based on platform capabilities
      if (!constraints.formatting.supportsMarkdown) {
        // Remove markdown formatting
        optimizedText = optimizedText
          .replace(/\*\*(.*?)\*\*/g, "$1") // Bold
          .replace(/\*(.*?)\*/g, "$1") // Italic
          .replace(/`(.*?)`/g, "$1") // Code
          .replace(/~~(.*?)~~/g, "$1"); // Strikethrough

        if (text !== optimizedText) {
          changes.push("Removed markdown formatting");
        }
      }

      if (!constraints.formatting.supportsEmojis) {
        // Remove emojis (basic detection)
        const emojiRegex =
          /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
        const emojiCount = (optimizedText.match(emojiRegex) || []).length;
        if (emojiCount > 0) {
          optimizedText = optimizedText.replace(emojiRegex, "");
          optimizedText = optimizedText.replace(/\s+/g, " ").trim();
          changes.push(`Removed ${emojiCount} emojis (not supported)`);
        }
      }

      return {
        optimizedText,
        changes,
        needsThreading,
        ...(needsThreading && threadPosts ? { threadPosts } : {}),
      };
    },
    [createThread]
  );

  // Media adaptation function
  const adaptMedia = useCallback(
    (
      media: CanonicalPost["media"],
      constraints: ProviderConstraints
    ): {
      adaptedMedia: AdaptedContent["content"]["media"];
      changes: string[];
      warnings: string[];
    } => {
      if (!media || media.length === 0) {
        return { adaptedMedia: [], changes: [], warnings: [] };
      }

      const changes: string[] = [];
      const warnings: string[] = [];
      let adaptedMedia = [...media];

      // Filter unsupported media types
      const supportedMedia = adaptedMedia.filter((item) =>
        constraints.allowedMedia.includes(item.type)
      );

      if (supportedMedia.length !== adaptedMedia.length) {
        const removedCount = adaptedMedia.length - supportedMedia.length;
        const removedTypes = [
          ...new Set(
            adaptedMedia
              .filter((item) => !constraints.allowedMedia.includes(item.type))
              .map((item) => item.type)
          ),
        ];

        changes.push(
          `Removed ${removedCount} unsupported media files (${removedTypes.join(", ")})`
        );
        adaptedMedia = supportedMedia;
      }

      // Limit media count
      if (adaptedMedia.length > constraints.maxMediaPerPost) {
        const removedCount = adaptedMedia.length - constraints.maxMediaPerPost;
        adaptedMedia = adaptedMedia.slice(0, constraints.maxMediaPerPost);
        changes.push(
          `Removed ${removedCount} media files (exceeds limit of ${constraints.maxMediaPerPost})`
        );
        warnings.push("Consider splitting into multiple posts or choosing different platforms");
      }

      return {
        adaptedMedia: adaptedMedia.map((item) => ({
          ...item,
          optimized: changes.length > 0,
        })),
        changes,
        warnings,
      };
    },
    []
  );

  // Platform-specific optimizations
  const applyPlatformSpecificOptimizations = useCallback(
    (text: string, providerId: string): { optimizedText: string; changes: string[] } => {
      let optimizedText = text;
      const changes: string[] = [];

      switch (providerId.toLowerCase()) {
        case "x":
          // X/Twitter optimizations
          // Optimize for engagement
          if (!text.includes("#") && text.length < 200) {
            optimizedText += " #twitter";
            changes.push("Added relevant hashtag for better discoverability");
          }
          break;

        case "instagram": {
          // Instagram optimizations
          // Encourage hashtag usage
          const hashtagCount = (text.match(/#\w+/g) || []).length;
          if (hashtagCount < 3 && text.length < 2000) {
            changes.push("Consider adding more hashtags for Instagram (optimal: 5-10)");
          }
          break;
        }

        case "facebook":
          // Facebook optimizations
          // Optimize for engagement
          if (text.length < 100) {
            changes.push(
              "Consider expanding content for Facebook (performs better with 100+ characters)"
            );
          }
          break;

        case "youtube":
          // YouTube optimizations
          if (!text.toLowerCase().includes("subscribe") && text.length > 100) {
            changes.push("Consider adding a call-to-action (subscribe, like, comment)");
          }
          break;

        case "tiktok":
          // TikTok optimizations
          if (!text.includes("#")) {
            changes.push("Consider adding trending hashtags for TikTok discovery");
          }
          break;
      }

      return { optimizedText, changes };
    },
    []
  );

  // Main adaptation function
  const adaptContent = useMemo((): Record<string, AdaptedContent> => {
    const adaptations: Record<string, AdaptedContent> = {};

    Object.entries(providers).forEach(([providerId, constraints]) => {
      // Adapt text
      const textAdaptation = optimizeText(content.content.text, constraints);

      // Apply platform-specific optimizations
      const platformOptimization = applyPlatformSpecificOptimizations(
        textAdaptation.optimizedText,
        providerId
      );

      // Adapt media
      const mediaAdaptation = adaptMedia(content.media, constraints);

      // Combine all changes
      const allChanges = [
        ...textAdaptation.changes,
        ...platformOptimization.changes,
        ...mediaAdaptation.changes,
      ];

      // Create adapted content
      adaptations[providerId] = {
        providerId,
        content: {
          text: platformOptimization.optimizedText,
          ...(mediaAdaptation.adaptedMedia ? { media: mediaAdaptation.adaptedMedia } : {}),
        },
        metadata: {
          isAdapted: allChanges.length > 0 || textAdaptation.needsThreading,
          changes: allChanges,
          warnings: mediaAdaptation.warnings,
          ...(textAdaptation.needsThreading
            ? {
                threading: {
                  isThreaded: true,
                  threadCount: textAdaptation.threadPosts?.length || 1,
                  posts: textAdaptation.threadPosts || [textAdaptation.optimizedText],
                },
              }
            : {}),
        },
      };
    });

    return adaptations;
  }, [content, providers, optimizeText, adaptMedia, applyPlatformSpecificOptimizations]);

  // Effect to call adaptation complete callback
  React.useEffect(() => {
    if (enableAutoAdaptation) {
      onAdaptationComplete(adaptContent);
    }
  }, [adaptContent, onAdaptationComplete, enableAutoAdaptation]);

  // Render adaptation preview
  return (
    <div className="provider-adaptation-engine">
      {Object.entries(adaptContent).map(([providerId, adaptation]) => (
        <div key={providerId} className="mb-4 p-4 border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium capitalize">{providerId}</h4>
            {adaptation.metadata.isAdapted && (
              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-sm">
                Adapted
              </span>
            )}
          </div>

          {/* Adapted text preview */}
          <div className="mb-3">
            <div className="p-3 bg-gray-50 rounded-sm border text-sm">
              {adaptation.metadata.threading?.isThreaded ? (
                <div>
                  <div className="font-medium mb-2 text-blue-600">
                    Thread ({adaptation.metadata.threading.threadCount} posts):
                  </div>
                  {adaptation.metadata.threading.posts.map((post, index) => (
                    <div key={index} className="mb-2 pl-4 border-l-2 border-blue-200">
                      <span className="text-xs text-gray-500">Post {index + 1}:</span>
                      <div>{post}</div>
                    </div>
                  ))}
                </div>
              ) : (
                adaptation.content.text
              )}
            </div>
          </div>

          {/* Media preview */}
          {adaptation.content.media && adaptation.content.media.length > 0 && (
            <div className="mb-3">
              <div className="text-sm text-gray-600 mb-2">
                Media ({adaptation.content.media.length} files)
              </div>
              <div className="flex space-x-2">
                {adaptation.content.media.map((media) => (
                  <div
                    key={media.id}
                    className="w-16 h-16 bg-gray-200 rounded-sm flex items-center justify-center text-xs"
                  >
                    {media.type}
                    {media.optimized && <span className="text-blue-600">*</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Changes and warnings */}
          {adaptation.metadata.changes.length > 0 && (
            <div className="mb-2">
              <div className="text-sm font-medium text-green-700 mb-1">Changes Applied:</div>
              <ul className="text-xs text-green-600 space-y-1">
                {adaptation.metadata.changes.map((change, index) => (
                  <li key={index}>• {change}</li>
                ))}
              </ul>
            </div>
          )}

          {adaptation.metadata.warnings.length > 0 && (
            <div>
              <div className="text-sm font-medium text-yellow-700 mb-1">Warnings:</div>
              <ul className="text-xs text-yellow-600 space-y-1">
                {adaptation.metadata.warnings.map((warning, index) => (
                  <li key={index}>⚠ {warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
