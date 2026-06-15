/**
 * @file useProviderForceMassReauth.ts
 * @description TanStack Query mutation hook for the cross-tenant mass
 *              force-reauth admin action. Returns the aggregated counts +
 *              affected ids for display.
 * @hook useProviderForceMassReauth
 * @layer infrastructure
 */

import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/apiClient.js";
import type {
  ForceMassReauthInput,
  MassReauthResult,
} from "../../lib/api/clients/providersAdminClient.js";

export type { ForceMassReauthInput, MassReauthResult };

export function useProviderForceMassReauth() {
  return useMutation<MassReauthResult, Error, ForceMassReauthInput>({
    mutationFn: async (input) => {
      const response = await api.security.providers.forceMassReauth(input);
      if (!response.ok) {
        throw new Error("Failed to execute mass force-reauth");
      }
      return response.rotation;
    },
  });
}
