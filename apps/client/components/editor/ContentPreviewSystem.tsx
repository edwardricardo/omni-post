"use client";

/**
 * @file ContentPreviewSystem.tsx
 * @description Multi-platform content preview system that renders adapted post previews for
 * each target provider, showing threading, media optimizations, and formatting differences.
 */

import React, { useState, useCallback } from "react";
import {
  renderLinkedInPreview,
  renderSnapchatPreview,
  renderTelegramPreview,
  renderPinterestPreview,
  renderBlueskyPreview,
} from "./provider-previews";

// Types for preview system
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
    width?: number;
    height?: number;
  }>;
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

interface ContentPreviewSystemProps {
  originalContent: CanonicalPost;
  adaptedContent: Record<string, AdaptedContent>;
  selectedProviders: string[];
  onProviderSelect?: (providerId: string) => void;
}

export function ContentPreviewSystem({
  originalContent: _originalContent,
  adaptedContent,
  selectedProviders,
  onProviderSelect: _onProviderSelect,
}: ContentPreviewSystemProps) {
  const [activePreview, setActivePreview] = useState<string | null>(selectedProviders[0] ?? null);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop">("mobile");

  // Provider-specific preview components
  const renderXPreview = (content: AdaptedContent) => (
    <div className="bg-black text-white rounded-lg p-4 max-w-md mx-auto">
      {/* X/Twitter Header */}
      <div className="flex items-start space-x-3 mb-3">
        <div className="w-12 h-12 bg-gray-600 rounded-full flex items-center justify-center">
          <span className="text-lg">👤</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <span className="font-bold">Your Brand</span>
            <span className="text-gray-400">@yourbrand</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-400">now</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {content.metadata.threading?.isThreaded ? (
        <div className="space-y-4">
          {content.metadata.threading.posts.map((post, index) => (
            <div key={index} className="border-l-2 border-gray-600 pl-4">
              <div className="text-sm text-gray-400 mb-1">
                Thread {index + 1}/{content.metadata.threading!.threadCount}
              </div>
              <div className="text-white whitespace-pre-wrap">{post}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-white whitespace-pre-wrap mb-3">{content.content.text}</div>
      )}

      {/* Media */}
      {content.content.media && content.content.media.length > 0 && (
        <div
          className={`mt-3 ${
            content.content.media.length === 1
              ? ""
              : content.content.media.length === 2
                ? "grid grid-cols-2 gap-1"
                : content.content.media.length === 3
                  ? "grid grid-cols-2 gap-1"
                  : "grid grid-cols-2 gap-1"
          }`}
        >
          {content.content.media.slice(0, 4).map((media, index) => (
            <div
              key={media.id}
              className="relative bg-gray-800 rounded-lg overflow-hidden aspect-square"
            >
              {media.type === "video" ? (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-2xl">▶️</span>
                </div>
              ) : (
                <img
                  src={media.url}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    e.currentTarget.nextElementSibling?.classList.remove("hidden");
                  }}
                />
              )}
              <div className="hidden w-full h-full flex items-center justify-center bg-gray-700">
                <span className="text-4xl">🖼️</span>
              </div>
              {content.content.media && content.content.media.length > 4 && index === 3 && (
                <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                  <span className="text-white font-bold">+{content.content.media.length - 4}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Engagement */}
      <div className="flex items-center justify-between mt-4 text-gray-400">
        <div className="flex items-center space-x-4">
          <button className="flex items-center space-x-2 hover:text-blue-400">
            <span>💬</span>
            <span className="text-sm">42</span>
          </button>
          <button className="flex items-center space-x-2 hover:text-green-400">
            <span>🔄</span>
            <span className="text-sm">128</span>
          </button>
          <button className="flex items-center space-x-2 hover:text-red-400">
            <span>❤️</span>
            <span className="text-sm">567</span>
          </button>
        </div>
        <button className="hover:text-blue-400">
          <span>📤</span>
        </button>
      </div>
    </div>
  );

  const renderInstagramPreview = (content: AdaptedContent) => (
    <div className="bg-white rounded-lg border max-w-md mx-auto">
      {/* Instagram Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-linear-to-tr from-yellow-400 via-red-500 to-purple-600 rounded-full p-0.5">
            <div className="w-full h-full bg-white rounded-full flex items-center justify-center">
              <span className="text-sm">👤</span>
            </div>
          </div>
          <span className="font-semibold">yourbrand</span>
        </div>
        <span className="text-xl">⋯</span>
      </div>

      {/* Media */}
      {content.content.media && content.content.media.length > 0 && (
        <div className="aspect-square bg-gray-100 relative">
          {content.content.media[0]?.type === "video" ? (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <span className="text-white text-4xl">▶️</span>
            </div>
          ) : (
            <img
              src={content.content.media[0]?.url}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.nextElementSibling?.classList.remove("hidden");
              }}
            />
          )}
          <div className="hidden w-full h-full flex items-center justify-center bg-gray-200">
            <span className="text-6xl">🖼️</span>
          </div>
          {content.content.media.length > 1 && (
            <div className="absolute top-4 right-4 bg-black bg-opacity-50 text-white px-2 py-1 rounded-full text-xs">
              1/{content.content.media.length}
            </div>
          )}
        </div>
      )}

      {/* Engagement */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-4">
            <span className="text-2xl">❤️</span>
            <span className="text-2xl">💬</span>
            <span className="text-2xl">📤</span>
          </div>
          <span className="text-2xl">🔖</span>
        </div>

        <div className="text-sm font-semibold mb-2">1,234 likes</div>

        {/* Caption */}
        <div className="text-sm">
          <span className="font-semibold">yourbrand</span>{" "}
          <span className="whitespace-pre-wrap">{content.content.text}</span>
        </div>

        <div className="text-gray-500 text-sm mt-2">View all 89 comments</div>
        <div className="text-gray-400 text-xs mt-1">2 HOURS AGO</div>
      </div>
    </div>
  );

  const renderFacebookPreview = (content: AdaptedContent) => (
    <div className="bg-white rounded-lg border max-w-md mx-auto">
      {/* Facebook Header */}
      <div className="flex items-start space-x-3 p-4">
        <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
          <span className="text-white font-bold">YB</span>
        </div>
        <div className="flex-1">
          <div className="font-semibold">Your Brand</div>
          <div className="text-gray-500 text-sm flex items-center">
            <span>2h</span>
            <span className="mx-1">·</span>
            <span>🌐</span>
          </div>
        </div>
        <span className="text-gray-400">⋯</span>
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        <div className="text-gray-900 whitespace-pre-wrap">{content.content.text}</div>
      </div>

      {/* Media */}
      {content.content.media && content.content.media.length > 0 && (
        <div className="relative">
          {content.content.media[0]?.type === "video" ? (
            <div className="w-full aspect-video bg-black flex items-center justify-center">
              <span className="text-white text-4xl">▶️</span>
            </div>
          ) : (
            <img
              src={content.content.media[0]?.url}
              alt=""
              className="w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.nextElementSibling?.classList.remove("hidden");
              }}
            />
          )}
          <div className="hidden w-full aspect-video flex items-center justify-center bg-gray-200">
            <span className="text-6xl">🖼️</span>
          </div>
        </div>
      )}

      {/* Engagement */}
      <div className="p-4">
        <div className="flex items-center justify-between text-gray-500 text-sm mb-3">
          <div className="flex items-center space-x-1">
            <span className="bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
              👍
            </span>
            <span className="bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
              ❤️
            </span>
            <span>245</span>
          </div>
          <div className="flex items-center space-x-4">
            <span>32 comments</span>
            <span>18 shares</span>
          </div>
        </div>

        <div className="border-t pt-2">
          <div className="flex items-center justify-between">
            <button className="flex-1 flex items-center justify-center space-x-2 py-2 hover:bg-gray-50 rounded-sm">
              <span>👍</span>
              <span className="font-semibold text-gray-600">Like</span>
            </button>
            <button className="flex-1 flex items-center justify-center space-x-2 py-2 hover:bg-gray-50 rounded-sm">
              <span>💬</span>
              <span className="font-semibold text-gray-600">Comment</span>
            </button>
            <button className="flex-1 flex items-center justify-center space-x-2 py-2 hover:bg-gray-50 rounded-sm">
              <span>📤</span>
              <span className="font-semibold text-gray-600">Share</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderYouTubePreview = (content: AdaptedContent) => (
    <div className="bg-white rounded-lg max-w-md mx-auto">
      {/* Video Thumbnail */}
      <div className="relative aspect-video bg-black rounded-t-lg overflow-hidden">
        {content.content.media?.[0] ? (
          content.content.media[0].type === "video" ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="bg-red-600 rounded-full w-16 h-16 flex items-center justify-center">
                <span className="text-white text-2xl ml-1">▶</span>
              </div>
            </div>
          ) : (
            <img
              src={content.content.media[0]?.url ?? ""}
              alt=""
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white">
            <span className="text-6xl">🎥</span>
          </div>
        )}
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white px-1 text-xs rounded-sm">
          10:45
        </div>
      </div>

      {/* Video Info */}
      <div className="p-4">
        <div className="flex items-start space-x-3">
          <div className="w-9 h-9 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">YB</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm line-clamp-2 mb-1">
              {content.content.text.length > 60
                ? content.content.text.substring(0, 60) + "..."
                : content.content.text}
            </h3>
            <div className="text-gray-600 text-xs">
              <div>Your Brand Channel</div>
              <div>1.2K views · 2 hours ago</div>
            </div>
          </div>
          <span className="text-gray-400">⋮</span>
        </div>

        {/* Description Preview */}
        {content.content.text.length > 60 && (
          <div className="mt-3 text-sm text-gray-600">
            <div className="line-clamp-3">{content.content.text}</div>
            <button className="text-gray-500 text-xs mt-1">Show more</button>
          </div>
        )}
      </div>
    </div>
  );

  const renderTikTokPreview = (content: AdaptedContent) => (
    <div className="bg-black rounded-lg max-w-xs mx-auto aspect-[9/16] relative overflow-hidden">
      {/* Video Content */}
      <div className="w-full h-full relative">
        {content.content.media?.[0] ? (
          <img
            src={content.content.media[0].url}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              e.currentTarget.nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-white text-8xl">🎵</span>
          </div>
        )}
        <div className="hidden w-full h-full flex items-center justify-center bg-gray-800">
          <span className="text-white text-8xl">🎵</span>
        </div>

        {/* Play button */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-white bg-opacity-20 rounded-full w-16 h-16 flex items-center justify-center">
            <span className="text-white text-2xl ml-1">▶</span>
          </div>
        </div>
      </div>

      {/* Right side actions */}
      <div className="absolute right-3 bottom-20 flex flex-col items-center space-y-4">
        <div className="text-center">
          <div className="w-12 h-12 bg-gray-600 rounded-full flex items-center justify-center mb-1">
            <span className="text-white">👤</span>
          </div>
          <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center -mt-3 ml-6">
            <span className="text-white text-xs">+</span>
          </div>
        </div>

        <div className="text-center text-white">
          <div className="text-2xl mb-1">❤️</div>
          <div className="text-xs">12.3K</div>
        </div>

        <div className="text-center text-white">
          <div className="text-2xl mb-1">💬</div>
          <div className="text-xs">1,234</div>
        </div>

        <div className="text-center text-white">
          <div className="text-2xl mb-1">📤</div>
          <div className="text-xs">456</div>
        </div>

        <div className="text-center text-white">
          <div className="w-8 h-8 bg-gray-600 rounded-sm border-2 border-white">
            <span className="text-xs">🎵</span>
          </div>
        </div>
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-4 left-4 right-16 text-white">
        <div className="font-bold text-sm mb-1">@yourbrand</div>
        <div className="text-sm mb-2 line-clamp-2">{content.content.text}</div>
        <div className="text-xs opacity-75">♪ Original sound - Your Brand</div>
      </div>
    </div>
  );

  const renderPreview = useCallback((providerId: string, content: AdaptedContent) => {
    switch (providerId.toLowerCase()) {
      case "x":
        return renderXPreview(content);
      case "instagram":
        return renderInstagramPreview(content);
      case "facebook":
        return renderFacebookPreview(content);
      case "youtube":
        return renderYouTubePreview(content);
      case "tiktok":
        return renderTikTokPreview(content);
      case "linkedin":
        return renderLinkedInPreview(content);
      case "snapchat":
        return renderSnapchatPreview(content);
      case "telegram":
        return renderTelegramPreview(content);
      case "pinterest":
        return renderPinterestPreview(content);
      case "bluesky":
        return renderBlueskyPreview(content);
      default:
        return (
          <div className="bg-gray-100 rounded-lg p-6 max-w-md mx-auto">
            <div className="text-center text-gray-500">Preview not available for {providerId}</div>
          </div>
        );
    }
  }, []);

  return (
    <div className="content-preview-system">
      {/* Preview Controls */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Content Preview</h3>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPreviewMode("mobile")}
              className={`px-3 py-1 rounded-sm text-sm ${
                previewMode === "mobile" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-700"
              }`}
            >
              📱 Mobile
            </button>
            <button
              onClick={() => setPreviewMode("desktop")}
              className={`px-3 py-1 rounded-sm text-sm ${
                previewMode === "desktop" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-700"
              }`}
            >
              💻 Desktop
            </button>
          </div>
        </div>

        {/* Provider Tabs */}
        <div className="flex space-x-2 overflow-x-auto">
          {selectedProviders.map((providerId) => {
            const content = adaptedContent[providerId];
            if (!content) return null;

            return (
              <button
                key={providerId}
                onClick={() => setActivePreview(providerId)}
                className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                  activePreview === providerId
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {providerId.charAt(0).toUpperCase() + providerId.slice(1)}
                {content.metadata.isAdapted && <span className="ml-2 text-xs opacity-75">✨</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview Display */}
      {activePreview && adaptedContent[activePreview] ? (
        <div
          className={`preview-container ${previewMode === "desktop" ? "scale-125" : ""} transition-transform`}
        >
          {renderPreview(activePreview, adaptedContent[activePreview])}

          {/* Adaptation Info */}
          {adaptedContent[activePreview].metadata.isAdapted && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <div className="text-sm font-medium text-blue-800 mb-1">
                Content Adapted for {activePreview.charAt(0).toUpperCase() + activePreview.slice(1)}
              </div>
              <ul className="text-xs text-blue-600 space-y-1">
                {adaptedContent[activePreview].metadata.changes.map((change, index) => (
                  <li key={index}>• {change}</li>
                ))}
              </ul>
              {adaptedContent[activePreview].metadata.warnings.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-yellow-700">Warnings:</div>
                  <ul className="text-xs text-yellow-600 space-y-1">
                    {adaptedContent[activePreview].metadata.warnings.map((warning, index) => (
                      <li key={index}>⚠ {warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <div className="text-4xl mb-2">👀</div>
          <p>Select a platform to see how your content will appear</p>
        </div>
      )}

      {/* Quick Actions */}
      {activePreview && (
        <div className="mt-6 flex justify-center space-x-3">
          <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
            📱 Share Preview
          </button>
          <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
            💾 Save as Template
          </button>
          <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
            📅 Schedule Post
          </button>
        </div>
      )}
    </div>
  );
}
