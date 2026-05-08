/**
 * @file mfaClient.ts
 * @description Multi-factor authentication endpoints — both self-service
 *              (current user enrolls/disables MFA) and admin-only
 *              (force-disable for another user).
 * @layer infrastructure
 */

import type { MfaStatus } from "../types";
import { http } from "./http";

interface BackupCodesResponse {
  ok: boolean;
  backupCodes: string[];
}

interface MfaSetupResponse {
  ok: boolean;
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

/**
 * @const mfaClient
 * @description Methods for `/admin/auth/mfa/*` and per-user MFA admin
 *              endpoints.
 */
export const mfaClient = {
  getStatus: () => http<{ ok: boolean; mfa: MfaStatus }>("/admin/auth/mfa/status"),

  setup: () =>
    http<MfaSetupResponse>("/admin/auth/mfa/setup", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  verifySetup: (mfaToken: string) =>
    http<BackupCodesResponse>("/admin/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ token: mfaToken }),
    }),

  disable: (mfaToken: string) =>
    http<{ ok: boolean }>("/admin/auth/mfa/disable", {
      method: "POST",
      body: JSON.stringify({ token: mfaToken }),
    }),

  regenerateBackupCodes: (mfaToken: string) =>
    http<BackupCodesResponse>("/admin/auth/mfa/regenerate-backup-codes", {
      method: "POST",
      body: JSON.stringify({ token: mfaToken }),
    }),

  getUserStatus: (userId: string) =>
    http<{ ok: boolean; mfa: MfaStatus }>(`/admin/users/${userId}/mfa/status`),

  forceDisable: (userId: string, reason: string) =>
    http<{ ok: boolean }>(`/admin/users/${userId}/mfa/force-disable`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
};
