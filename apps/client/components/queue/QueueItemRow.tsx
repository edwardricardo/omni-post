/**
 * @file QueueItemRow.tsx
 * @description Table row component representing a single publishing queue item, showing
 * content preview, platform, status badge, priority, scheduled time, and action controls.
 */

import React from "react";
import type { QueueItem } from "./types";
import { getStatusColor, getPriorityColor, formatTimeAgo } from "./queueUtils";

interface QueueItemRowProps {
  item: QueueItem;
  isSelected: boolean;
  isLoading: boolean;
  onToggleSelect: (itemId: string, checked: boolean) => void;
  onRetry: (itemId: string) => void;
  onCancel: (itemId: string) => void;
  onDelete: (itemId: string) => void;
}

export function QueueItemRow({
  item,
  isSelected,
  isLoading,
  onToggleSelect,
  onRetry,
  onCancel,
  onDelete,
}: QueueItemRowProps) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="p-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onToggleSelect(item.id, e.target.checked)}
        />
      </td>
      <td className="p-4">
        <div className="max-w-xs">
          <div className="font-medium text-gray-900 truncate">
            {item.content.text.slice(0, 60)}
            {item.content.text.length > 60 && "..."}
          </div>
          {item.content.media && item.content.media.length > 0 && (
            <div className="text-sm text-gray-500">
              📎 {item.content.media.length} media file(s)
            </div>
          )}
          {item.scheduledFor && (
            <div className="text-sm text-gray-500">📅 {item.scheduledFor.toLocaleString()}</div>
          )}
        </div>
      </td>
      <td className="p-4">
        <div className="flex flex-wrap gap-1">
          {item.providers.map((provider) => (
            <span key={provider} className="px-2 py-1 bg-gray-100 text-gray-700 rounded-sm text-xs">
              {provider}
            </span>
          ))}
        </div>
      </td>
      <td className="p-4">
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}
        >
          {item.status}
        </span>
        {item.status === "processing" && item.progress && (
          <div className="mt-1 w-20 bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}
      </td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${getPriorityColor(item.priority)}`} />
          <span className="text-sm capitalize">{item.priority}</span>
        </div>
      </td>
      <td className="p-4 text-sm text-gray-600">{formatTimeAgo(item.createdAt)}</td>
      <td className="p-4">
        <div className="flex gap-2">
          {item.status === "failed" && item.attempts < item.maxAttempts && (
            <button
              onClick={() => onRetry(item.id)}
              disabled={isLoading}
              className="px-2 py-1 bg-blue-600 text-white text-xs rounded-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Retry
            </button>
          )}
          {(item.status === "queued" || item.status === "processing") && (
            <button
              onClick={() => onCancel(item.id)}
              disabled={isLoading}
              className="px-2 py-1 bg-red-600 text-white text-xs rounded-sm hover:bg-red-700 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => onDelete(item.id)}
            disabled={isLoading}
            className="px-2 py-1 bg-gray-600 text-white text-xs rounded-sm hover:bg-gray-700 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
