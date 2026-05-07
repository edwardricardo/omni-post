/**
 * @file providersAdminClient.ts
 * @description Admin client for cross-tenant provider mass-force-reauth.
 * @layer infrastructure
 */

import { http } from "./http";

export interface ForceMassReauthInput {
  provider: string;
  reason: string;
  flagChannels?: boolean;
  disableProviderConnections?: boolean;
  softDeleteChannels?: boolean;
}

export interface MassReauthResult {
  provider: string;
  tiers: {
    flagChannels: boolean;
    disableProviderConnections: boolean;
    softDeleteChannels: boolean;
  };
  channelsFlagged: number;
  providerConnectionsDisabled: number;
  channelsSoftDeleted: number;
  channelIds: string[];
  providerConnectionIds: string[];
}

export const providersAdminClient = {
  forceMassReauth: ({ provider, ...body }: ForceMassReauthInput) =>
    http<{ rotation: MassReauthResult }>(
      `/admin/providers/${encodeURIComponent(provider)}/force-mass-reauth`,
      { method: "POST", body: JSON.stringify(body) }
    ),
};
