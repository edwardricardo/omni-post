/**
 * @file postsClient.ts
 * @description Posts domain client. Covers post CRUD, post media, and post
 *              threading endpoints. Publishing operations live in
 *              `publishingClient.ts`.
 * @layer infrastructure
 */

import type { ApiResponse, PaginatedResponse, Post, UpdatePostRequest } from "../types.js";
import { request } from "./request.js";

export type PostStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELLED";

export type PostSortField = "createdAt" | "updatedAt" | "scheduledAt" | "publishedAt" | "status";

export interface ListPostsParams {
  projectId?: string;
  page?: number;
  limit?: number;
  /** Single value or comma-joined multi-status filter. */
  status?: PostStatus | PostStatus[];
  /** Tag filter — joined as CSV on the wire. */
  tags?: string[];
  hasMedia?: boolean;
  /** ISO 8601 datetime range bounds. */
  createdFrom?: string;
  createdTo?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  /** Substring search across title + body (≤200 chars). */
  searchText?: string;
  sortBy?: PostSortField;
  sortDirection?: "asc" | "desc";
  /** Set true to include archived posts in the result set. */
  includeArchived?: boolean;
}

export interface BatchPostsBody {
  postIds: string[];
}

export interface ArchiveBatchResponse {
  archived: number;
  invalidIds: string[];
}

export interface HardDeleteBatchResponse {
  deleted: number;
  invalidIds: string[];
}

export interface DuplicateBatchResponse {
  duplicates: Array<{ sourceId: string; newId: string }>;
  invalidIds: string[];
  notFoundIds: string[];
}

export interface AddPostMediaInput {
  type: "image" | "video" | "gif";
  url: string;
  w?: number;
  h?: number;
  durationMs?: number;
  alt?: string;
}

export type ThreadingStrategy = "AUTO" | "MANUAL" | "SINGLE";

/**
 * @class PostsClient
 * @description Client for `/posts` and `/posts/:id/media`, `/posts/:id/thread`
 *              endpoints.
 */
export class PostsClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method getPosts
   * @description Lists posts with optional filters.
   * @param params - Pagination, project, and status filters
   * @returns Paginated list of posts
   */
  async getPosts(params?: ListPostsParams): Promise<PaginatedResponse<Post>> {
    const searchParams = new URLSearchParams();
    if (params?.projectId) searchParams.set("projectId", params.projectId);
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.status) {
      // Backend accepts both `?status=DRAFT` and `?status=DRAFT,SCHEDULED`.
      const value = Array.isArray(params.status) ? params.status.join(",") : params.status;
      searchParams.set("status", value);
    }
    if (params?.tags && params.tags.length > 0) {
      searchParams.set("tags", params.tags.join(","));
    }
    if (params?.hasMedia !== undefined) {
      searchParams.set("hasMedia", params.hasMedia ? "true" : "false");
    }
    if (params?.createdFrom) searchParams.set("createdFrom", params.createdFrom);
    if (params?.createdTo) searchParams.set("createdTo", params.createdTo);
    if (params?.scheduledFrom) searchParams.set("scheduledFrom", params.scheduledFrom);
    if (params?.scheduledTo) searchParams.set("scheduledTo", params.scheduledTo);
    if (params?.searchText) searchParams.set("searchText", params.searchText);
    if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params?.sortDirection) searchParams.set("sortDirection", params.sortDirection);
    if (params?.includeArchived) searchParams.set("includeArchived", "true");

    const query = searchParams.toString();
    return request<PaginatedResponse<Post>>(this.baseUrl, `/posts${query ? `?${query}` : ""}`);
  }

  /**
   * @method archivePostsBatch
   * @description Bulk-archive posts (sets archivedAt = now). Idempotent.
   * @param postIds - 1..100 UUIDs
   */
  async archivePostsBatch(postIds: string[]): Promise<ApiResponse<ArchiveBatchResponse>> {
    return request<ApiResponse<ArchiveBatchResponse>>(this.baseUrl, "/posts/batch/archive", {
      method: "PATCH",
      body: JSON.stringify({ postIds }),
    });
  }

  /**
   * @method hardDeletePostsBatch
   * @description Bulk hard-delete posts. Cascades + irreversible — use only
   *              from "Empty trash" UX or admin tooling.
   * @param postIds - 1..100 UUIDs
   */
  async hardDeletePostsBatch(postIds: string[]): Promise<ApiResponse<HardDeleteBatchResponse>> {
    return request<ApiResponse<HardDeleteBatchResponse>>(this.baseUrl, "/posts/batch", {
      method: "DELETE",
      body: JSON.stringify({ postIds }),
    });
  }

  /**
   * @method duplicatePostsBatch
   * @description Bulk-duplicate posts as new DRAFT aggregates.
   * @param postIds - 1..50 UUIDs (lower cap due to per-item read+write)
   */
  async duplicatePostsBatch(postIds: string[]): Promise<ApiResponse<DuplicateBatchResponse>> {
    return request<ApiResponse<DuplicateBatchResponse>>(this.baseUrl, "/posts/batch/duplicate", {
      method: "POST",
      body: JSON.stringify({ postIds }),
    });
  }

  /**
   * @method getPost
   * @description Fetches a post by ID.
   * @param id - Post identifier
   * @returns Post payload
   */
  async getPost(id: string): Promise<ApiResponse<Post>> {
    return request<ApiResponse<Post>>(this.baseUrl, `/posts/${id}`);
  }

  /**
   * @method updatePost
   * @description Updates an existing post.
   * @param id - Post identifier
   * @param data - Fields to update
   * @returns Updated post payload
   */
  async updatePost(id: string, data: UpdatePostRequest): Promise<ApiResponse<Post>> {
    return request<ApiResponse<Post>>(this.baseUrl, `/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /**
   * @method deletePost
   * @description Soft-deletes a post.
   * @param id - Post identifier
   * @returns Empty response on success
   */
  async deletePost(id: string): Promise<ApiResponse<void>> {
    return request<ApiResponse<void>>(this.baseUrl, `/posts/${id}`, {
      method: "DELETE",
    });
  }

  /**
   * @method addPostMedia
   * @description Attaches media to a post.
   * @param postId - Post identifier
   * @param media - Media metadata
   * @returns Created media payload
   */
  async addPostMedia(postId: string, media: AddPostMediaInput): Promise<ApiResponse<unknown>> {
    return request<ApiResponse<unknown>>(this.baseUrl, `/posts/${postId}/media`, {
      method: "POST",
      body: JSON.stringify(media),
    });
  }

  /**
   * @method createPostThread
   * @description Generates a thread for the given post using the requested
   *              strategy.
   * @param postId - Post identifier
   * @param strategy - Thread generation strategy
   * @returns Created thread payload
   */
  async createPostThread(
    postId: string,
    strategy: ThreadingStrategy = "AUTO"
  ): Promise<ApiResponse<unknown>> {
    return request<ApiResponse<unknown>>(this.baseUrl, `/posts/${postId}/thread`, {
      method: "POST",
      body: JSON.stringify({ strategy }),
    });
  }

  /**
   * @method getPostThread
   * @description Fetches the thread associated with a post.
   * @param postId - Post identifier
   * @returns Thread payload
   */
  async getPostThread(postId: string): Promise<ApiResponse<unknown>> {
    return request<ApiResponse<unknown>>(this.baseUrl, `/posts/${postId}/thread`);
  }
}
