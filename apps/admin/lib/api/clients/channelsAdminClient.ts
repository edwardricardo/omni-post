/**
 * @file channelsAdminClient.ts
 * @description Admin client for channel-level admin actions. Today exposes
 *              force-reauth (PR-43-A); list / detail endpoints land in a
 *              follow-up sub-batch.
 * @layer infrastructure
 */

import { http } from "./http";

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
