/**
 * @file scheduling.ts
 * @description Shared TypeScript type definitions for the scheduling feature: ScheduledPost,
 * CalendarDay, ScheduleFilters, and ViewMode used across scheduling components and hooks.
 */
// Shared scheduling types — mirrors backend API response shapes.

export interface ScheduledPost {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  content: {
    locale: string;
    title: string | null;
    body: string;
    tags: string[];
  } | null;
  publishLogs: Array<{
    id: string;
    provider: string;
    status: string;
    createdAt: string;
    payload?: unknown;
  }>;
}

export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  posts: ScheduledPost[];
}

export interface ScheduleFilters {
  platforms: string[];
  contentTypes: string[];
  status: string[];
  priority: string[];
}

export type ViewMode = "month" | "week" | "day" | "list";
