"use client";

/**
 * @file SchedulingDashboardSidebar.tsx
 * @component SchedulingDashboardSidebar
 * @description Left sidebar of the SchedulingDashboard containing filter controls and
 * a scrollable list of posts for the selected (or today's) date.
 */

import React, { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useLogger, extractErrorInfo } from "@observability/browser-logger";
import type { DashboardScheduledPost, DashboardFilters } from "./schedulingDashboardTypes";
import {
  getStatusColor,
  getPriorityColor,
  getContentTypeIcon,
  formatTime,
  formatRelativeTime,
} from "./schedulingDashboardUtils";
import { useSchedulingDashboardSidebar } from "../../hooks/useSchedulingDashboardSidebar";

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
  /** Project ID used to load campaign and assignee filter options */
  projectId?: string;
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
  projectId,
}: SchedulingDashboardSidebarProps) {
  const t = useTranslations("scheduling.components");
  const logger = useLogger("client.scheduling-sidebar");
  const { campaigns: campaignsQuery, team: teamQuery } = useSchedulingDashboardSidebar(projectId);

  // Graceful degradation: a load failure leaves the dropdown empty rather
  // than blocking the rest of the sidebar. The query already opts out of the
  // global error toast (see schedulingQueries `meta.suppressGlobalErrorToast`);
  // we still log so persistent failures show up in APM.
  useEffect(() => {
    if (campaignsQuery.error) {
      logger.warn("Failed to load campaign filter options", {
        err: extractErrorInfo(campaignsQuery.error),
        projectId,
      });
    }
  }, [campaignsQuery.error, logger, projectId]);

  useEffect(() => {
    if (teamQuery.error) {
      logger.warn("Failed to load team filter options", {
        err: extractErrorInfo(teamQuery.error),
        projectId,
      });
    }
  }, [teamQuery.error, logger, projectId]);

  const campaigns = campaignsQuery.data ?? [];
  const teamMembers = teamQuery.data ?? [];

  const hasActiveFilters =
    filters.platforms.length > 0 ||
    filters.contentTypes.length > 0 ||
    filters.status.length > 0 ||
    filters.campaignId !== "" ||
    filters.assigneeId !== "";

  const clearFilters = () => {
    setFilters({
      platforms: [],
      contentTypes: [],
      status: [],
      priority: [],
      campaignId: "",
      assigneeId: "",
    });
  };
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900">{t("filtersTitle")}</h3>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
            >
              {t("clearFilters")}
            </button>
          )}
        </div>

        <div className="space-y-4">
          {/* Platform Filter */}
          <fieldset className="border-0 p-0 m-0 min-w-0">
            <legend className="block text-sm font-medium text-gray-700 mb-2 p-0">
              {t("filterPlatformsLegend")}
            </legend>
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
          </fieldset>

          {/* Content Type Filter */}
          <fieldset className="border-0 p-0 m-0 min-w-0">
            <legend className="block text-sm font-medium text-gray-700 mb-2 p-0">
              {t("filterContentTypeLegend")}
            </legend>
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
                    {getContentTypeIcon(type)} {t(`contentType.${type}`)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Status Filter */}
          <fieldset className="border-0 p-0 m-0 min-w-0">
            <legend className="block text-sm font-medium text-gray-700 mb-2 p-0">
              {t("filterStatusLegend")}
            </legend>
            <div className="space-y-1">
              {(["scheduled", "publishing", "published", "failed", "cancelled"] as const).map(
                (status) => (
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
                    <span className="ml-2 text-sm text-gray-700">{t(`status.${status}`)}</span>
                  </label>
                )
              )}
            </div>
          </fieldset>

          {/* Campaign Filter */}
          <div>
            <label
              htmlFor="filter-campaign"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              {t("filterCampaign")}
            </label>
            <select
              id="filter-campaign"
              value={filters.campaignId}
              onChange={(e) => setFilters((prev) => ({ ...prev, campaignId: e.target.value }))}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("filterAllCampaigns")}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Assignee Filter */}
          <div>
            <label
              htmlFor="filter-assignee"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              {t("filterAssignee")}
            </label>
            <select
              id="filter-assignee"
              value={filters.assigneeId}
              onChange={(e) => setFilters((prev) => ({ ...prev, assigneeId: e.target.value }))}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("filterAllAssignees")}</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Posts for selected date / today */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900">
            {selectedDate ? selectedDate.toLocaleDateString() : t("todaysPosts")}
          </h3>
          {selectedDate && (
            <button
              onClick={() => setSelectedDate(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {t("clear")}
            </button>
          )}
        </div>

        <div className="space-y-3">
          {sidebarPosts.map((post) => (
            <div
              key={post.id}
              role="button"
              tabIndex={0}
              aria-label={t("openPost", { title: post.title ?? "" }).trim()}
              className="border rounded-lg p-3 cursor-pointer hover:border-gray-300 transition-colors"
              onClick={() => onPostClick(post)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPostClick(post);
                }
              }}
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
                      {t(`status.${post.status}`)}
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
                {selectedDate ? t("noPostsForDate") : t("noPostsForToday")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
