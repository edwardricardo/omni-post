/**
 * @file ApiKeyUseCases.ts
 * @description Encapsulates all API key lifecycle operations (create, validate, rotate, deactivate) using argon2id hashing; raw keys are returned once and never stored.
 * @layer application
 */

import { randomBytes } from "node:crypto";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import { type Result, ok, err } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  ApiKeyRepository,
  DomainApiKey,
  ApiKeyNotFoundError,
} from "@core/domain/repositories/ApiKeyRepository.js";

const PREFIX_LENGTH = 8; // bytes → 16 hex chars
const KEY_SECRET_LENGTH = 32; // bytes → 64 hex chars
const PREFIX_HEADER = "op"; // "OmniPost"

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random API key and its components.
 * Format: "op_{prefix}_{secret}"
 * - prefix: persisted (shown to user for identification)
 * - secret: hashed before storing; shown to user only once
 */
async function generateApiKey(hasher: PasswordHasher): Promise<{
  rawKey: string;
  prefix: string;
  keyHash: string;
}> {
  const prefixBytes = randomBytes(PREFIX_LENGTH).toString("hex");
  const secretBytes = randomBytes(KEY_SECRET_LENGTH).toString("hex");
  const prefix = `${PREFIX_HEADER}_${prefixBytes}`;
  const rawKey = `${prefix}_${secretBytes}`;
  const keyHash = await hasher.hash(rawKey);
  return { rawKey, prefix, keyHash };
}

/**
 * Fast pre-check: SHA-256 of the raw key must start with the stored prefix.
 * This allows O(1) prefix lookup before doing the expensive argon2id comparison.
 */
function extractPrefix(rawKey: string): string | null {
  // Key format: "op_{8-byte-hex}_{32-byte-hex}"
  const parts = rawKey.split("_");
  // "op", "prefixHex", "secretHex"
  if (parts.length < 2 || parts[0] !== PREFIX_HEADER) return null;
  return `${PREFIX_HEADER}_${parts[1] ?? ""}`;
}

// ─── DTOs ──────────────────────────────────────────────────────────────────

export interface CreateApiKeyInput {
  accountId: string;
  name: string;
  permissions?: string[];
  rateLimit?: number;
  expiresAt?: Date;
  rotationSchedule?: string;
}

export interface CreateApiKeyOutput {
  key: DomainApiKey;
  /** Raw key shown ONCE — never retrievable again */
  rawKey: string;
}

export interface ValidateApiKeyInput {
  rawKey: string;
}

export interface ValidateApiKeyOutput {
  key: DomainApiKey;
}

export interface RotateApiKeyOutput {
  key: DomainApiKey;
  /** New raw key — shown ONCE */
  rawKey: string;
}

// ─── Create API Key ─────────────────────────────────────────────────────────

/**
 * Create API Key Use Case
 *
 * Generates a new API key for an account. The plaintext key is returned
 * exactly once and must be saved by the caller — it cannot be recovered.
 */
