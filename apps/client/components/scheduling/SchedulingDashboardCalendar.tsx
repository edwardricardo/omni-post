"use client";

/**
 * @file SchedulingDashboardCalendar.tsx
 * @description Month view calendar grid for the SchedulingDashboard, including the
 * month navigation header, day-of-week column headers, and per-day post badges.
 * @component SchedulingDashboardCalendar
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import type { DashboardScheduledPost, DashboardCalendarDay } from "./schedulingDashboardTypes";
import { getStatusColor, getContentTypeIcon } from "./schedulingDashboardUtils";

const DAY_KEYS = [
  "daysShort.sun",
  "daysShort.mon",
  "daysShort.tue",
  "daysShort.wed",
  "daysShort.thu",
  "daysShort.fri",
  "daysShort.sat",
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface SchedulingDashboardCalendarProps {
  currentDate: Date;
  calendarDays: DashboardCalendarDay[];
  onDateSelect: (date: Date) => void;
  onPostClick: (post: DashboardScheduledPost) => void;
  onMonthNavigate: (direction: "prev" | "next") => void;
  onToday: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SchedulingDashboardCalendar({
  currentDate,
  calendarDays,
  onDateSelect,
  onPostClick,
  onMonthNavigate,
  onToday,
}: SchedulingDashboardCalendarProps) {
  const t = useTranslations("scheduling.components");
  return (
    <div className="flex-1 flex flex-col">
      {/* Calendar Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-xl font-semibold text-gray-900">
            {currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </h2>
          <div className="flex space-x-2">
            <button
              onClick={() => onMonthNavigate("prev")}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <button
              onClick={() => onMonthNavigate("next")}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        </div>

        <button
          onClick={onToday}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
        >
          {t("today")}
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 bg-white">
        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b">
          {DAY_KEYS.map((dayKey) => (
            <div
              key={dayKey}
              className="p-3 text-center text-sm font-medium text-gray-700 border-r last:border-r-0"
            >
              {t(dayKey)}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 flex-1" style={{ gridTemplateRows: "repeat(6, 1fr)" }}>
          {calendarDays.map((day, index) => (
            <div
              key={index}
              role="button"
              tabIndex={0}
              aria-label={t("selectDate", { date: day.date.toDateString() })}
              className={`border-r last:border-r-0 border-b last:border-b-0 p-2 cursor-pointer hover:bg-gray-50 ${
                !day.isCurrentMonth ? "bg-gray-50" : ""
              } ${day.isToday ? "bg-blue-50" : ""}`}
              onClick={() => onDateSelect(day.date)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onDateSelect(day.date);
                }
              }}
            >
              <div className="h-full flex flex-col">
                <div
                  className={`text-sm font-medium mb-1 ${
                    !day.isCurrentMonth
                      ? "text-gray-400"
                      : day.isToday
                        ? "text-blue-600"
                        : "text-gray-900"
                  }`}
                >
                  {day.date.getDate()}
                </div>

                <div className="space-y-1 overflow-hidden">
                  {day.posts.slice(0, 3).map((post) => (
                    <div
                      key={post.id}
                      role="button"
                      tabIndex={0}
                      aria-label={t("openPost", { title: post.title })}
                      className={`text-xs px-1.5 py-0.5 rounded-sm ${getStatusColor(post.status)} truncate`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPostClick(post);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onPostClick(post);
                        }
                      }}
                    >
                      {getContentTypeIcon(post.contentType)} {post.title}
                    </div>
                  ))}
                  {day.posts.length > 3 && (
                    <div className="text-xs text-gray-500 px-1.5">
                      {t("moreCount", { count: day.posts.length - 3 })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
