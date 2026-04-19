/**
 * @file usePublicSettings.ts
 * @description Hook for fetching public platform settings (non-secret values).
 *   Used on public pages like reset-password that need platform config without auth.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";

export interface PublicPlatformSettings {
  name?: string;
  logoUrl?: string;
  faviconUrl?: string;
  supportEmail?: string;
  baseUrl?: string;
  adminUrl?: string;
  turnstileSiteKey?: string;
  timezone?: string;
  defaultLanguage?: string;
}

/**
 * @hook usePublicSettings
 * @description Fetches non-secret PLATFORM credentials from the public API endpoint.
 *   No authentication required. Cached for 5 minutes.
 * @returns Query result with PublicPlatformSettings data
 */
export function usePublicSettings() {
  return useQuery({
    queryKey: ["settings", "public"],
    queryFn: async () => {
      const res = await fetch("/api/backend/api/settings/public");
      if (!res.ok) throw new Error("Failed to load platform settings");
      const json = await res.json();
      return json.data as PublicPlatformSettings;
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
