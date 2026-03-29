import crypto from "crypto";
import Redis from "ioredis";
import { prisma } from "@infra/prisma";
import { logger } from "../lib/logger.js";

interface ApiKey {
  id: string;
  accountId: string;
  name: string;
  keyHash: string;
  prefix: string;
  permissions: string[];
  rateLimit: number;
  expiresAt?: Date;
  lastUsedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  rotationSchedule?: string; // cron expression
}

interface CredentialConfig {
  secretKey: string;
  rotationIntervalDays: number;
  maxActiveKeys: number;
  enableAutoRotation: boolean;
}

export class CredentialManager {
  private redis: Redis;
  private config: CredentialConfig;
  private rotationTimer?: NodeJS.Timeout;

  constructor(redis: Redis, config: CredentialConfig) {
    this.redis = redis;
    this.config = config;

    if (config.enableAutoRotation) {
      this.startAutoRotation();
    }
  }

  // Generate a new API key with secure random generation
  async generateApiKey(
    accountId: string,
    name: string,
    permissions: string[] = ["read"],
    rateLimit: number = 1000,
    expiresInDays?: number
  ): Promise<{ apiKey: string; keyId: string }> {
    // Generate cryptographically secure random key
    const keyBytes = crypto.randomBytes(32);
    const keyString = keyBytes.toString("base64url");

    // Create prefix for easy identification
    const prefix = "sk_" + crypto.randomBytes(4).toString("hex");
    const fullApiKey = `${prefix}_${keyString}`;

    // Hash the key for storage (never store raw keys)
    const keyHash = this.hashApiKey(fullApiKey);

    // Calculate expiration date
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    try {
      // Check if account has reached max key limit
      const existingKeysCount = await prisma.apiKey.count({
        where: {
          accountId,
          isActive: true,
        },
      });

      if (existingKeysCount >= this.config.maxActiveKeys) {
        throw new Error(`Maximum number of API keys (${this.config.maxActiveKeys}) reached`);
      }

      // Store key metadata in database
      const apiKeyRecord = await prisma.apiKey.create({
        data: {
          accountId,
          name,
          keyHash,
          prefix,
          permissions,
          rateLimit,
          ...(expiresAt ? { expiresAt } : {}),
          isActive: true,
        },
      });

      // Cache key data in Redis for fast lookup
      await this.cacheApiKey(apiKeyRecord.id, {
        accountId,
        permissions,
        rateLimit,
        expiresAt: expiresAt?.getTime(),
        isActive: true,
      });

      // Log key creation for audit
      await this.logCredentialEvent("API_KEY_CREATED", accountId, {
        keyId: apiKeyRecord.id,
        name,
        permissions,
        expiresAt: expiresAt?.toISOString(),
      });

      return {
        apiKey: fullApiKey,
        keyId: apiKeyRecord.id,
      };
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to generate API key");
      throw new Error("Failed to generate API key");
    }
  }

