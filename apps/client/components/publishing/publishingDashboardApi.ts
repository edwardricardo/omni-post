/**
 * @file publishingDashboardApi.ts
 * @description Types and API helper functions for the UnifiedPublishingDashboard.
 * Handles fetching provider statuses, constraints, publishing queue, and schedules
 * from the backend API via the admin proxy.
 */

const API_URL = "/api/backend";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export interface PublishingSchedule {
  id: string;
  scheduledFor: Date;
  providers: string[];
  status: "pending" | "scheduled" | "publishing" | "published" | "failed";
  priority: "low" | "medium" | "high";
}

export interface PublishingQueue {
  id: string;
  content: {
    text: string;
    media?: Array<{
      id: string;
      type: string;
      url: string;
    }>;
  };
  providers: string[];
  scheduledFor?: Date;
  status: "draft" | "queued" | "processing" | "published" | "failed";
  progress?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderStatus {
  providerId: string;
  connected: boolean;
  healthy: boolean;
  lastUsed?: Date;
  errorCount: number;
  rateLimit?: {
    remaining: number;
    resetAt: Date;
  };
}

export interface ProviderConstraints {
  maxChars: number;
  maxMediaPerPost: number;
  allowedMedia: string[];
  capabilities: {
    threading: boolean;
    scheduling: boolean;
    hashtags: boolean;
    mentions: boolean;
  };
  formatting: {
    supportsMarkdown: boolean;
    supportsHTML: boolean;
    supportsEmojis: boolean;
    supportsLinks: boolean;
  };
}

export interface ContentPayload {
  content: {
    text: string;
    title?: string;
    summary?: string;
  };
  media?: Array<{
    id: string;
    type: "image" | "video" | "gif";
    url: string;
  }>;
}

/** Adapted content per provider, produced by ProviderAdaptationEngine */
export interface AdaptedContentMap {
  [providerId: string]: {
    providerId: string;
    content: {
      text: string;
      media?: Array<{ id: string; type: string; url: string; optimized?: boolean }>;
    };
    metadata: {
      isAdapted: boolean;
      changes: string[];
      warnings: string[];
      threading?: { isThreaded: boolean; threadCount: number; posts: string[] };
    };
  };
}

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------
function getDefaultMaxChars(providerId: string): number {
  const limits: Record<string, number> = {
    x: 280,
    instagram: 2200,
    facebook: 63206,
    youtube: 5000,
    tiktok: 2200,
    linkedin: 3000,
  };
  return limits[providerId] ?? 2200;
}

function getDefaultMaxMedia(providerId: string): number {
  const limits: Record<string, number> = {
    x: 4,
    instagram: 10,
    facebook: 20,
    youtube: 1,
    tiktok: 1,
    linkedin: 9,
  };
  return limits[providerId] ?? 4;
}

// ---------------------------------------------------------------------------
// Status mappers
// ---------------------------------------------------------------------------
function mapQueueStatus(status: string): PublishingQueue["status"] {
  const map: Record<string, PublishingQueue["status"]> = {
    DRAFT: "draft",
    QUEUED: "queued",
    PROCESSING: "processing",
    PUBLISHED: "published",
    FAILED: "failed",
  };
  return map[status.toUpperCase()] ?? "draft";
}

function mapScheduleStatus(status: string): PublishingSchedule["status"] {
  const map: Record<string, PublishingSchedule["status"]> = {
    SCHEDULED: "scheduled",
    PUBLISHED: "published",
    PUBLISHING: "publishing",
    FAILED: "failed",
  };
  return map[status.toUpperCase()] ?? "pending";
}

// ---------------------------------------------------------------------------
// API fetch functions
// ---------------------------------------------------------------------------
export async function fetchProviderStatuses(): Promise<ProviderStatus[]> {
  try {
    const response = await fetch(`${API_URL}/providers`, { credentials: "include" });
    if (!response.ok) return [];
    const data = await response.json();
    const providers = (data.providers ?? data.value?.providers ?? []) as Array<{
      id: string;
      status: string;
      capabilities?: Record<string, boolean>;
    }>;
    return providers.map((p) => ({
      providerId: p.id,
      connected: p.status === "active",
      healthy: p.status === "active",
      errorCount: 0,
    }));
  } catch {
    return [];
  }
}

export async function fetchProviderConstraints(): Promise<Record<string, ProviderConstraints>> {
  try {
    const response = await fetch(`${API_URL}/providers`, { credentials: "include" });
    if (!response.ok) return {};
    const data = await response.json();
    const providers = (data.providers ?? data.value?.providers ?? []) as Array<{
      id: string;
      capabilities?: Record<string, boolean>;
    }>;

    const constraints: Record<string, ProviderConstraints> = {};
    for (const p of providers) {
      constraints[p.id] = {
        maxChars: getDefaultMaxChars(p.id),
        maxMediaPerPost: getDefaultMaxMedia(p.id),
        allowedMedia: ["image", "video"],
        capabilities: {
          threading: p.capabilities?.threading ?? false,
          scheduling: p.capabilities?.scheduling ?? true,
          hashtags: p.capabilities?.hashtags ?? true,
          mentions: p.capabilities?.mentions ?? true,
        },
        formatting: {
          supportsMarkdown: false,
          supportsHTML: false,
          supportsEmojis: true,
          supportsLinks: p.id !== "instagram",
        },
      };
    }
    return constraints;
  } catch {
    return {};
  }
}

export async function fetchPublishingQueue(projectId: string): Promise<PublishingQueue[]> {
  try {
    const response = await fetch(`${API_URL}/admin/queue?projectId=${projectId}`, {
      credentials: "include",
    });
    if (!response.ok) return [];
    const data = await response.json();
    const items = (data.value?.items ?? data.items ?? []) as Array<Record<string, unknown>>;
    return items.map((item) => ({
      id: String(item.id ?? ""),
      content: {
        text: String(item.text ?? item.body ?? ""),
      },
      providers: Array.isArray(item.providers) ? (item.providers as string[]) : [],
      status: mapQueueStatus(String(item.status ?? "draft")),
      ...(typeof item.progress === "number" && { progress: item.progress }),
      ...(typeof item.error === "string" && { error: item.error }),
      createdAt: new Date(String(item.createdAt ?? new Date().toISOString())),
      updatedAt: new Date(String(item.updatedAt ?? new Date().toISOString())),
    }));
  } catch {
    return [];
  }
}

export async function fetchSchedules(projectId: string): Promise<PublishingSchedule[]> {
  try {
    const response = await fetch(`${API_URL}/admin/posts/scheduled?projectId=${projectId}`, {
      credentials: "include",
    });
    if (!response.ok) return [];
    const data = await response.json();
    const posts = (data.value?.data ?? data.data ?? []) as Array<Record<string, unknown>>;
    return posts
      .filter((p) => p.scheduledAt)
      .map((p) => ({
        id: String(p.id ?? ""),
        scheduledFor: new Date(String(p.scheduledAt)),
        providers: Array.isArray(p.providers) ? (p.providers as string[]) : [],
        status: mapScheduleStatus(String(p.status ?? "pending")),
        priority: "medium" as const,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Mutation functions
// ---------------------------------------------------------------------------
export async function publishContent(
  projectId: string,
  payload: ContentPayload,
  providers: string[]
): Promise<PublishingQueue> {
  const response = await fetch(`${API_URL}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      projectId,
      body: payload.content.text,
      providers,
      status: "QUEUED",
    }),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({ error: "Publication failed" }))) as {
      error?: string;
    };
    throw new Error(err.error ?? "Failed to publish content");
  }

  const data = (await response.json()) as { value?: { id: string } };
  return {
    id: data.value?.id ?? Date.now().toString(),
    content: { text: payload.content.text },
    providers,
    status: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function scheduleContent(
  projectId: string,
  payload: ContentPayload,
  providers: string[],
  scheduledFor: Date
): Promise<PublishingSchedule> {
  const response = await fetch(`${API_URL}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      projectId,
      body: payload.content.text,
      providers,
      status: "SCHEDULED",
      scheduledAt: scheduledFor.toISOString(),
    }),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({ error: "Scheduling failed" }))) as {
      error?: string;
    };
    throw new Error(err.error ?? "Failed to schedule content");
  }

  const data = (await response.json()) as { value?: { id: string } };
  return {
    id: data.value?.id ?? Date.now().toString(),
    scheduledFor,
    providers,
    status: "scheduled",
    priority: "medium",
  };
}
