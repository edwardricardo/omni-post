/**
 * @file postsClient.ts
 * @description Posts domain client. Covers post CRUD, post media, and post
 *              threading endpoints. Publishing operations live in
 *              `publishingClient.ts`.
 * @layer infrastructure
 */

import type {
  ApiResponse,
  CreatePostRequest,
  PaginatedResponse,
  Post,
  UpdatePostRequest,
} from "../types";
import { request } from "./request";

export interface ListPostsParams {
  projectId?: string;
  page?: number;
  limit?: number;
  status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
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
    if (params?.status) searchParams.set("status", params.status);

    const query = searchParams.toString();
    return request<PaginatedResponse<Post>>(this.baseUrl, `/posts${query ? `?${query}` : ""}`);
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
   * @method createPost
   * @description Creates a new post draft.
   * @param data - Post creation parameters
   * @returns Created post payload
   */
  async createPost(data: CreatePostRequest): Promise<ApiResponse<Post>> {
    return request<ApiResponse<Post>>(this.baseUrl, "/posts", {
      method: "POST",
      body: JSON.stringify(data),
    });
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