  // Validate API key and return associated data
  async validateApiKey(apiKey: string): Promise<{
    valid: boolean;
    accountId?: string;
    permissions?: string[];
    rateLimit?: number;
    keyId?: string;
  }> {
    try {
      const keyHash = this.hashApiKey(apiKey);
      const _prefix = apiKey.split("_")[0] + "_" + apiKey.split("_")[1];

      // Try Redis cache first for performance
      const cachedData = await this.redis.hgetall(`api_key:${keyHash}`);

      if (Object.keys(cachedData).length > 0) {
        // Check expiration
        if (cachedData.expiresAt && Date.now() > parseInt(cachedData.expiresAt)) {
          await this.deactivateApiKey(keyHash);
          return { valid: false };
        }

        // Update last used timestamp
        await this.updateLastUsed(keyHash);

        return {
          valid: cachedData.isActive === "true",
          ...(cachedData.accountId ? { accountId: cachedData.accountId } : {}),
          ...(cachedData.permissions ? { permissions: JSON.parse(cachedData.permissions) } : {}),
          ...(cachedData.rateLimit ? { rateLimit: parseInt(cachedData.rateLimit) } : {}),
          ...(cachedData.keyId ? { keyId: cachedData.keyId } : {}),
        };
      }

      // Fallback to database lookup
      const apiKeyRecord = await prisma.apiKey.findFirst({
        where: {
          keyHash,
          isActive: true,
        },
      });

      if (!apiKeyRecord) {
        return { valid: false };
      }

      // Check expiration
      if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
        await this.deactivateApiKey(apiKeyRecord.id);
        return { valid: false };
      }

      // Cache for future lookups
      await this.cacheApiKey(apiKeyRecord.id, {
        accountId: apiKeyRecord.accountId,
        permissions: apiKeyRecord.permissions,
        rateLimit: apiKeyRecord.rateLimit,
        expiresAt: apiKeyRecord.expiresAt?.getTime(),
        isActive: apiKeyRecord.isActive,
      });

      // Update last used timestamp
      await this.updateLastUsed(apiKeyRecord.id);

      return {
        valid: true,
        accountId: apiKeyRecord.accountId,
        permissions: apiKeyRecord.permissions,
        rateLimit: apiKeyRecord.rateLimit,
        keyId: apiKeyRecord.id,
      };
    } catch (_error: unknown) {
      logger.error({ err: _error }, "API key validation failed");
      return { valid: false };
    }
  }

  // Rotate API key (create new, deactivate old)
  async rotateApiKey(keyId: string): Promise<{ newApiKey: string; newKeyId: string }> {
    try {
      // Get existing key data
      const existingKey = await prisma.apiKey.findUnique({
        where: { id: keyId },
      });

      if (!existingKey) {
        throw new Error("API key not found");
      }

      // Generate new key with same properties
      const { apiKey: newApiKey, keyId: newKeyId } = await this.generateApiKey(
        existingKey.accountId,
        `${existingKey.name} (rotated)`,
        existingKey.permissions,
        existingKey.rateLimit,
        existingKey.expiresAt
          ? Math.ceil((existingKey.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
          : undefined
      );

      // Deactivate old key after grace period (30 minutes)
      setTimeout(
        async () => {
          await this.deactivateApiKey(keyId);
        },
        30 * 60 * 1000
      );

      // Log rotation event
      await this.logCredentialEvent("API_KEY_ROTATED", existingKey.accountId, {
        oldKeyId: keyId,
        newKeyId,
        gracePeriodMinutes: 30,
      });

      return { newApiKey, newKeyId };
    } catch (_error: unknown) {
      logger.error({ err: _error }, "API key rotation failed");
      throw new Error("Failed to rotate API key");
    }
  }

  // Deactivate API key
  async deactivateApiKey(keyId: string): Promise<void> {
    try {
      const apiKeyRecord = await prisma.apiKey.update({
        where: { id: keyId },
        data: { isActive: false },
      });

      // Remove from Redis cache
      await this.redis.del(`api_key:${apiKeyRecord.keyHash}`);

      // Log deactivation
      await this.logCredentialEvent("API_KEY_DEACTIVATED", apiKeyRecord.accountId, {
        keyId,
        name: apiKeyRecord.name,
      });
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to deactivate API key");
      throw new Error("Failed to deactivate API key");
    }
  }

  // List all API keys for an account
  async listApiKeys(accountId: string): Promise<Omit<ApiKey, "keyHash">[]> {
    try {
      const apiKeys = await prisma.apiKey.findMany({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          accountId: true,
          name: true,
          prefix: true,
          permissions: true,
          rateLimit: true,
          expiresAt: true,
          lastUsedAt: true,
          isActive: true,
          createdAt: true,
        },
      });

      return apiKeys as Omit<ApiKey, "keyHash">[];
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Failed to list API keys");
      throw new Error("Failed to list API keys");
    }
  }

  // Encrypt sensitive data using AES-256-GCM
  encrypt(data: string): { encrypted: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(16);
    const key = Buffer.isBuffer(this.config.secretKey)
      ? this.config.secretKey
      : Buffer.from(this.config.secretKey, "hex");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("api-credentials"));

    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
    };
  }

  // Decrypt sensitive data
  decrypt(encryptedData: { encrypted: string; iv: string; tag: string }): string {
    const iv = Buffer.from(encryptedData.iv, "hex");
    const key = Buffer.isBuffer(this.config.secretKey)
      ? this.config.secretKey
      : Buffer.from(this.config.secretKey, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from("api-credentials"));
    decipher.setAuthTag(Buffer.from(encryptedData.tag, "hex"));

    let decrypted = decipher.update(encryptedData.encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  // Helper methods
  public hashApiKey(apiKey: string): string {
    const secretKeyString = Buffer.isBuffer(this.config.secretKey)
      ? this.config.secretKey.toString("hex")
      : this.config.secretKey;
    return crypto
      .createHash("sha256")
      .update(apiKey + secretKeyString)
      .digest("hex");
  }

  private async cacheApiKey(keyId: string, data: Record<string, unknown>): Promise<void> {
    const cacheKey = `api_key:${keyId}`;
    const serializedData = {
      ...data,
      permissions: JSON.stringify(data.permissions),
      keyId,
    };

    await this.redis.hmset(cacheKey, serializedData);
    await this.redis.expire(cacheKey, 3600); // 1 hour cache
  }

  private async updateLastUsed(keyId: string): Promise<void> {
    // Update in background to avoid blocking validation
    setImmediate(async () => {
      try {
        await prisma.apiKey.update({
          where: { id: keyId },
          data: { lastUsedAt: new Date() },
        });
      } catch (_error: unknown) {
        logger.error({ err: _error }, "Failed to update last used timestamp");
      }
    });
  }

  private async logCredentialEvent(
    event: string,
    accountId: string,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          action: event,
          resource: "ApiKey",
          resourceId: accountId,
          details: details as Record<string, string | number | boolean>,
        },
      });
    } catch (_error: unknown) {
      logger.error({ err: _error, event }, "Failed to log credential event");
    }
  }

  private startAutoRotation(): void {
    // Run rotation check every 24 hours
    this.rotationTimer = setInterval(
      async () => {
        await this.performScheduledRotations();
      },
      24 * 60 * 60 * 1000
    );
  }

  private async performScheduledRotations(): Promise<void> {
    try {
      const rotationThreshold = new Date(
        Date.now() - this.config.rotationIntervalDays * 24 * 60 * 60 * 1000
      );

      const keysToRotate = await prisma.apiKey.findMany({
        where: {
          isActive: true,
          createdAt: { lte: rotationThreshold },
          rotationSchedule: { not: null },
        },
      });

      for (const key of keysToRotate) {
        try {
          await this.rotateApiKey(key.id);
          logger.info({ keyId: key.id }, "Auto-rotated API key");
        } catch (_error: unknown) {
          logger.error({ err: _error, keyId: key.id }, "Failed to auto-rotate API key");
        }
      }
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Scheduled rotation check failed");
    }
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }
  }
}
