/**
 * @file useSchedulingDashboard.ts
 * @description Custom hook that encapsulates all state management, data loading, filtering,
 * calendar generation, and post management logic for the SchedulingDashboard component.
 * Fetches real data from the backend via the useScheduledPosts API hook.
 * @hook useSchedulingDashboard
 * @layer infrastructure
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import type {
  DashboardScheduledPost,
  DashboardCalendarDay,
  DashboardFilters,
} from "./schedulingDashboardTypes.js";
import { useScheduledPosts, useCancelScheduledPost } from "../../hooks/api/useScheduledPosts.js";
import type { ScheduledPost } from "../../types/scheduling.js";

// ---------------------------------------------------------------------------
// Hook params
// ---------------------------------------------------------------------------
interface UseSchedulingDashboardParams {
  projectId?: string;
  accountId?: string;
  onPostCancelled?: ((postId: string) => void) | undefined;
  onError?: ((error: string) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------
export interface UseSchedulingDashboardReturn {
  // Calendar / navigation state
  currentDate: Date;
  selectedDate: Date | null;
  calendarDays: DashboardCalendarDay[];
  navigateMonth: (direction: "prev" | "next") => void;
  goToToday: () => void;
  setSelectedDate: (date: Date | null) => void;

  // View mode
  view: "month" | "week" | "day" | "list";
  setView: (view: "month" | "week" | "day" | "list") => void;

  // New-post modal trigger
  setShowNewPostModal: (show: boolean) => void;

  // Post selection
  selectedPost: DashboardScheduledPost | null;
  setSelectedPost: (post: DashboardScheduledPost | null) => void;
  handlePostClick: (post: DashboardScheduledPost) => void;
  handleCancelPost: (postId: string) => Promise<void>;

  // Data
  scheduledPosts: DashboardScheduledPost[];
  filteredPosts: DashboardScheduledPost[];
  selectedDatePosts: DashboardScheduledPost[];
  isLoading: boolean;

  // Filters
  filters: DashboardFilters;
  setFilters: React.Dispatch<React.SetStateAction<DashboardFilters>>;
}

// ---------------------------------------------------------------------------
// API response → dashboard type mapper
// ---------------------------------------------------------------------------
function mapScheduledPostToDashboard(post: ScheduledPost): DashboardScheduledPost {
  const scheduledAt = post.scheduledAt ? new Date(post.scheduledAt) : new Date(post.createdAt);
  const status = mapStatus(post.status);

  return {
    id: post.id,
    title: post.content?.title ?? post.content?.body?.slice(0, 60) ?? "Untitled Post",
    content: {
      ...(post.content?.body != null && { text: post.content.body }),
    },
    contentType: "FEED",
    platforms: post.publishLogs.map((log) => log.provider),
    scheduledAt,
    status,
    timezone: "UTC",
    createdAt: new Date(post.createdAt),
    updatedAt: new Date(post.updatedAt),
    ...(post.content?.tags && post.content.tags.length > 0 && { tags: post.content.tags }),
    priority: "medium",
  };
}

function mapStatus(apiStatus: string): DashboardScheduledPost["status"] {
  switch (apiStatus) {
    case "SCHEDULED":
      return "scheduled";
    case "PUBLISHED":
      return "published";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "PUBLISHING":
      return "publishing";
    default:
      return "scheduled";
  }
}

// ---------------------------------------------------------------------------
// Calendar day generation
// ---------------------------------------------------------------------------
function generateCalendarDays(
  date: Date,
  scheduledPosts: DashboardScheduledPost[]
): DashboardCalendarDay[] {
  const year = date.getFullYear();
  const month = date.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());

  const endDate = new Date(lastDay);
  endDate.setDate(endDate.getDate() + (6 - lastDay.getDay()));

  const days: DashboardCalendarDay[] = [];
  const currentDateIterator = new Date(startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  while (currentDateIterator <= endDate) {
    const dayDate = new Date(currentDateIterator);
    dayDate.setHours(0, 0, 0, 0);

    const dayPosts = scheduledPosts.filter((post) => {
      const postDate = new Date(post.scheduledAt);
      postDate.setHours(0, 0, 0, 0);
      return postDate.getTime() === dayDate.getTime();
    });

    days.push({
      date: new Date(dayDate),
      isCurrentMonth: currentDateIterator.getMonth() === month,
      isToday: dayDate.getTime() === today.getTime(),
      posts: dayPosts,
    });

    currentDateIterator.setDate(currentDateIterator.getDate() + 1);
  }

  return days;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------
export function useSchedulingDashboard({
  projectId,
  accountId,
  onPostCancelled,
  onError,
}: UseSchedulingDashboardParams): UseSchedulingDashboardReturn {
  // Core state
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [view, setView] = useState<"month" | "week" | "day" | "list">("month");
  const [_showNewPostModal, setShowNewPostModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<DashboardScheduledPost | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>({
    platforms: [],
    contentTypes: [],
    status: [],
    priority: [],
    campaignId: "",
    assigneeId: "",
  });

  // -----------------------------------------------------------------------
  // Data loading via API
  // -----------------------------------------------------------------------
  const {
    data: apiPosts,
    isLoading,
    error: fetchError,
  } = useScheduledPosts({
    ...(projectId !== undefined && { projectId }),
    ...(accountId !== undefined && { accountId }),
    ...(filters.campaignId !== "" && { campaignId: filters.campaignId }),
    ...(filters.assigneeId !== "" && { assigneeId: filters.assigneeId }),
  });

  // Report fetch errors to the parent via effect to avoid render-loop
  useEffect(() => {
    if (fetchError) {
      onError?.(
        fetchError instanceof Error ? fetchError.message : "Failed to load scheduled posts"
      );
    }
  }, [fetchError, onError]);

  // Map API data to dashboard types
  const scheduledPosts = useMemo<DashboardScheduledPost[]>(() => {
    if (!apiPosts) return [];
    return apiPosts.map(mapScheduledPostToDashboard);
  }, [apiPosts]);

  // Cancel mutation via API
  const cancelMutation = useCancelScheduledPost();

  // -----------------------------------------------------------------------
  // Calendar days
  // -----------------------------------------------------------------------
  const calendarDays = useMemo(
    () => generateCalendarDays(currentDate, scheduledPosts),
    [currentDate, scheduledPosts]
  );

  // -----------------------------------------------------------------------
  // Filtered posts
  // -----------------------------------------------------------------------
  const filteredPosts = useMemo(() => {
    return scheduledPosts.filter((post) => {
      if (
        filters.platforms.length > 0 &&
        !filters.platforms.some((p) => post.platforms.includes(p))
      ) {
        return false;
      }
      if (filters.contentTypes.length > 0 && !filters.contentTypes.includes(post.contentType)) {
        return false;
      }
      if (filters.status.length > 0 && !filters.status.includes(post.status)) {
        return false;
      }
      if (filters.priority.length > 0 && !filters.priority.includes(post.priority)) {
        return false;
      }
      return true;
    });
  }, [scheduledPosts, filters]);

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------
  const navigateMonth = useCallback((direction: "prev" | "next") => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      if (direction === "prev") {
        newDate.setMonth(newDate.getMonth() - 1);
      } else {
        newDate.setMonth(newDate.getMonth() + 1);
      }
      return newDate;
    });
  }, []);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  }, []);

  // -----------------------------------------------------------------------
  // Post management
  // -----------------------------------------------------------------------
  const handlePostClick = useCallback((post: DashboardScheduledPost) => {
    setSelectedPost(post);
  }, []);

  const handleCancelPost = useCallback(
    async (postId: string) => {
      try {
        await cancelMutation.mutateAsync(postId);
        onPostCancelled?.(postId);
      } catch {
        onError?.("Failed to cancel post");
      }
    },
    [cancelMutation, onPostCancelled, onError]
  );

  // -----------------------------------------------------------------------
  // Posts for the selected date
  // -----------------------------------------------------------------------
  const selectedDatePosts = useMemo(() => {
    if (!selectedDate) return [];

    const selectedDateOnly = new Date(selectedDate);
    selectedDateOnly.setHours(0, 0, 0, 0);

    return filteredPosts
      .filter((post) => {
        const postDate = new Date(post.scheduledAt);
        postDate.setHours(0, 0, 0, 0);
        return postDate.getTime() === selectedDateOnly.getTime();
      })
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }, [selectedDate, filteredPosts]);

  return {
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
  };
}
