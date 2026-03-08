/**
 * @file types.ts
 * @description TypeScript type definitions for the content library, including ContentItem,
 * filter, sort, and view mode interfaces used across library sub-components.
 */

// Types for content library components

export interface ContentItem {
  id: string;
  title?: string;
  content: {
    text: string;
    media?: Array<{
      id: string;
      type: "image" | "video" | "gif";
      url: string;
      thumbnail?: string;
      alt?: string;
      size?: number;
    }>;
  };
  status: "draft" | "scheduled" | "published" | "archived";
  platforms: string[];
  tags: string[];
  category?: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  scheduledFor?: Date;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  performance?: {
    totalEngagement: number;
    totalReach: number;
    engagementRate: number;
    score: number;
  };
  version: number;
  parentId?: string; // For content variations
}

export interface ContentFilter {
  status?: ContentItem["status"][];
  platforms?: string[];
  tags?: string[];
  categories?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  author?: string;
  hasMedia?: boolean;
  performanceThreshold?: number;
}

export interface FilterOptions {
  platforms: string[];
  categories: string[];
  tags: string[];
  authors: string[];
}

export type SortField = "updatedAt" | "createdAt" | "performance" | "status";
export type SortOrder = "asc" | "desc";
export type ViewMode = "grid" | "list";
