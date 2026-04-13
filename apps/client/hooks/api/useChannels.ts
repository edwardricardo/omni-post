/**
 * @file useChannels.ts
 * @description TanStack Query hooks for managing social media channels: fetching connected channels,
 * listing available providers, and disconnecting a channel via mutation.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Channel {
  id: string;
  providerId: string;
  providerName: string;
  accountName: string;
  accountId?: string;
  isActive: boolean;
  isConnected: boolean;
  lastUsed?: string;
  connectedAt: string;
  expiresAt?: string;
  capabilities: {
    publish: boolean;
    schedule: boolean;
    analytics: boolean;
    threading: boolean;
    stories?: boolean;
    reels?: boolean;
    carousel?: boolean;
  };
  usage: {
    postsThisMonth: number;
    lastPost?: string;
    rateLimitStatus: "OK" | "WARNING" | "LIMITED";
  };
}

interface Provider {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  status: "active" | "beta" | "coming_soon" | "maintenance";
  authType: "oauth" | "api_key" | "username_password";
  capabilities: Channel["capabilities"];
  description: string;
}

/**
 * @hook useChannels
 * @description Fetches all connected social media channels for the current account.
 * @returns TanStack Query result with channel array including capabilities and usage stats
 */
export function useChannels() {
  return useQuery({
    queryKey: ["channels", "list"],
    queryFn: async () => {
      const response = await fetch("/api/channels", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch channels");
      }

      const data = await response.json();
      return data.channels as Channel[];
    },
    staleTime: 60000, // 1 minute
  });
}

/**
 * @hook useProviders
 * @description Fetches the list of available social media providers with their capabilities and status.
 * @returns TanStack Query result with provider array
 */
export function useProviders() {
  return useQuery({
    queryKey: ["providers", "list"],
    queryFn: async () => {
      const response = await fetch("/api/providers", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch providers");
      }

      const data = await response.json();
      return data.providers as Provider[];
    },
    staleTime: 300000, // 5 minutes (providers don't change often)
  });
}

/**
 * @hook useDisconnectChannel
 * @description Mutation hook for disconnecting a social media channel.
 * @returns TanStack Query mutation that invalidates the channels list on success
 */
export function useDisconnectChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channelId: string) => {
      const response = await fetch(`/api/channels/${channelId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect channel");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}