export class CreateApiKeyUseCase {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly hasher: PasswordHasher
  ) {}

  async execute(input: CreateApiKeyInput): Promise<Result<CreateApiKeyOutput, UseCaseError>> {
    try {
      if (!input.name.trim()) {
        return err(new UseCaseError("API key name is required", USE_CASE_ERRORS.VALIDATION_FAILED));
      }

      if (input.name.length > 100) {
        return err(
          new UseCaseError(
            "API key name must be ≤ 100 characters",
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }

      const permissions = input.permissions ?? ["read"];
      const rateLimit = input.rateLimit ?? 1000;

      if (rateLimit < 1 || rateLimit > 100_000) {
        return err(
          new UseCaseError(
            "Rate limit must be between 1 and 100,000 req/min",
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }

      if (input.expiresAt && input.expiresAt <= new Date()) {
        return err(
          new UseCaseError(
            "Expiration date must be in the future",
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }

      const { rawKey, prefix, keyHash } = await generateApiKey(this.hasher);

      const key = await this.repo.create({
        accountId: input.accountId,
        name: input.name.trim(),
        prefix,
        keyHash,
        permissions,
        rateLimit,
        ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
        ...(input.rotationSchedule !== undefined && { rotationSchedule: input.rotationSchedule }),
      });

      return ok({ key, rawKey });
    } catch (error) {
      return err(
        new UseCaseError(
          "Failed to create API key",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  }
}

// ─── Validate API Key ────────────────────────────────────────────────────────

/**
 * Validate API Key Use Case
 *
 * Authenticates an incoming raw API key. Extracts the prefix, looks up
 * the key record, verifies the argon2id hash, and records usage.
 *
 * Returns UseCaseError for any validation failure — callers should map
 * this to HTTP 401 without leaking which specific check failed.
 */
export class ValidateApiKeyUseCase {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly hasher: PasswordHasher
  ) {}

  async execute(input: ValidateApiKeyInput): Promise<Result<ValidateApiKeyOutput, UseCaseError>> {
    try {
      const prefix = extractPrefix(input.rawKey);
      if (!prefix) {
        return err(new UseCaseError("Invalid API key format", USE_CASE_ERRORS.UNAUTHORIZED));
      }

      const key = await this.repo.findActiveByPrefix(prefix);
      if (!key) {
        return err(new UseCaseError("Invalid or inactive API key", USE_CASE_ERRORS.UNAUTHORIZED));
      }

      // Check expiration
      if (key.expiresAt !== undefined && key.expiresAt <= new Date()) {
        return err(new UseCaseError("API key has expired", USE_CASE_ERRORS.UNAUTHORIZED));
      }

      // Verify argon2id hash (expensive — do last)
      const valid = await this.hasher.verify(key.keyHash, input.rawKey);
      if (!valid) {
        return err(new UseCaseError("Invalid API key", USE_CASE_ERRORS.UNAUTHORIZED));
      }

      // Fire-and-forget usage recording (non-critical)
      this.repo.recordUsage(key.id).catch(() => {});

      return ok({ key });
    } catch (error) {
      return err(
        new UseCaseError(
          "Failed to validate API key",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  }
}

// ─── List API Keys ───────────────────────────────────────────────────────────

/**
 * List API Keys Use Case
 *
 * Returns all API keys for an account. Sensitive fields (keyHash) are
 * present on the DomainApiKey but should be stripped before sending to
 * the client — the route handler is responsible for this projection.
 */
export class ListApiKeysUseCase {
  constructor(private readonly repo: ApiKeyRepository) {}

  async execute(accountId: string): Promise<Result<DomainApiKey[], UseCaseError>> {
    try {
      const keys = await this.repo.findByAccountId(accountId);
      return ok(keys);
    } catch (error) {
      return err(
        new UseCaseError(
          "Failed to list API keys",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  }
}

// ─── Rotate API Key ──────────────────────────────────────────────────────────

/**
 * Rotate API Key Use Case
 *
 * Generates a new key secret while keeping the same record ID and metadata.
 * The old key becomes invalid immediately. The new raw key is returned once.
 */
export class RotateApiKeyUseCase {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly hasher: PasswordHasher
  ) {}

  async execute(
    id: string
  ): Promise<Result<RotateApiKeyOutput, UseCaseError | ApiKeyNotFoundError>> {
    try {
      const { rawKey, prefix, keyHash } = await generateApiKey(this.hasher);
      const result = await this.repo.rotate(id, prefix, keyHash);

      if (!result.ok) {
        return err(result.error);
      }

      return ok({ key: result.value, rawKey });
    } catch (error) {
      return err(
        new UseCaseError(
          "Failed to rotate API key",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  }
}

// ─── Deactivate API Key ──────────────────────────────────────────────────────

/**
 * Deactivate API Key Use Case
 *
 * Soft-deletes an API key by setting isActive = false.
 * The record is preserved for audit purposes.
 */
export class DeactivateApiKeyUseCase {
  constructor(private readonly repo: ApiKeyRepository) {}

  async execute(id: string): Promise<Result<void, UseCaseError | ApiKeyNotFoundError>> {
    try {
      const result = await this.repo.deactivate(id);
      if (!result.ok) {
        return err(result.error);
      }
      return ok(undefined);
    } catch (error) {
      return err(
        new UseCaseError(
          "Failed to deactivate API key",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  }
}
