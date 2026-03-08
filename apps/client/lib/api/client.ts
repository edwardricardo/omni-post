/**
 * API Client for the OmniPost Client App
 *
 * All requests go through the Next.js proxy at /api/backend/ which
 * handles authentication via httpOnly cookies. No tokens are stored
 * in localStorage or any client-accessible storage.
 *
 * @module lib/api/client
 */

import {
  Post,
  Project,
  Provider,
  ProviderHealth,
  Channel,
  Analytics,
  CreatePostRequest,
  UpdatePostRequest,
  PaginatedResponse,
  ApiResponse,
  HealthResponse,
  ApiError,
  ErrorResponse,
  CrossPlatformAnalyticsData,
} from "./types";

// All requests go through the Next.js proxy -- never hit the backend directly
const PROXY_BASE = "/api/backend";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = PROXY_BASE) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      // Include cookies so the proxy can read the session cookie
      credentials: "include",
    });

    if (!response.ok) {
      const errorData: ErrorResponse = await response.json().catch(() => ({
        ok: false as const,
        error: "Unknown error occurred",
        message: `HTTP ${response.status}: ${response.statusText}`,
      }));

      throw new ApiError(
        errorData.message || errorData.error,
        response.status,
        errorData.code,
        errorData.details
      );
    }

    return response.json();
  }

  // Health and System
  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  // Projects
  async getProjects(): Promise<PaginatedResponse<Project>> {
    return this.request<PaginatedResponse<Project>>("/projects");
  }

  async getProject(id: string): Promise<ApiResponse<Project>> {
    return this.request<ApiResponse<Project>>(`/projects/${id}`);
  }

  async createProject(data: { name: string; description?: string }): Promise<ApiResponse<Project>> {
    return this.request<ApiResponse<Project>>("/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Posts
  async getPosts(params?: {
    projectId?: string;
    page?: number;
    limit?: number;
    status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
  }): Promise<PaginatedResponse<Post>> {
    const searchParams = new URLSearchParams();
    if (params?.projectId) searchParams.set("projectId", params.projectId);
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.status) searchParams.set("status", params.status);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<Post>>(`/posts${query ? `?${query}` : ""}`);
  }

  async getPost(id: string): Promise<ApiResponse<Post>> {
    return this.request<ApiResponse<Post>>(`/posts/${id}`);
  }

  async createPost(data: CreatePostRequest): Promise<ApiResponse<Post>> {
    return this.request<ApiResponse<Post>>("/posts", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updatePost(id: string, data: UpdatePostRequest): Promise<ApiResponse<Post>> {
    return this.request<ApiResponse<Post>>(`/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deletePost(id: string): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>(`/posts/${id}`, {
      method: "DELETE",
    });
  }

  // Post Media
  async addPostMedia(
    postId: string,
    media: {
      type: "image" | "video" | "gif";
      url: string;
      w?: number;
      h?: number;
      durationMs?: number;
      alt?: string;
    }
  ): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/posts/${postId}/media`, {
      method: "POST",
      body: JSON.stringify(media),
    });
  }

  // Post Threading
  async createPostThread(
    postId: string,
    strategy: "AUTO" | "MANUAL" | "SINGLE" = "AUTO"
  ): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/posts/${postId}/thread`, {
      method: "POST",
      body: JSON.stringify({ strategy }),
    });
  }

  async getPostThread(postId: string): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/posts/${postId}/thread`);
  }

  // Providers
  async getProviders(): Promise<{ ok: boolean; providers: Provider[]; total: number }> {
    return this.request<{ ok: boolean; providers: Provider[]; total: number }>("/providers");
  }

  async getActiveProviders(): Promise<{ ok: boolean; providers: Provider[]; total: number }> {
    return this.request<{ ok: boolean; providers: Provider[]; total: number }>("/providers/active");
  }

  async getProviderById(id: string): Promise<{ ok: boolean; provider: Provider }> {
    return this.request<{ ok: boolean; provider: Provider }>(`/providers/${id}`);
  }

  async getProviderHealth(id: string): Promise<{ ok: boolean; health: ProviderHealth }> {
    return this.request<{ ok: boolean; health: ProviderHealth }>(`/providers/${id}/health`);
  }

  async getAllProvidersHealth(): Promise<{
    ok: boolean;
    providers: ProviderHealth[];
    summary: {
      total: number;
      healthy: number;
      degraded: number;
      unhealthy: number;
      avgLatency: number;
    };
  }> {
    return this.request<{
      ok: boolean;
      providers: ProviderHealth[];
      summary: {
        total: number;
        healthy: number;
        degraded: number;
        unhealthy: number;
        avgLatency: number;
      };
    }>("/providers/health");
  }

  // Channels
  async getChannels(providerId?: string): Promise<PaginatedResponse<Channel>> {
    const query = providerId ? `?providerId=${providerId}` : "";
    return this.request<PaginatedResponse<Channel>>(`/channels${query}`);
  }

  async getChannel(id: string): Promise<ApiResponse<Channel>> {
    return this.request<ApiResponse<Channel>>(`/channels/${id}`);
  }

  async createChannel(data: {
    providerId: string;
    accountId: string;
    accountName: string;
    displayName?: string;
    avatarUrl?: string;
  }): Promise<ApiResponse<Channel>> {
    return this.request<ApiResponse<Channel>>("/channels", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateChannel(
    id: string,
    data: {
      displayName?: string;
      avatarUrl?: string;
      isActive?: boolean;
    }
  ): Promise<ApiResponse<Channel>> {
    return this.request<ApiResponse<Channel>>(`/channels/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteChannel(id: string): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>(`/channels/${id}`, {
      method: "DELETE",
    });
  }

  // Analytics
  async getPostAnalytics(
    postId: string,
    params?: {
      start?: string;
      end?: string;
      providerId?: string;
    }
  ): Promise<ApiResponse<Analytics[]>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.providerId) searchParams.set("providerId", params.providerId);

    const query = searchParams.toString();
    return this.request<ApiResponse<Analytics[]>>(
      `/analytics/posts/${postId}${query ? `?${query}` : ""}`
    );
  }

  async getChannelAnalytics(
    channelId: string,
    params?: {
      start?: string;
      end?: string;
      metrics?: string[];
    }
  ): Promise<ApiResponse<Analytics[]>> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.metrics) searchParams.set("metrics", params.metrics.join(","));

    const query = searchParams.toString();
    return this.request<ApiResponse<Analytics[]>>(
      `/analytics/channels/${channelId}${query ? `?${query}` : ""}`
    );
  }

  async getBestPostingTimes(params?: {
    providerId?: string;
    timezone?: string;
  }): Promise<ApiResponse<any>> {
    const searchParams = new URLSearchParams();
    if (params?.providerId) searchParams.set("providerId", params.providerId);
    if (params?.timezone) searchParams.set("timezone", params.timezone);

    const query = searchParams.toString();
    return this.request<ApiResponse<any>>(`/analytics/posts/best-times${query ? `?${query}` : ""}`);
  }

  async getContentPerformance(params?: {
    contentType?: string;
    start?: string;
    end?: string;
  }): Promise<ApiResponse<any>> {
    const searchParams = new URLSearchParams();
    if (params?.contentType) searchParams.set("contentType", params.contentType);
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);

    const query = searchParams.toString();
    return this.request<ApiResponse<any>>(
      `/analytics/content/media-performance${query ? `?${query}` : ""}`
    );
  }

  // Cross-Platform Analytics
  async getCrossPlatformAnalytics(params: {
    accountId: string;
    projectId?: string;
    timeRange?: string;
    providers?: string[];
  }): Promise<ApiResponse<CrossPlatformAnalyticsData>> {
    const searchParams = new URLSearchParams();
    searchParams.set("accountId", params.accountId);
    if (params.projectId) searchParams.set("projectId", params.projectId);
    if (params.timeRange) searchParams.set("timeRange", params.timeRange);
    if (params.providers) searchParams.set("providers", params.providers.join(","));

    const query = searchParams.toString();
    return this.request<ApiResponse<CrossPlatformAnalyticsData>>(
      `/analytics/cross-platform${query ? `?${query}` : ""}`
    );
  }

  // Publishing
  async publishPost(
    postId: string,
    options?: {
      channelIds?: string[];
      scheduledAt?: string;
      priority?: "HIGH" | "NORMAL" | "LOW";
    }
  ): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/posts/${postId}/publish`, {
      method: "POST",
      body: JSON.stringify(options || {}),
    });
  }

  async schedulePost(
    postId: string,
    scheduledAt: string,
    channelIds?: string[]
  ): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/posts/${postId}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduledAt, channelIds }),
    });
  }

  async cancelScheduledPost(postId: string): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/posts/${postId}/schedule`, {
      method: "DELETE",
    });
  }

  // File Upload (for media)
  async uploadFile(
    file: File,
    type: "image" | "video" | "document" = "image"
  ): Promise<ApiResponse<{ url: string; metadata?: any }>> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);

    // Upload also goes through the proxy -- no Authorization header needed,
    // the proxy injects it from the session cookie.
    // Do NOT set Content-Type here -- the browser will set it with the boundary.
    const response = await fetch(`${this.baseUrl}/upload`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      const errorData: ErrorResponse = await response.json().catch(() => ({
        ok: false as const,
        error: "Upload failed",
        message: `HTTP ${response.status}: ${response.statusText}`,
      }));

      throw new ApiError(
        errorData.message || errorData.error,
        response.status,
        errorData.code,
        errorData.details
      );
    }

    return response.json();
  }

  // AI Features
  async generateContent(
    prompt: string,
    options?: {
      type?: "post" | "caption" | "hashtags";
      tone?: "professional" | "casual" | "friendly" | "formal";
      length?: "short" | "medium" | "long";
      language?: "en" | "es";
    }
  ): Promise<ApiResponse<{ content: string; metadata?: any }>> {
    return this.request<ApiResponse<{ content: string; metadata?: any }>>("/ai/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, ...options }),
    });
  }

  async optimizeContent(
    content: string,
    platform?: string
  ): Promise<ApiResponse<{ optimized: string; suggestions?: string[] }>> {
    return this.request<ApiResponse<{ optimized: string; suggestions?: string[] }>>(
      "/ai/optimize",
      {
        method: "POST",
        body: JSON.stringify({ content, platform }),
      }
    );
  }

  async analyzeContent(content: string): Promise<ApiResponse<{ analysis: any; score?: number }>> {
    return this.request<ApiResponse<{ analysis: any; score?: number }>>("/ai/analyze", {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
