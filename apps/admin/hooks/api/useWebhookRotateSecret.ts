/**
 * @file useWebhookRotateSecret.ts
 * @description TanStack Query mutation hook for the admin webhook secret
 *              rotation action. Wraps POST with mutation state + error
 *              parsing. The new secretKey appears once in the response and
 *              must be displayed to the operator immediately (it is not
 *              recoverable later — same model as ApiKey rotation).
 * @layer infrastructure
 */

import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/apiClient";
import type {
  RotateWebhookSecretInput,
  WebhookSecretRotationResult,
} from "../../lib/api/clients/webhooksAdminClient";

export type { RotateWebhookSecretInput, WebhookSecretRotationResult };

export function useWebhookRotateSecret() {
  return useMutation<WebhookSecretRotationResult, Error, RotateWebhookSecretInput>({
    mutationFn: async (input) => {
      const response = await api.security.webhooks.rotateSecret(input);
      if (!response.ok) {
        throw new Error("Failed to rotate webhook secret");
      }
      return response.rotation;
    },
  });
}
