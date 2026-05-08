/**
 * @file publishingClient.ts
 * @description Publishing domain client. Triggers immediate publish, scheduled
 *              publish, and cancellation of scheduled posts.
 * @layer infrastructure
 */

import type { ApiResponse } from "../types";
import { request } from "./request";

export type PublishPriority = "HIGH" | "NORMAL" | "LOW";

export interface PublishOptions {
  channelIds?: string[];
  scheduledAt?: string;
  priority?: PublishPriority;
}

/**
 * @class PublishingClient
 * @description Client for publish/schedule endpoints under `/posts/:id`.
 */
export class PublishingClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method publishPost
   * @description Publishes a post immediately or queues it with the given
   *              options.
   * @param postId - Post identifier
   * @param options - Publish parameters
   */
  async publishPost(postId: string, options?: PublishOptions): Promise<ApiResponse<unknown>> {
    return request<ApiResponse<unknown>>(this.baseUrl, `/posts/${postId}/publish`, {
      method: "POST",
      body: JSON.stringify(options || {}),
    });
  }

  /**
   * @method schedulePost
   * @description Schedules a post for future publication.
   * @param postId - Post identifier
   * @param scheduledFor - ISO-8601 timestamp
   * @param channelIds - Channel UUIDs to publish to
   */
  async schedulePost(
    postId: string,
    scheduledFor: string,
    channelIds: string[]
  ): Promise<ApiResponse<unknown>> {
    return request<ApiResponse<unknown>>(this.baseUrl, `/posts/${postId}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduledFor, channelIds }),
    });
  }

  /**
   * @method cancelScheduledPost
   * @description Cancels a scheduled publish.
   * @param postId - Post identifier
   */
  async cancelScheduledPost(postId: string): Promise<ApiResponse<unknown>> {
    return request<ApiResponse<unknown>>(this.baseUrl, `/posts/${postId}/schedule`, {
      method: "DELETE",
    });
  }
}
