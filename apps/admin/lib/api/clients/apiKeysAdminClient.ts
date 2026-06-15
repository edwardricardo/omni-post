/**
 * @file apiKeysAdminClient.ts
 * @description Admin client for cross-tenant ApiKey rotation.
 * @layer infrastructure
 */

import { http } from "./http.js";

export interface RotateApiKeyAdminInput {
  apiKeyId: string;
}

export interface ApiKeyAdminRotationResult {
  apiKeyId: string;
  rawKey: string;
  accountId?: string;
}

export const apiKeysAdminClient = {
  rotate: ({ apiKeyId }: RotateApiKeyAdminInput) =>
    http<{ rotation: ApiKeyAdminRotationResult }>(
      `/admin/api-keys/${encodeURIComponent(apiKeyId)}/rotate`,
      { method: "POST", body: JSON.stringify({}) }
    ),
};
