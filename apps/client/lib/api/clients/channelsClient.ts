/**
 * @file channelsClient.ts
 * @description Channels domain client. Covers CRUD operations for connected
 *              social channels.
 * @layer infrastructure
 */

import type { ApiResponse, Channel, PaginatedResponse } from "../types";
import { request } from "./request";

export interface CreateChannelInput {
  providerId: string;
  accountId: string;
  accountName: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface UpdateChannelInput {
  displayName?: string;
  avatarUrl?: string;
  isActive?: boolean;
}

/**
 * @class ChannelsClient
 * @description Client for `/channels` endpoints.
 */
export class ChannelsClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method getChannels
   * @description Lists channels, optionally filtered by provider.
   * @param providerId - Optional provider filter
   */
  async getChannels(providerId?: string): Promise<PaginatedResponse<Channel>> {
    const query = providerId ? `?providerId=${providerId}` : "";
    return request<PaginatedResponse<Channel>>(this.baseUrl, `/channels${query}`);
  }

  /**
   * @method getChannel
   * @description Fetches a single channel by ID.
   * @param id - Channel identifier
   */
  async getChannel(id: string): Promise<ApiResponse<Channel>> {
    return request<ApiResponse<Channel>>(this.baseUrl, `/channels/${id}`);
  }

  /**
   * @method createChannel
   * @description Connects a new channel for a provider account.
   * @param data - Channel creation parameters
   */
  async createChannel(data: CreateChannelInput): Promise<ApiResponse<Channel>> {
    return request<ApiResponse<Channel>>(this.baseUrl, "/channels", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * @method updateChannel
   * @description Updates channel metadata.
   * @param id - Channel identifier
   * @param data - Fields to update
   */
  async updateChannel(id: string, data: UpdateChannelInput): Promise<ApiResponse<Channel>> {
    return request<ApiResponse<Channel>>(this.baseUrl, `/channels/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /**
   * @method deleteChannel
   * @description Disconnects a channel.
   * @param id - Channel identifier
   */
  async deleteChannel(id: string): Promise<ApiResponse<void>> {
    return request<ApiResponse<void>>(this.baseUrl, `/channels/${id}`, {
      method: "DELETE",
    });
  }
}
