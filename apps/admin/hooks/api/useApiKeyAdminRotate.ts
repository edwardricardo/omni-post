/**
 * @file useApiKeyAdminRotate.ts
 * @description TanStack Query mutation hook for the admin cross-tenant
 *              ApiKey rotation. The new raw key surfaces in the success
 *              response — operator MUST copy it (never recoverable later).
 * @hook useApiKeyAdminRotate
 * @layer infrastructure
 */

import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/apiClient.js";
import type {
  RotateApiKeyAdminInput,
  ApiKeyAdminRotationResult,
} from "../../lib/api/clients/apiKeysAdminClient.js";

export type { RotateApiKeyAdminInput, ApiKeyAdminRotationResult };

export function useApiKeyAdminRotate() {
  return useMutation<ApiKeyAdminRotationResult, Error, RotateApiKeyAdminInput>({
    mutationFn: async (input) => {
      const response = await api.security.apiKeys.rotate(input);
      if (!response.ok) {
        throw new Error("Failed to rotate API key");
      }
      return response.rotation;
    },
  });
}
