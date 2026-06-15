/**
 * @file useOidcReplaceClientSecret.ts
 * @description TanStack Query mutation hook for the OIDC client secret
 *              replace action. The new secret is pasted by the operator
 *              from the IdP console; the backend performs a discovery
 *              handshake before committing — failed handshake surfaces
 *              the IdP error message inline.
 * @hook useOidcReplaceClientSecret
 * @layer infrastructure
 */

import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/apiClient.js";
import type {
  ReplaceOidcClientSecretInput,
  OidcClientSecretRotationResult,
} from "../../lib/api/clients/oidcAdminClient.js";

export type { ReplaceOidcClientSecretInput, OidcClientSecretRotationResult };

export function useOidcReplaceClientSecret() {
  return useMutation<OidcClientSecretRotationResult, Error, ReplaceOidcClientSecretInput>({
    mutationFn: async (input) => {
      const response = await api.security.oidc.replaceClientSecret(input);
      if (!response.ok) {
        throw new Error("Failed to replace OIDC client secret");
      }
      return response.rotation;
    },
  });
}
