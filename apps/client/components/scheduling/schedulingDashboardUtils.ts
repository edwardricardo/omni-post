/**
 * @file schedulingDashboardUtils.ts
 * @description Pure utility functions used exclusively by the SchedulingDashboard component
 * tree. These operate on the legacy DashboardScheduledPost type.
 */

import type { DashboardScheduledPost } from "./schedulingDashboardTypes";

// ---------------------------------------------------------------------------
// Status badge color
// ---------------------------------------------------------------------------
export function getStatusColor(status: DashboardScheduledPost["status"]): string {
  switch (status) {
    case "scheduled":
      return "bg-blue-100 text-blue-800";
    case "publishing":
      return "bg-yellow-100 text-yellow-800";
    case "published":
      return "bg-green-100 text-green-800";
    case "failed":
      return "bg-red-100 text-red-800";
    case "cancelled":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ---------------------------------------------------------------------------
// Priority dot color
// ---------------------------------------------------------------------------
export function getPriorityColor(priority: DashboardScheduledPost["priority"]): string {
  switch (priority) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-orange-500";
    case "medium":
      return "bg-yellow-500";
    case "low":
      return "bg-green-500";
    default:
      return "bg-gray-500";
  }
}

// ---------------------------------------------------------------------------
// Content type icon (emoji)
// ---------------------------------------------------------------------------
export function getContentTypeIcon(contentType: DashboardScheduledPost["contentType"]): string {
  switch (contentType) {
    case "FEED":
      return "\u{1F4F7}";
    case "STORIES":
      return "\u{1F4F1}";
    case "REELS":
      return "\u{1F3AC}";
    case "CAROUSEL":
      return "\u{1F5BC}\uFE0F";
    default:
      return "\u{1F4C4}";
  }
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------
export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const hours = Math.round(diff / (1000 * 60 * 60));
  const days = Math.round(diff / (1000 * 60 * 60 * 24));

  if (Math.abs(hours) < 1) return "Now";
  if (Math.abs(hours) < 24) return hours > 0 ? `In ${hours}h` : `${Math.abs(hours)}h ago`;
  if (Math.abs(days) < 7) return days > 0 ? `In ${days}d` : `${Math.abs(days)}d ago`;
  return date.toLocaleDateString();
}
