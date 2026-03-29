/**
 * @file IntegrationApiKey.ts
 * @description Domain entity representing an API key issued for integration platforms
 *   (Zapier, Make, N8N, etc.). The plain-text key is returned exactly once at creation
 *   time and never stored. Only the argon2id hash is persisted. Verification is delegated
 *   to the application/infrastructure layer to keep the domain free of crypto libraries.
 * @layer domain
 */

import { ok, err, type Result } from "@shared/types";

/**
 * Supported integration platforms.
 */
const INTEGRATION_PLATFORMS = ["ZAPIER", "MAKE"] as const;
type IntegrationPlatformValue = (typeof INTEGRATION_PLATFORMS)[number];

/**
 * Key prefix per platform.
 */
const PLATFORM_KEY_PREFIX: Record<IntegrationPlatformValue, string> = {
  ZAPIER: "zap_",
  MAKE: "mak_",
};

/**
 * Properties that fully describe an IntegrationApiKey.
 */
export interface IntegrationApiKeyProps {
  readonly id: string;
  readonly accountId: string;
  readonly platform: IntegrationPlatformValue;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly label: string | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

/**
 * Input required to create a new IntegrationApiKey.
 * The caller (application layer) is responsible for generating the plain key
 * and computing the hash before calling the factory.
 */
export interface CreateIntegrationApiKeyInput {
  accountId: string;
  platform?: IntegrationPlatformValue;
  keyHash: string;
  keyPrefix: string;
  label?: string;
}

const MAX_LABEL_LENGTH = 100;
const KEY_PREFIX_LENGTH = 8;

/**
 * @class IntegrationApiKey
 * @description Represents an API key scoped to integration webhook platforms.
 *   Enforces label length and prefix format invariants. Supports revocation
 *   and last-used tracking.
 */
export class IntegrationApiKey {
  /**
   * Supported integration platforms available for key generation.
   */
  static readonly PLATFORMS = INTEGRATION_PLATFORMS;

  /**
   * Key prefix map per platform.
   */
  static readonly PLATFORM_KEY_PREFIX = PLATFORM_KEY_PREFIX;

  private props: IntegrationApiKeyProps;

  private constructor(props: IntegrationApiKeyProps) {
    this.props = props;
  }

  /**
   * @method create
   * @description Factory that validates input and produces a new IntegrationApiKey entity.
   * @param input - Account ID, pre-computed hash, prefix, platform, and optional label
   * @returns Result with the new entity on success, Error on validation failure
   */
  static create(input: CreateIntegrationApiKeyInput): Result<IntegrationApiKey, Error> {
    if (!input.accountId.trim()) {
      return err(new Error("Account ID is required"));
    }

    if (!input.keyHash.trim()) {
      return err(new Error("Key hash is required"));
    }

    if (!input.keyPrefix.trim() || input.keyPrefix.length < KEY_PREFIX_LENGTH) {
      return err(new Error(`Key prefix must be at least ${KEY_PREFIX_LENGTH} characters`));
    }

    if (input.label !== undefined && input.label.length > MAX_LABEL_LENGTH) {
      return err(new Error(`Label cannot exceed ${MAX_LABEL_LENGTH} characters`));
    }

    const platform = input.platform ?? "ZAPIER";

    if (!INTEGRATION_PLATFORMS.includes(platform)) {
      return err(new Error(`Unsupported platform: ${platform}`));
    }

    const now = new Date();
    return ok(
      new IntegrationApiKey({
        id: crypto.randomUUID(),
        accountId: input.accountId,
        platform,
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        label: input.label ?? null,
        lastUsedAt: null,
        createdAt: now,
        revokedAt: null,
      })
    );
  }

  /**
   * @method reconstitute
   * @description Rebuilds an entity from persisted data without validation.
   * @param props - The full property set from the database
   * @returns An IntegrationApiKey instance
   */
  static reconstitute(props: IntegrationApiKeyProps): IntegrationApiKey {
    return new IntegrationApiKey(props);
  }

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get platform(): IntegrationPlatformValue {
    return this.props.platform;
  }
  get keyHash(): string {
    return this.props.keyHash;
  }
  get keyPrefix(): string {
    return this.props.keyPrefix;
  }
  get label(): string | null {
    return this.props.label;
  }
  get lastUsedAt(): Date | null {
    return this.props.lastUsedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }
  get isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  /**
   * @method revoke
   * @description Marks this API key as revoked. Idempotent -- calling on an
   *   already-revoked key is a no-op.
   */
  revoke(): void {
    if (this.props.revokedAt !== null) {
      return;
    }
    this.props = { ...this.props, revokedAt: new Date() };
  }

  /**
   * @method markUsed
   * @description Updates the last-used timestamp to the current time.
   */
  markUsed(): void {
    this.props = { ...this.props, lastUsedAt: new Date() };
  }

  /**
   * @method toJSON
   * @description Serialises the entity to a plain object, excluding the key hash
   *   to prevent accidental exposure.
   */
  toJSON(): Omit<IntegrationApiKeyProps, "keyHash"> {
    const { keyHash: _keyHash, ...rest } = this.props;
    return rest;
  }
}

export type { IntegrationPlatformValue };
