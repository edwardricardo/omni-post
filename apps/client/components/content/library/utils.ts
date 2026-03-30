/**
 * @file utils.ts
 * @description Utility functions for the content library, including status color mapping,
 * date formatting, and text truncation helpers used by library components.
 */

// Utility functions for content library

import type { ContentItem } from "./types";

export function getStatusColor(status: ContentItem["status"]): string {
  switch (status) {
    case "published":
      return "bg-green-100 text-green-800";
    case "scheduled":
      return "bg-blue-100 text-blue-800";
    case "draft":
      return "bg-yellow-100 text-yellow-800";
    case "archived":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
  });
}

export function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
}
