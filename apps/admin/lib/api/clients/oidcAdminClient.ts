/**
 * @file oidcAdminClient.ts
 * @description Admin client for OIDC client secret replace (with handshake test).
 * @layer infrastructure
 */

import { http } from "./http.js";

export interface ReplaceOidcClientSecretInput {
  accountId: string;
  newClientSecret: string;
}

export interface OidcClientSecretRotationResult {
  accountId: string;
  issuerUrl: string;
  updatedAt: string;
}

export const oidcAdminClient = {
  replaceClientSecret: ({ accountId, newClientSecret }: ReplaceOidcClientSecretInput) =>
    http<{ rotation: OidcClientSecretRotationResult }>(
      `/admin/oidc/configurations/${encodeURIComponent(accountId)}/replace-client-secret`,
      {
        method: "POST",
        body: JSON.stringify({ newClientSecret }),
      }
    ),
};
