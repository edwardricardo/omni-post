/**
 * @file providerApiClient.ts
 * @description Standalone provider API client with typed interfaces for fetching provider metadata,
 *              capabilities, health status, and project connections.
 * @layer infrastructure
 */

export interface ProviderCapabilities {
  publish: boolean;
  schedule: boolean;
  analytics: boolean;
  comments: boolean;
  replies: boolean;
  threading: boolean;
  stories?: boolean;
  reels?: boolean;
  carousel?: boolean;
}

export interface ProviderLimits {
  maxChars: number;
  maxMediaPerPost: number;
  maxPostsPerThread?: number;
  allowedMedia: string[];
  aspectRatios: string[];
  maxVideoDuration?: number;
  maxImageSize?: number;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  capabilities: ProviderCapabilities;
  limits: ProviderLimits;
  status: "active" | "beta" | "coming_soon" | "maintenance";
  description: string;
  authType: "oauth" | "api_key" | "username_password";
  requiredScopes?: string[];
}

export interface ProviderConnection {
  providerId: string;
  connected: boolean;
  accountName?: string;
  connectedAt?: string;
  lastUsed?: string;
}

export interface ProviderHealth {
  healthy: boolean;
  latency?: number;
  error?: string;
}
