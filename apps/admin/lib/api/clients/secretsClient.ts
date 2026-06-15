/**
 * @file secretsClient.ts
 * @description Admin client for the secrets-rotation status dashboard endpoint.
 *              Hits `GET /admin/security/secrets/rotation-status`.
 * @layer infrastructure
 */

import { http } from "./http.js";

type SecretRotationStatus = "OK" | "DUE_SOON" | "OVERDUE" | "UNKNOWN";

type SecretCategory =
  | "KEK"
  | "JWT"
  | "DB_PASSWORD"
  | "REDIS_PASSWORD"
  | "S3_CREDENTIAL"
  | "AI_API_KEY"
  | "EMAIL_API_KEY"
  | "ANALYTICS_API_KEY"
  | "PAYMENT_API_KEY"
  | "OAUTH_PROVIDER";

export interface SecretRotationStatusDTO {
  secretName: string;
  category: SecretCategory;
  description: string;
  cadenceDays: number;
  lastRotatedAt: string | null;
  lastRotatedBy: string | null;
  nextRotationAt: string | null;
  daysUntilDue: number | null;
  status: SecretRotationStatus;
}

export const secretsClient = {
  getRotationStatus: () =>
    http<{ secrets: SecretRotationStatusDTO[] }>("/admin/security/secrets/rotation-status"),
};
