/**
 * @file ApiKeyRepository.ts
 * @description Repository port for API key persistence — defines the contract for creating, finding, revoking, and validating hashed API keys.
 * @layer domain
 */

import type { Result } from "@shared/types";

/**
 * Core API key data as represented in the domain.
 * No framework or ORM types here.
 */
export interface DomainApiKey {
  /** Unique identifier (UUID) */
  readonly id: string;
  /** Account that owns this key */
  readonly accountId: string;
  /** Human-readable name */
  readonly name: string;
  /** Short prefix shown to users (e.g. "op_live_abc123") — NOT the secret */
  readonly prefix: string;
  /** argon2id hash of the full key — the secret is NEVER stored in plain text */
  readonly keyHash: string;
  /** Allowed operation scopes (e.g. ["read", "write", "publish"]) */
  readonly permissions: string[];
  /** Max requests per minute */
  readonly rateLimit: number;
  /** Optional expiration date */
  readonly expiresAt: Date | undefined;
  /** Last time the key was used for a successful request */
  readonly lastUsedAt: Date | undefined;
  /** Whether the key can be used */
  readonly isActive: boolean;
  /** Optional cron expression for automatic rotation */
  readonly rotationSchedule: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Data required to create a new API key
 */
export interface CreateApiKeyData {
  readonly accountId: string;
  readonly name: string;
  readonly prefix: string;
  readonly keyHash: string;
  readonly permissions: string[];
  readonly rateLimit: number;
  readonly expiresAt?: Date;
  readonly rotationSchedule?: string;
}

/**
 * Errors specific to API key operations
 */
export class ApiKeyNotFoundError extends Error {
  readonly _tag = "ApiKeyNotFoundError" as const;
  constructor(id: string) {
    super(`API key not found: ${id}`);
    this.name = "ApiKeyNotFoundError";
  }
}

/**
 * API Key Repository Port
 *
 * Defines all persistence operations for API keys.
 * Implemented by PrismaApiKeyRepository in the infrastructure layer.
 */
export interface ApiKeyRepository {
  /**
   * Find an API key by its unique ID
   */
  findById(id: string): Promise<Result<DomainApiKey, ApiKeyNotFoundError>>;

  /**
   * Find all active API keys belonging to an account
   */
  findByAccountId(accountId: string): Promise<DomainApiKey[]>;

  /**
   * Find an API key by its prefix string (used during request authentication).
   * Returns only active, non-expired keys.
   */
  findActiveByPrefix(prefix: string): Promise<DomainApiKey | null>;

  /**
   * Persist a new API key (returns the saved record)
   */
  create(data: CreateApiKeyData): Promise<DomainApiKey>;

  /**
   * Mark the lastUsedAt timestamp for the given key ID
   */
  recordUsage(id: string): Promise<void>;

  /**
   * Deactivate a key (soft delete — isActive → false).
   * Returns error if key not found.
   */
  deactivate(id: string): Promise<Result<void, ApiKeyNotFoundError>>;

  /**
   * Replace a key's hash + prefix (rotation).
   * The old prefix becomes invalid immediately.
   */
  rotate(
    id: string,
    newPrefix: string,
    newKeyHash: string
  ): Promise<Result<DomainApiKey, ApiKeyNotFoundError>>;

  /**
   * Hard-delete all deactivated keys for an account.
   * Used for GDPR / account deletion flows.
   */
  deleteByAccountId(accountId: string): Promise<void>;
}
