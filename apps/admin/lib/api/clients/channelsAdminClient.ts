/**
 * @file channelsAdminClient.ts
 * @description Admin client for channel-level admin actions. Exposes
 *              the force-reauth endpoint.
 * @layer infrastructure
 */

import { http } from "./http.js";

export interface ChannelForceReauthInput {
  channelId: string;
  reason?: string;
}

export interface ChannelForceReauthResult {
  channelId: string;
  projectId: string;
  provider: string;
  needsReauth: true;
  authFailedAt: string;
}

export const channelsAdminClient = {
  forceReauth: ({ channelId, reason }: ChannelForceReauthInput) =>
    http<{ channel: ChannelForceReauthResult }>(
      `/admin/channels/${encodeURIComponent(channelId)}/force-reauth`,
      {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      }
    ),
};
