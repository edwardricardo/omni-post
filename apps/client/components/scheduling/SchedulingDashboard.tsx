"use client";

/**
 * @file SchedulingDashboard.tsx
 * @description Top-level orchestrator for the content scheduling dashboard. Composes the
 * header, sidebar (filters + post list), calendar grid, post detail modal, and loading
 * overlay. All state management lives in the useSchedulingDashboard hook; all visual
 * sub-sections live in dedicated child components.
 * @component SchedulingDashboard
 * @layer infrastructure
 */

import React, { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { SchedulingDashboardProps } from "./schedulingDashboardTypes.js";
import { useSchedulingDashboard } from "./useSchedulingDashboard.js";
import { SchedulingDashboardSidebar } from "./SchedulingDashboardSidebar.js";
import { SchedulingDashboardCalendar } from "./SchedulingDashboardCalendar.js";
import { SchedulingDashboardPostModal } from "./SchedulingDashboardPostModal.js";
import { WeekCalendar } from "./WeekCalendar.js";
import { DayCalendar } from "./DayCalendar.js";

export function SchedulingDashboard({
  projectId,
  accountId,
  onPostScheduled: _onPostScheduled,
  onPostUpdated: _onPostUpdated,
  onPostCancelled,
  onError,
}: SchedulingDashboardProps) {
  const t = useTranslations("scheduling.components");
  const {
    currentDate,
    selectedDate,
    calendarDays,
    navigateMonth,
    goToToday,
    setSelectedDate,
    view,
    setView,
    setShowNewPostModal,
    selectedPost,
    setSelectedPost,
    handlePostClick,
    handleCancelPost,
    scheduledPosts,
    filteredPosts,
    selectedDatePosts,
    isLoading,
    filters,
    setFilters,
  } = useSchedulingDashboard({ projectId, accountId, onPostCancelled, onError });

  const [weekDate, setWeekDate] = useState(currentDate);
  const [dayDate, setDayDate] = useState(currentDate);

  const navigateWeek = useCallback((direction: "prev" | "next") => {
    setWeekDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + (direction === "next" ? 7 : -7));
      return d;
    });
  }, []);

  const navigateDay = useCallback((direction: "prev" | "next") => {
    setDayDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + (direction === "next" ? 1 : -1));
      return d;
    });
  }, []);

  const goToTodayWeek = useCallback(() => {
    setWeekDate(new Date());
  }, []);
  const goToTodayDay = useCallback(() => {
    setDayDate(new Date());
  }, []);

  return (
    <div className="scheduling-dashboard h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("dashboardTitle")}</h1>
            <p className="text-gray-600 mt-1">{t("dashboardSubtitle")}</p>
          </div>

          <div className="flex items-center space-x-4">
            {/* View Toggle */}
            <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
              {(["month", "week", "day", "list"] as const).map((viewOption) => (
                <button
                  key={viewOption}
                  onClick={() => setView(viewOption)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === viewOption
                      ? "bg-white text-gray-900 shadow-xs"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {t(`dashboardView.${viewOption}`)}
                </button>
              ))}
            </div>

            {/* New Post Button */}
            <button
              onClick={() => setShowNewPostModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>{t("schedulePost")}</span>
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-lg font-semibold text-blue-900">
              {scheduledPosts.filter((p) => p.status === "scheduled").length}
            </div>
            <div className="text-sm text-blue-700">{t("statScheduled")}</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3">
            <div className="text-lg font-semibold text-yellow-900">
              {scheduledPosts.filter((p) => p.status === "publishing").length}
            </div>
            <div className="text-sm text-yellow-700">{t("statPublishing")}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <div className="text-lg font-semibold text-green-900">
              {scheduledPosts.filter((p) => p.status === "published").length}
            </div>
            <div className="text-sm text-green-700">{t("statPublished")}</div>
          </div>
          <div className="bg-red-50 rounded-lg p-3">
            <div className="text-lg font-semibold text-red-900">
              {scheduledPosts.filter((p) => p.status === "failed").length}
            </div>
            <div className="text-sm text-red-700">{t("statFailed")}</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3">
            <div className="text-lg font-semibold text-purple-900">
              {scheduledPosts.reduce((sum, p) => sum + (p.estimatedReach || 0), 0).toLocaleString()}
            </div>
            <div className="text-sm text-purple-700">{t("statReach")}</div>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Filters & Today's Posts */}
        <SchedulingDashboardSidebar
          filters={filters}
          setFilters={setFilters}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          filteredPosts={filteredPosts}
          selectedDatePosts={selectedDatePosts}
          onPostClick={handlePostClick}
          projectId={projectId}
        />

        {/* Main Calendar Area */}
        <div className="flex-1 flex flex-col">
          {view === "month" && (
            <SchedulingDashboardCalendar
              currentDate={currentDate}
              calendarDays={calendarDays}
              onDateSelect={setSelectedDate}
              onPostClick={handlePostClick}
              onMonthNavigate={navigateMonth}
              onToday={goToToday}
            />
          )}

          {view === "week" && (
            <WeekCalendar
              currentDate={weekDate}
              posts={filteredPosts}
              onPostClick={handlePostClick}
              onWeekNavigate={navigateWeek}
              onToday={goToTodayWeek}
            />
          )}

          {view === "day" && (
            <DayCalendar
              currentDate={dayDate}
              posts={filteredPosts}
              onPostClick={handlePostClick}
              onDayNavigate={navigateDay}
              onToday={goToTodayDay}
            />
          )}

          {view === "list" && (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <div className="text-lg font-medium">{t("listViewComingSoon")}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Post Detail Modal */}
      {selectedPost && (
        <SchedulingDashboardPostModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onCancel={handleCancelPost}
        />
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg p-6">
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-gray-900">{t("loadingPosts")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
