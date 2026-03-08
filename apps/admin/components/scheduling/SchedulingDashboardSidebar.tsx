"use client";

/**
 * @file SchedulingDashboardSidebar.tsx
 * @description Left sidebar of the SchedulingDashboard containing filter controls and
 * a scrollable list of posts for the selected (or today's) date.
 */

import React from "react";
import type { DashboardScheduledPost, DashboardFilters } from "./schedulingDashboardTypes";
import {
  getStatusColor,
  getPriorityColor,
  getContentTypeIcon,
  formatTime,
  formatRelativeTime,
} from "./schedulingDashboardUtils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface SchedulingDashboardSidebarProps {
  filters: DashboardFilters;
  setFilters: React.Dispatch<React.SetStateAction<DashboardFilters>>;
  selectedDate: Date | null;
  setSelectedDate: (date: Date | null) => void;
  filteredPosts: DashboardScheduledPost[];
  selectedDatePosts: DashboardScheduledPost[];
  onPostClick: (post: DashboardScheduledPost) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SchedulingDashboardSidebar({
  filters,
  setFilters,
  selectedDate,
  setSelectedDate,
  filteredPosts,
  selectedDatePosts,
  onPostClick,
}: SchedulingDashboardSidebarProps) {
  // Determine which posts to show in the sidebar list
  const sidebarPosts = selectedDate
    ? selectedDatePosts
    : filteredPosts.filter((post) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const postDate = new Date(post.scheduledAt);
        return postDate >= today && postDate < tomorrow;
      });

  return (
    <div className="w-80 bg-white border-r flex flex-col">
      {/* Filters */}
      <div className="p-4 border-b">
        <h3 className="font-medium text-gray-900 mb-3">Filters</h3>

        <div className="space-y-4">
          {/* Platform Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Platforms</label>
            <div className="space-y-1">
              {["instagram", "facebook", "x"].map((platform) => (
                <label key={platform} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.platforms.includes(platform)}
                    onChange={(e) => {
                      setFilters((prev) => ({
                        ...prev,
                        platforms: e.target.checked
                          ? [...prev.platforms, platform]
                          : prev.platforms.filter((p) => p !== platform),
                      }));
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700 capitalize">{platform}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Content Type Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
            <div className="space-y-1">
              {(["FEED", "STORIES", "REELS", "CAROUSEL"] as const).map((type) => (
                <label key={type} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.contentTypes.includes(type)}
                    onChange={(e) => {
                      setFilters((prev) => ({
                        ...prev,
                        contentTypes: e.target.checked
                          ? [...prev.contentTypes, type]
                          : prev.contentTypes.filter((t) => t !== type),
                      }));
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">
                    {getContentTypeIcon(type)} {type}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <div className="space-y-1">
              {["scheduled", "publishing", "published", "failed", "cancelled"].map((status) => (
                <label key={status} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.status.includes(status)}
                    onChange={(e) => {
                      setFilters((prev) => ({
                        ...prev,
                        status: e.target.checked
                          ? [...prev.status, status]
                          : prev.status.filter((s) => s !== status),
                      }));
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700 capitalize">{status}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Posts for selected date / today */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900">
            {selectedDate ? selectedDate.toLocaleDateString() : "Today's Posts"}
          </h3>
          {selectedDate && (
            <button
              onClick={() => setSelectedDate(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </div>

        <div className="space-y-3">
          {sidebarPosts.map((post) => (
            <div
              key={post.id}
              className="border rounded-lg p-3 cursor-pointer hover:border-gray-300 transition-colors"
              onClick={() => onPostClick(post)}
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <div className="text-lg">{getContentTypeIcon(post.contentType)}</div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(post.status)}`}
                    >
                      {post.status}
                    </span>
                    <div
                      className={`w-2 h-2 rounded-full ${getPriorityColor(post.priority)}`}
                    ></div>
                  </div>

                  <div className="font-medium text-gray-900 text-sm truncate">{post.title}</div>

                  <div className="text-xs text-gray-500 mt-1">
                    {formatTime(post.scheduledAt)} {"\u2022"} {formatRelativeTime(post.scheduledAt)}
                  </div>

                  {post.content.text && (
                    <div className="text-xs text-gray-600 mt-1 line-clamp-2">
                      {post.content.text.slice(0, 80)}...
                    </div>
                  )}

                  {post.error && <div className="text-xs text-red-600 mt-1">{post.error}</div>}
                </div>
              </div>
            </div>
          ))}

          {sidebarPosts.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <div className="text-2xl mb-2">{"\u{1F4C5}"}</div>
              <div className="text-sm">
                {selectedDate ? "No posts scheduled for this date" : "No posts scheduled for today"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
