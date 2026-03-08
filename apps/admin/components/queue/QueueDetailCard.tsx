/**
 * @file QueueDetailCard.tsx
 * @description Detail card component for a selected queue item, showing expanded content,
 * full metadata, platform settings, scheduling info, and available management actions.
 */

import React from "react";
import type { QueueItem } from "./types";
import { getStatusColor, getPriorityColor } from "./queueUtils";

interface QueueDetailCardProps {
  item: QueueItem;
  onRetry: (itemId: string) => void;
  onCancel: (itemId: string) => void;
}

export function QueueDetailCard({ item, onRetry, onCancel }: QueueDetailCardProps) {
  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}
            >
              {item.status}
            </span>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getPriorityColor(item.priority)}`} />
              <span className="text-sm capitalize">{item.priority} priority</span>
            </div>
            <span className="text-sm text-gray-500">
              Attempt {item.attempts}/{item.maxAttempts}
            </span>
          </div>
          <h3 className="font-medium text-gray-900 mb-2">{item.content.text}</h3>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>Platforms: {item.providers.join(", ")}</span>
            <span>Created: {item.createdAt.toLocaleString()}</span>
            {item.scheduledFor && <span>Scheduled: {item.scheduledFor.toLocaleString()}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {item.status === "failed" && item.attempts < item.maxAttempts && (
            <button
              onClick={() => onRetry(item.id)}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded-sm hover:bg-blue-700"
            >
              Retry
            </button>
          )}
          {(item.status === "queued" || item.status === "processing") && (
            <button
              onClick={() => onCancel(item.id)}
              className="px-3 py-1 bg-red-600 text-white text-sm rounded-sm hover:bg-red-700"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {item.status === "processing" && item.progress && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span>Publishing progress</span>
            <span>{item.progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        </div>
      )}

      {item.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="text-sm font-medium text-red-800 mb-1">Error:</div>
          <div className="text-sm text-red-700">{item.error}</div>
        </div>
      )}

      {item.content.media && item.content.media.length > 0 && (
        <div className="mb-4">
          <div className="text-sm font-medium text-gray-700 mb-2">Media files:</div>
          <div className="flex gap-2">
            {item.content.media.map((media) => (
              <div
                key={media.id}
                className="w-16 h-16 bg-gray-200 rounded-sm flex items-center justify-center text-xs"
              >
                {media.type}
              </div>
            ))}
          </div>
        </div>
      )}

      {item.metadata && (
        <div className="text-sm text-gray-600">
          {item.metadata.estimatedTime && (
            <div>Estimated processing time: {item.metadata.estimatedTime} seconds</div>
          )}
          {item.metadata.retryReason && <div>Retry reason: {item.metadata.retryReason}</div>}
        </div>
      )}
    </div>
  );
}
