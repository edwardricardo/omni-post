/**
 * @file useSecretRotationStatus.ts
 * @description TanStack Query hook for the admin secrets-rotation status
 *              dashboard. Fetches the read-only list of every tracked secret
 *              with its NIST cadence + last rotation + computed status.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/apiClient.js";
import type { SecretRotationStatusDTO } from "../../lib/api/clients/secretsClient.js";

export type { SecretRotationStatusDTO } from "../../lib/api/clients/secretsClient.js";

/**
 * @hook useSecretRotationStatus
 * @description Returns the rotation-status list with TanStack loading/error
 *              state. Stale time matches dashboard hooks (60s) — admin views
 *              refresh manually rather than polling.
 */
export function useSecretRotationStatus() {
  return useQuery({
    queryKey: ["admin", "secrets", "rotation-status"],
    queryFn: async (): Promise<SecretRotationStatusDTO[]> => {
      const response = await api.security.secrets.getRotationStatus();
      if (!response.ok) {
        throw new Error("Failed to fetch secret rotation status");
      }
      return response.secrets;
    },
    staleTime: 60_000,
  });
}
