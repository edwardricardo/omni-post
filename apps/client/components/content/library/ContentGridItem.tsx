"use client";

/**
 * @file ContentGridItem.tsx
 * @description Individual card component rendered inside the content grid view, displaying
 * a content item's thumbnail, title, status badge, metadata, tag chips, and action buttons.
 */

import React from "react";
import type { ContentItem } from "./types";
import { getStatusColor, formatDate, truncateText } from "./utils";

interface ContentGridItemProps {
  item: ContentItem;
  isSelected: boolean;
  enableBulkActions: boolean;
  onSelect: (itemId: string) => void;
  onItemClick: (item: ContentItem) => void;
  /** Called when a tag chip is clicked — triggers a tag filter */
  onTagClick?: (tag: string) => void;
}

/**
 * @component ContentGridItem
 * @description Card rendered inside the content grid view, displaying thumbnail, title,
 * status badge, metadata, tag chips, and action buttons for a single content item.
 * @param props.onTagClick - Triggers a tag filter when a tag chip is clicked
 */
export function ContentGridItem({
  item,
  isSelected,
  enableBulkActions,
  onSelect,
  onItemClick,
  onTagClick,
}: ContentGridItemProps) {
  return (
    <div
      className={`bg-white border rounded-lg overflow-hidden hover:shadow-lg transition-shadow cursor-pointer ${
        isSelected ? "ring-2 ring-blue-500" : ""
      }`}
      onClick={() => onItemClick(item)}
    >
      {enableBulkActions && (
        <div className="absolute top-2 left-2 z-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
            className="w-4 h-4"
          />
        </div>
      )}

      {/* Media preview */}
      {item.content.media && item.content.media.length > 0 ? (
        <div className="h-48 bg-gray-200 relative">
          <img
            src={item.content.media?.[0]?.thumbnail ?? item.content.media?.[0]?.url ?? ""}
            alt={item.content.media?.[0]?.alt ?? "Content media"}
            className="w-full h-full object-cover"
          />
          {item.content.media.length > 1 && (
            <div className="absolute top-2 right-2 bg-black bg-opacity-60 text-white px-2 py-1 rounded-sm text-xs">
              +{item.content.media.length - 1}
            </div>
          )}
        </div>
      ) : (
        <div className="h-48 bg-linear-to-br from-blue-100 to-purple-100 flex items-center justify-center">
          <div className="text-center">
            <div className="text-2xl mb-2">📝</div>
            <div className="text-sm text-gray-600">Text Only</div>
          </div>
        </div>
      )}

      <div className="p-4">
        {/* Status and date */}
        <div className="flex items-center justify-between mb-2">
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}
          >
            {item.status}
          </span>
          <span className="text-xs text-gray-500">{formatDate(item.updatedAt)}</span>
        </div>

        {/* Title or content preview */}
        <h3 className="font-medium text-gray-900 mb-2 line-clamp-2">
          {item.title ?? truncateText(item.content.text, 60)}
        </h3>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {item.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick?.(tag);
                }}
                className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                  onTagClick
                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                    : "bg-emerald-50 text-emerald-700"
                }`}
                role={onTagClick ? "button" : undefined}
                tabIndex={onTagClick ? 0 : undefined}
                onKeyDown={
                  onTagClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          onTagClick(tag);
                        }
                      }
                    : undefined
                }
              >
                #{tag}
              </span>
            ))}
            {item.tags.length > 4 && (
              <span className="text-xs text-gray-400">+{item.tags.length - 4}</span>
            )}
          </div>
        )}

        {/* Platforms */}
        <div className="flex flex-wrap gap-1 mb-2">
          {item.platforms.map((platform) => (
            <span
              key={platform}
              className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-sm capitalize"
            >
              {platform}
            </span>
          ))}
        </div>

        {/* Performance */}
        {item.performance && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{item.performance.totalEngagement.toLocaleString()} engagements</span>
            <span className="font-medium">{item.performance.score.toFixed(1)} score</span>
          </div>
        )}

        {/* Author */}
        <div className="flex items-center mt-3 pt-3 border-t">
          <div className="w-6 h-6 bg-gray-300 rounded-full mr-2"></div>
          <span className="text-xs text-gray-600">{item.author.name}</span>
        </div>
      </div>
    </div>
  );
}
