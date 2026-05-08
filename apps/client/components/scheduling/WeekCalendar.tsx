/**
 * @file WeekCalendar.tsx
 * @component WeekCalendar
 * @description Week view calendar showing 7 days with time-slot posts.
 * @layer infrastructure
 */

"use client";

import { useMemo, useCallback } from "react";
import { Button } from "@packages/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DashboardScheduledPost } from "./schedulingDashboardTypes";

interface WeekCalendarProps {
  currentDate: Date;
  posts: DashboardScheduledPost[];
  onPostClick: (post: DashboardScheduledPost) => void;
  onWeekNavigate: (direction: "prev" | "next") => void;
  onToday: () => void;
}

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 border-blue-300 text-blue-800",
  publishing: "bg-yellow-100 border-yellow-300 text-yellow-800",
  published: "bg-green-100 border-green-300 text-green-800",
  failed: "bg-red-100 border-red-300 text-red-800",
  cancelled: "bg-gray-100 border-gray-300 text-gray-500",
};

function getWeekDays(date: Date): Date[] {
  const start = new Date(date);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatWeekLabel(days: Date[]): string {
  const first = days[0];
  const last = days[6];
  if (!first || !last) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${first.toLocaleDateString("en-US", opts)} - ${last.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

export function WeekCalendar({
  currentDate,
  posts,
  onPostClick,
  onWeekNavigate,
  onToday,
}: WeekCalendarProps) {
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate]);
  const today = new Date();

  const getPostsForDayHour = useCallback(
    (day: Date, hour: number) =>
      posts.filter((p) => {
        const d = new Date(p.scheduledAt);
        return isSameDay(d, day) && d.getHours() === hour;
      }),
    [posts]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onWeekNavigate("prev")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onWeekNavigate("next")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onToday}>
            Today
          </Button>
        </div>
        <h3 className="text-sm font-medium">{formatWeekLabel(weekDays)}</h3>
      </div>

      <div className="flex-1 overflow-auto border rounded-lg">
        <div className="grid grid-cols-8 sticky top-0 bg-card z-10 border-b">
          <div className="p-2 text-xs text-muted-foreground border-r" />
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`p-2 text-center text-xs font-medium border-r last:border-r-0 ${
                isSameDay(day, today) ? "bg-primary/10 text-primary" : "text-muted-foreground"
              }`}
            >
              <div>{day.toLocaleDateString("en-US", { weekday: "short" })}</div>
              <div className="text-lg font-bold">{day.getDate()}</div>
            </div>
          ))}
        </div>

        {HOURS.map((hour) => (
          <div key={hour} className="grid grid-cols-8 border-b last:border-b-0 min-h-[48px]">
            <div className="p-1 text-xs text-muted-foreground border-r text-right pr-2 pt-1">
              {hour === 0
                ? "12 AM"
                : hour < 12
                  ? `${hour} AM`
                  : hour === 12
                    ? "12 PM"
                    : `${hour - 12} PM`}
            </div>
            {weekDays.map((day) => {
              const dayPosts = getPostsForDayHour(day, hour);
              return (
                <div
                  key={day.toISOString()}
                  className="p-0.5 border-r last:border-r-0 min-h-[48px]"
                >
                  {dayPosts.map((post) => (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() => onPostClick(post)}
                      className={`w-full text-left rounded px-1.5 py-0.5 text-xs truncate border mb-0.5 ${
                        STATUS_COLORS[post.status] ?? STATUS_COLORS.scheduled
                      }`}
                    >
                      {post.title || post.platforms.join(", ")}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
