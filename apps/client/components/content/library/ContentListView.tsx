"use client";

/**
 * @file ContentListView.tsx
 * @description Table-style list layout for the content library that renders content items
 * as rows with columns for title, status, platform, type, date, and actions.
 */

import React from "react";
import type { ContentItem } from "./types";
import { getStatusColor, formatDate, truncateText } from "./utils";

interface ContentListViewProps {
  items: ContentItem[];
  selectedItems: string[];
  enableBulkActions: boolean;
  onItemSelect: (itemId: string) => void;
  onSelectAll: () => void;
  onEdit: (item: ContentItem) => void;
  onDelete: (itemId: string) => void;
}

export function ContentListView({
  items,
  selectedItems,
  enableBulkActions,
  onItemSelect,
  onSelectAll,
  onEdit,
  onDelete,
}: ContentListViewProps) {
  return (
    <div className="bg-white border rounded-lg overflow-hidden mb-8">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {enableBulkActions && (
                <th className="p-4 text-left">
                  <input
                    type="checkbox"
                    checked={selectedItems.length === items.length && items.length > 0}
                    onChange={onSelectAll}
                  />
                </th>
              )}
              <th className="p-4 text-left font-medium text-gray-900">Content</th>
              <th className="p-4 text-left font-medium text-gray-900">Status</th>
              <th className="p-4 text-left font-medium text-gray-900">Platforms</th>
              <th className="p-4 text-left font-medium text-gray-900">Performance</th>
              <th className="p-4 text-left font-medium text-gray-900">Author</th>
              <th className="p-4 text-left font-medium text-gray-900">Updated</th>
              <th className="p-4 text-left font-medium text-gray-900">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                {enableBulkActions && (
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item.id)}
                      onChange={() => onItemSelect(item.id)}
                    />
                  </td>
                )}
                <td className="p-4">
                  <div className="flex items-start space-x-3">
                    {item.content.media && item.content.media.length > 0 ? (
                      <img
                        src={
                          item.content.media?.[0]?.thumbnail ?? item.content.media?.[0]?.url ?? ""
                        }
                        alt="Content preview"
                        className="w-12 h-12 rounded-sm object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 rounded-sm flex items-center justify-center">
                        <span className="text-gray-500 text-xs">📝</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 mb-1">
                        {item.title ?? "Untitled"}
                      </div>
                      <div className="text-sm text-gray-600 line-clamp-2">
                        {truncateText(item.content.text, 120)}
                      </div>
                      {item.tags.length > 0 && (
                        <div className="mt-1">
                          {item.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="inline-block mr-1 text-xs text-blue-600">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}
                  >
                    {item.status}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex flex-wrap gap-1">
                    {item.platforms.map((platform) => (
                      <span
                        key={platform}
                        className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-sm capitalize"
                      >
                        {platform}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-4">
                  {item.performance ? (
                    <div className="text-sm">
                      <div className="font-medium">{item.performance.score.toFixed(1)}</div>
                      <div className="text-gray-500 text-xs">
                        {item.performance.totalEngagement.toLocaleString()} eng.
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-400 text-sm">No data</span>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex items-center">
                    <div className="w-8 h-8 bg-gray-300 rounded-full mr-2"></div>
                    <span className="text-sm text-gray-900">{item.author.name}</span>
                  </div>
                </td>
                <td className="p-4 text-sm text-gray-600">{formatDate(item.updatedAt)}</td>
                <td className="p-4">
                  <div className="flex space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(item);
                      }}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item.id);
                      }}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
