/**
 * @file providerTypes.ts
 * @description Shared type definitions used across provider adapter packages —
 *   metadata, constraints, content validation results, preview shape, media
 *   upload helpers, capabilities, and account/health-check return types.
 * @layer infrastructure
 */

import type { ProviderId } from "@ports/core";
import type { Media } from "@shared/types";

export type ProviderAuthType = "oauth" | "api_key" | "username_password";

export interface ProviderMetadata {
  id: ProviderId;
  name: string;
  displayName: string;
  description: string;
  icon: string;
  color: string;
  website: string;
  authType: ProviderAuthType;
  requiredScopes?: string[];
  status: "active" | "beta" | "coming_soon" | "maintenance" | "deprecated";
}

export interface ProviderConstraints {
  requiresApproval?: boolean;
  restrictedContent?: string[];
  geographicRestrictions?: string[];
  businessAccountRequired?: boolean;
  verificationRequired?: boolean;
}

export interface ContentValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    severity: "error" | "warning" | "info";
  }>;
  suggestions: Array<{
    type: "truncate" | "split" | "optimize" | "format";
    message: string;
    action?: string;
  }>;
  adaptations: Array<{
    providerId: ProviderId;
    requiredChanges: string[];
    preview?: string;
  }>;
}

export interface ProviderPreview {
  providerId: ProviderId;
  content: {
    text: string;
    truncated?: boolean;
    media?: Array<{
      type: Media["type"];
      url: string;
      optimized?: boolean;
    }>;
  };
  constraints: {
    charactersUsed: number;
    charactersRemaining: number;
    mediaCount: number;
    mediaLimit: number;
  };
  warnings: string[];
  threading?: {
    threadCount: number;
    posts: string[];
  };
}

export interface ConnectionConfig {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  apiSecret?: string;
  accountId?: string;
  accountName?: string;
  profileImage?: string;
  connectedAt: Date;
  expiresAt?: Date;
}

export interface ProviderCredentials {
  [key: string]: string | undefined;
}

export interface MediaUploadResult {
  id: string;
  url?: string;
}

export interface MediaUploadOptions {
  maxRetries?: number;
  timeout?: number;
}

export interface ProviderCapabilities {
  publish: boolean;
  schedule: boolean;
  analytics: boolean;
  comments: boolean;
  replies: boolean;
  threading: boolean;
}

export interface HealthCheckResult {
  healthy: boolean;
  latency?: number;
  quotaRemaining?: number;
  nextReset?: Date;
  warnings?: string[];
}

export interface AccountInfo {
  id: string;
  name: string;
  username?: string;
  profileImage?: string;
  verified?: boolean;
  followers?: number;
}
