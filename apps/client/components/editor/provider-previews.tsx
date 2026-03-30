"use client";

/**
 * @file provider-previews.tsx
 * @description Provider-specific preview render functions for LinkedIn, Snapchat,
 * Telegram, Pinterest, and Bluesky platforms used by ContentPreviewSystem.
 * @layer presentation
 */

import React from "react";

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

export function renderLinkedInPreview(content: AdaptedContent) {
  const LINKEDIN_LIMIT = 3000;
  const displayText =
    content.content.text.length > LINKEDIN_LIMIT
      ? content.content.text.slice(0, LINKEDIN_LIMIT) + "..."
      : content.content.text;
  return (
    <div className="bg-white rounded-lg border max-w-md mx-auto">
      <div className="p-4">
        <div className="flex items-start space-x-3">
          <div className="w-12 h-12 bg-blue-700 rounded-full flex items-center justify-center">
            <span className="text-white font-bold">YB</span>
          </div>
          <div className="flex-1">
            <div className="font-semibold">Your Brand</div>
            <div className="text-gray-500 text-xs">Professional Title -- 1st</div>
            <div className="text-gray-400 text-xs flex items-center">
              <span>2h</span>
              <span className="mx-1">·</span>
              <span>🌐</span>
            </div>
          </div>
          <span className="text-gray-400">⋯</span>
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="text-gray-900 whitespace-pre-wrap text-sm">{displayText}</div>
      </div>

      {content.content.media && content.content.media.length > 0 && (
        <div className="relative">
          {content.content.media[0]?.type === "video" ? (
            <div className="w-full aspect-video bg-black flex items-center justify-center">
              <span className="text-white text-4xl">▶️</span>
            </div>
          ) : (
            <img
              src={content.content.media[0]?.url ?? ""}
              alt=""
              className="w-full object-cover max-h-96"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center justify-between text-gray-500 text-sm mb-3">
          <div className="flex items-center space-x-1">
            <span className="bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
              👍
            </span>
            <span>128</span>
          </div>
          <div className="flex items-center space-x-4">
            <span>15 comments</span>
            <span>8 reposts</span>
          </div>
        </div>
        <div className="border-t pt-2">
          <div className="flex items-center justify-between">
            <button className="flex-1 flex items-center justify-center space-x-2 py-2 hover:bg-gray-50 rounded-sm">
              <span>👍</span>
              <span className="font-semibold text-gray-600 text-sm">Like</span>
            </button>
            <button className="flex-1 flex items-center justify-center space-x-2 py-2 hover:bg-gray-50 rounded-sm">
              <span>💬</span>
              <span className="font-semibold text-gray-600 text-sm">Comment</span>
            </button>
            <button className="flex-1 flex items-center justify-center space-x-2 py-2 hover:bg-gray-50 rounded-sm">
              <span>🔄</span>
              <span className="font-semibold text-gray-600 text-sm">Repost</span>
            </button>
            <button className="flex-1 flex items-center justify-center space-x-2 py-2 hover:bg-gray-50 rounded-sm">
              <span>📤</span>
              <span className="font-semibold text-gray-600 text-sm">Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function renderSnapchatPreview(content: AdaptedContent) {
  const SNAPCHAT_LIMIT = 250;
  const displayText = content.content.text.slice(0, SNAPCHAT_LIMIT);
  const overLimit = content.content.text.length > SNAPCHAT_LIMIT;
  return (
    <div
      className="bg-black rounded-lg max-w-xs mx-auto relative overflow-hidden"
      style={{ aspectRatio: "9/16" }}
    >
      {content.content.media?.[0] ? (
        <img
          src={content.content.media[0].url}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-yellow-400 to-yellow-300" />
      )}

      <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
        <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center border-2 border-white">
          <span className="text-sm">👤</span>
        </div>
        <span className="text-white text-xs font-medium bg-black bg-opacity-40 px-2 py-1 rounded-full">
          10s
        </span>
      </div>

      <div className="absolute inset-0 flex items-center justify-center px-6">
        <p className="text-white text-xl font-bold text-center drop-shadow-lg">{displayText}</p>
      </div>

      {overLimit && (
        <div className="absolute bottom-4 left-4 right-4 bg-yellow-400/90 rounded-md p-2">
          <p className="text-xs text-gray-900 font-medium text-center">
            Caption exceeds {SNAPCHAT_LIMIT} characters (
            {content.content.text.length - SNAPCHAT_LIMIT} over)
          </p>
        </div>
      )}
    </div>
  );
}

export function renderTelegramPreview(content: AdaptedContent) {
  const TELEGRAM_LIMIT = 4096;
  const displayText =
    content.content.text.length > TELEGRAM_LIMIT
      ? content.content.text.slice(0, TELEGRAM_LIMIT) + "..."
      : content.content.text;
  return (
    <div className="bg-gray-100 rounded-lg max-w-sm mx-auto p-4 space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 bg-blue-500 rounded-full flex items-center justify-center">
          <span className="text-white font-bold text-sm">YB</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-blue-600">Your Brand</p>
        </div>
      </div>
      <div className="bg-white rounded-xl rounded-tl-none px-4 py-3 shadow-sm max-w-xs">
        {content.content.media && content.content.media.length > 0 && content.content.media[0] && (
          <img
            src={content.content.media[0].url}
            alt=""
            className="w-full rounded-lg mb-2 object-cover max-h-48"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <p className="text-sm text-gray-900 whitespace-pre-wrap">{displayText}</p>
        <p className="text-right text-xs text-gray-400 mt-1">now</p>
      </div>
    </div>
  );
}

export function renderPinterestPreview(content: AdaptedContent) {
  const PINTEREST_LIMIT = 500;
  const displayText =
    content.content.text.length > PINTEREST_LIMIT
      ? content.content.text.slice(0, PINTEREST_LIMIT) + "..."
      : content.content.text;
  return (
    <div className="bg-white rounded-xl max-w-xs mx-auto overflow-hidden shadow-md">
      <div className="bg-gray-100 relative" style={{ aspectRatio: "2/3" }}>
        {content.content.media?.[0] ? (
          <img
            src={content.content.media[0].url}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            2:3 image
          </div>
        )}
        <button className="absolute top-3 right-3 bg-red-600 text-white text-sm font-semibold rounded-full px-3 py-1">
          Save
        </button>
      </div>
      <div className="p-3">
        <p className="font-semibold text-sm text-gray-900 truncate">Your Brand</p>
        <p className="text-sm text-gray-700 mt-1 line-clamp-3">{displayText}</p>
        <p className="text-xs text-gray-400 mt-2">yourbrand -- Board</p>
      </div>
    </div>
  );
}

export function renderBlueskyPreview(content: AdaptedContent) {
  const BLUESKY_LIMIT = 300;
  const displayText = content.content.text.slice(0, BLUESKY_LIMIT);
  const overLimit = content.content.text.length > BLUESKY_LIMIT;
  return (
    <div className="bg-white rounded-lg border max-w-md mx-auto">
      <div className="p-4">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-blue-400 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">YB</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-1">
              <span className="font-bold text-gray-900">Your Brand</span>
              <span className="text-gray-500 text-sm">@yourbrand.bsky.social</span>
            </div>
            <div className="mt-1">
              <p className="text-gray-900 whitespace-pre-wrap">{displayText}</p>
            </div>

            {content.content.media && content.content.media.length > 0 && (
              <div
                className={`mt-3 rounded-lg overflow-hidden ${
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
                    className={`relative bg-gray-100 overflow-hidden ${
                      content.content.media!.length === 3 && index === 0 ? "row-span-2" : ""
                    } ${content.content.media!.length === 1 ? "aspect-video" : "aspect-square"}`}
                  >
                    {media.type === "video" ? (
                      <div className="w-full h-full flex items-center justify-center bg-black">
                        <span className="text-white text-2xl">▶️</span>
                      </div>
                    ) : (
                      <img
                        src={media.url}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between mt-3 text-gray-400">
              <button className="flex items-center space-x-2 hover:text-blue-500">
                <span>💬</span>
                <span className="text-sm">5</span>
              </button>
              <button className="flex items-center space-x-2 hover:text-green-500">
                <span>🔄</span>
                <span className="text-sm">12</span>
              </button>
              <button className="flex items-center space-x-2 hover:text-red-500">
                <span>❤️</span>
                <span className="text-sm">89</span>
              </button>
              <button className="hover:text-blue-500">
                <span>📤</span>
              </button>
            </div>

            <div className="flex justify-end mt-1">
              <span
                className={`text-xs ${overLimit ? "text-red-500 font-medium" : "text-gray-400"}`}
              >
                {content.content.text.length}/{BLUESKY_LIMIT}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
