"use client";

/**
 * @file SchedulingDashboardPostModal.tsx
 * @description Modal overlay that displays detailed information about a selected scheduled
 * post, including status, priority, scheduled time, content preview, media grid, error
 * messages, tags, estimated reach, and action buttons (edit, reschedule, retry, cancel).
 * @component SchedulingDashboardPostModal
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import type { DashboardScheduledPost } from "./schedulingDashboardTypes";
import {
  getStatusColor,
  getPriorityColor,
  getContentTypeIcon,
  formatRelativeTime,
} from "./schedulingDashboardUtils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface SchedulingDashboardPostModalProps {
  post: DashboardScheduledPost;
  onClose: () => void;
  onCancel: (postId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SchedulingDashboardPostModal({
  post,
  onClose,
  onCancel,
}: SchedulingDashboardPostModalProps) {
  const t = useTranslations("scheduling.components");
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">{post.title}</h3>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          <div className="space-y-4">
            {/* Status and Priority */}
            <div className="flex items-center space-x-3">
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(post.status)}`}
              >
                {t(`status.${post.status}`)}
              </span>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${getPriorityColor(post.priority)}`}></div>
                <span className="text-sm text-gray-600 capitalize">
                  {t("modalPriority", { priority: post.priority })}
                </span>
              </div>
              <span className="text-sm text-gray-600">
                {getContentTypeIcon(post.contentType)} {post.contentType}
              </span>
            </div>

            {/* Scheduled Time */}
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1">
                {t("modalScheduledTime")}
              </span>
              <div className="text-lg text-gray-900">
                {post.scheduledAt.toLocaleString()} ({formatRelativeTime(post.scheduledAt)})
              </div>
            </div>

            {/* Content */}
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1">
                {t("modalContent")}
              </span>
              <div className="border rounded-lg p-3 bg-gray-50">{post.content.text}</div>
            </div>

            {/* Media */}
            {post.content.media && post.content.media.length > 0 && (
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1">
                  {t("modalMedia", { count: post.content.media.length })}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {post.content.media.map((media) => (
                    <div
                      key={media.id}
                      className="aspect-square bg-gray-100 rounded-lg overflow-hidden"
                    >
                      {media.type === "image" ? (
                        <img
                          src={media.thumbnail || media.url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Message */}
            {post.error && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="text-sm font-medium text-red-800 mb-1">{t("modalErrorLabel")}</div>
                <div className="text-sm text-red-700">{post.error}</div>
              </div>
            )}

            {/* Tags */}
            {post.tags && post.tags.length > 0 && (
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1">
                  {t("modalTags")}
                </span>
                <div className="flex flex-wrap gap-1">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-sm"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Estimated Reach */}
            {post.estimatedReach && (
              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1">
                  {t("modalEstimatedReach")}
                </span>
                <div className="text-lg text-gray-900">
                  {t("modalReachPeople", { value: post.estimatedReach.toLocaleString() })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 border-t bg-gray-50 flex justify-between">
          <div className="flex space-x-2">
            {post.status === "scheduled" && (
              <>
                <button
                  onClick={() => {
                    // Not yet implemented — requires post editing modal
                    void post.id;
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  {t("modalEdit")}
                </button>
                <button
                  onClick={() => {
                    // Not yet implemented — requires date picker dialog
                    void post.id;
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  {t("modalReschedule")}
                </button>
              </>
            )}
            {post.status === "failed" && (
              <button
                onClick={() => {
                  // Not yet implemented — requires republish queue integration
                  void post.id;
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t("modalRetry")}
              </button>
            )}
          </div>

          <div className="flex space-x-2">
            {(post.status === "scheduled" || post.status === "failed") && (
              <button
                onClick={() => {
                  onCancel(post.id);
                  onClose();
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                {t("cancel")}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              {t("modalClose")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
