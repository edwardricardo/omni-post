/**
 * @file types.ts
 * @description API types for the client app — domain DTOs for Project, Post, Provider, Channel,
 *              Analytics, and paginated responses consumed by the API client.
 * @layer infrastructure
 */
// API Types for OmniPost Client

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Post {
  id: string;
  projectId: string;
  locale: "es" | "en";
  title?: string;
  summary?: string;
  body: string;
  tags?: string[];
  media?: PostMedia[];
  scheduledAt?: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
  createdAt: string;
  updatedAt: string;
}

export interface PostMedia {
  id: string;
  type: "image" | "video" | "gif";
  url: string;
  width?: number;
  height?: number;
  durationMs?: number;
  alt?: string;
}

export interface PostThread {
  id: string;
  postId: string;
  strategy: "AUTO" | "MANUAL" | "SINGLE";
  segments?: string[];
  createdAt: string;
}

export interface Provider {
  id: string;
  name: string;
  type: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  capabilities: ProviderCapability[];
  isActive: boolean;
  rateLimits?: {
    requests: number;
    windowMs: number;
  };
}

export type ProviderCapability =
  | "publish"
  | "schedule"
  | "analytics"
  | "comments"
  | "replies"
  | "threading"
  | "stories"
  | "reels"
  | "carousel";

export interface ProviderHealth {
  id: string;
  status: "healthy" | "degraded" | "unhealthy";
  latency: number;
  lastCheck: string;
  errorRate: number;
  details?: Record<string, any>;
}

export interface Channel {
  id: string;
  providerId: string;
  providerType: string;
  accountId: string;
  accountName: string;
  displayName?: string;
  avatarUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Analytics {
  postId?: string;
  channelId?: string;
  providerId: string;
  metrics: {
    views?: number;
    likes?: number;
    shares?: number;
    comments?: number;
    clicks?: number;
    impressions?: number;
    reach?: number;
    engagement?: number;
  };
  period: {
    start: string;
    end: string;
  };
}

export interface CrossPlatformAnalyticsSummary {
  totalPosts: number;
  totalEngagements: number;
  avgEngagementRate: number;
  totalReach: number;
  topPerformingProvider?: string;
}

export interface CrossPlatformAnalyticsData {
  summary: CrossPlatformAnalyticsSummary;
  byProvider?: Record<string, unknown>;
  contentInsights?: Record<string, unknown>;
  audienceAnalytics?: Record<string, unknown>;
  benchmarking?: Record<string, unknown>;
  trends?: Record<string, unknown>;
  recommendations?: string[];
  generatedAt: string;
}

export interface CreatePostRequest {
  projectId: string;
  locale?: "es" | "en";
  title?: string;
  summary?: string;
  body: string;
  tags?: string[];
  media?: {
    type: "image" | "video" | "gif";
    url: string;
    w?: number;
    h?: number;
    durationMs?: number;
    alt?: string;
  }[];
  scheduledAt?: string;
}

export interface UpdatePostRequest {
  locale?: "es" | "en";
  title?: string;
  summary?: string;
  body?: string;
  tags?: string[];
  scheduledAt?: string;
}

export interface PaginatedResponse<T> {
  ok: boolean;
  data: T[];
  total: number;
  page?: number;
  limit?: number;
}

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface HealthResponse {
  ok: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version?: string;
  dependencies?: {
    database: "healthy" | "unhealthy";
    redis: "healthy" | "unhealthy";
    queue: "healthy" | "unhealthy";
  };
}

// Error types
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ErrorResponse {
  ok: false;
  error: string;
  message?: string;
  details?: ValidationError[];
  code?: string;
}
