/**
 * @file schedulingDashboardTypes.ts
 * @description Type definitions local to the SchedulingDashboard component and its
 * sub-modules. The hook maps the shared ScheduledPost API response (types/scheduling.ts)
 * into these dashboard-specific types for rendering.
 * @layer infrastructure
 */

// ---------------------------------------------------------------------------
// Media attached to a scheduled post
// ---------------------------------------------------------------------------
export interface ScheduledPostMedia {
  id: string;
  type: "image" | "video";
  url: string;
  thumbnail?: string;
}

// ---------------------------------------------------------------------------
// Content payload for a scheduled post (legacy dashboard shape)
// ---------------------------------------------------------------------------
export interface ScheduledPostContent {
  text?: string;
  media?: ScheduledPostMedia[];
}

// ---------------------------------------------------------------------------
// A scheduled post as used within the SchedulingDashboard component tree
// ---------------------------------------------------------------------------
export interface DashboardScheduledPost {
  id: string;
  title: string;
  content: ScheduledPostContent;
  contentType: "FEED" | "STORIES" | "REELS" | "CAROUSEL";
  platforms: string[];
  scheduledAt: Date;
  status: "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
  estimatedReach?: number;
  tags?: string[];
  priority: "low" | "medium" | "high" | "urgent";
}

// ---------------------------------------------------------------------------
// A single calendar day cell
// ---------------------------------------------------------------------------
export interface DashboardCalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  posts: DashboardScheduledPost[];
}

// ---------------------------------------------------------------------------
// Active filter selections
// ---------------------------------------------------------------------------
export interface DashboardFilters {
  platforms: string[];
  contentTypes: string[];
  status: string[];
  priority: string[];
  /** Filter by campaign ID — empty string means no filter */
  campaignId: string;
  /** Filter by assignee (team member) ID — empty string means no filter */
  assigneeId: string;
}

// ---------------------------------------------------------------------------
// Props accepted by the top-level SchedulingDashboard component
// ---------------------------------------------------------------------------
export interface SchedulingDashboardProps {
  projectId: string;
  accountId: string;
  onPostScheduled?: (post: DashboardScheduledPost) => void;
  onPostUpdated?: (post: DashboardScheduledPost) => void;
  onPostCancelled?: (postId: string) => void;
  onError?: (error: string) => void;
}
