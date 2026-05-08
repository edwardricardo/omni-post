/**
 * @file useChannelForceReauth.ts
 * @description TanStack Query mutation hook for the admin force-reauth action.
 *              Wraps the POST endpoint with mutation state + error parsing.
 * @layer infrastructure
 */

import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/apiClient";
import type {
  ChannelForceReauthInput,
  ChannelForceReauthResult,
} from "../../lib/api/clients/channelsAdminClient";

export type { ChannelForceReauthInput, ChannelForceReauthResult };

export function useChannelForceReauth() {
  return useMutation<ChannelForceReauthResult, Error, ChannelForceReauthInput>({
    mutationFn: async (input) => {
      const response = await api.security.channels.forceReauth(input);
      if (!response.ok) {
        throw new Error("Failed to force re-auth");
      }
      return response.channel;
    },
  });
}
