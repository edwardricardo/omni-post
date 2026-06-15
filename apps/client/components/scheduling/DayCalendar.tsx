/**
 * @file DayCalendar.tsx
 * @component DayCalendar
 * @description Day view calendar showing a single day with detailed time slots.
 * @layer infrastructure
 */

"use client";

import { useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DashboardScheduledPost } from "./schedulingDashboardTypes.js";

interface DayCalendarProps {
  currentDate: Date;
  posts: DashboardScheduledPost[];
  onPostClick: (post: DashboardScheduledPost) => void;
  onDayNavigate: (direction: "prev" | "next") => void;
  onToday: () => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-50 border-blue-200 text-blue-800",
  publishing: "bg-yellow-50 border-yellow-200 text-yellow-800",
  published: "bg-green-50 border-green-200 text-green-800",
  failed: "bg-red-50 border-red-200 text-red-800",
  cancelled: "bg-gray-50 border-gray-200 text-gray-500",
};

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function DayCalendar({
  currentDate,
  posts,
  onPostClick,
  onDayNavigate,
  onToday,
}: DayCalendarProps) {
  const t = useTranslations("scheduling.components");
  const today = new Date();
  const isToday = isSameDay(currentDate, today);

  const dayPosts = useMemo(
    () => posts.filter((p) => isSameDay(new Date(p.scheduledAt), currentDate)),
    [posts, currentDate]
  );

  const getPostsForHour = useCallback(
    (hour: number) => dayPosts.filter((p) => new Date(p.scheduledAt).getHours() === hour),
    [dayPosts]
  );

  const dateLabel = currentDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onDayNavigate("prev")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onDayNavigate("next")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onToday}>
            {t("today")}
          </Button>
        </div>
        <h3 className={`text-sm font-medium ${isToday ? "text-primary" : ""}`}>
          {dateLabel}
          {isToday && (
            <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {t("today")}
            </span>
          )}
        </h3>
      </div>

      <div className="text-xs text-muted-foreground mb-2">
        {t("postsScheduledCount", { count: dayPosts.length })}
      </div>

      <div className="flex-1 overflow-auto border rounded-lg">
        {HOURS.map((hour) => {
          const hourPosts = getPostsForHour(hour);
          const timeLabel =
            hour === 0
              ? "12 AM"
              : hour < 12
                ? `${hour} AM`
                : hour === 12
                  ? "12 PM"
                  : `${hour - 12} PM`;
          const isCurrentHour = isToday && today.getHours() === hour;

          return (
            <div
              key={hour}
              className={`flex border-b last:border-b-0 min-h-[56px] ${isCurrentHour ? "bg-primary/5" : ""}`}
            >
              <div className="w-16 shrink-0 p-2 text-xs text-muted-foreground text-right border-r">
                {timeLabel}
              </div>
              <div className="flex-1 p-1 space-y-1">
                {hourPosts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => onPostClick(post)}
                    className={`w-full text-left rounded-md border p-2 transition-shadow hover:shadow-sm ${
                      STATUS_COLORS[post.status] ?? STATUS_COLORS.scheduled
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">
                        {post.title || t("untitledPost")}
                      </span>
                      <span className="text-xs shrink-0">
                        {new Date(post.scheduledAt).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="text-xs mt-1 opacity-75">{post.platforms.join(" · ")}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
