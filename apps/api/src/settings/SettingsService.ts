/**
 * @file SettingsService.ts
 * @description Business logic for platform settings management.
 *   Validates credential groups, masks secrets for API responses,
 *   and orchestrates connection tests for external services.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type { CredentialGroup } from "@core/domain/value-objects/CredentialGroup.js";
import type { PlatformCredentialService } from "../security/PlatformCredentialService.js";
import { CREDENTIAL_KEYS, NON_SECRET_KEYS } from "@core/application/settings/credentialKeys.js";

type SettingsError =
  | "NOT_FOUND"
  | "ENCRYPTION_ERROR"
  | "DATABASE_ERROR"
  | "VALIDATION_ERROR"
  | "CONNECTION_FAILED";

interface ConfigurationStatus {
  groups: Record<string, boolean>;
  overallHealth: "healthy" | "partial" | "unconfigured";
}

interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

interface AiRateLimitStatus {
  hasOwnKey: boolean;
  byokProvider: string | null;
  monthlyBudget: number;
  usedThisMonth: number;
  remainingTokens: number;
  resetDate: Date;
}

/** Groups that must be configured for overallHealth = 'healthy' */
const CRITICAL_GROUPS: CredentialGroup[] = ["STRIPE", "RESEND", "AI_POOL"];

/**
 * @class SettingsService
 * @description Wraps PlatformCredentialService with group-specific validation,
 *   masking, connection testing, and AI rate limit management.
 */
export class SettingsService {
  constructor(
    private readonly credentialService: PlatformCredentialService,
    private readonly prisma: PrismaClient
  ) {}

  /**
   * @method getGroupSettings
   * @description Fetches all credentials for a group and masks secret values.
   * @param group - The credential group
   * @returns Map of key → masked value (or null if unconfigured)
   */
  async getGroupSettings(
    group: CredentialGroup
  ): Promise<Result<Record<string, string | null>, SettingsError>> {
    const keys = CREDENTIAL_KEYS[group];
    if (!keys) return err("VALIDATION_ERROR");

    const groupResult = await this.credentialService.getGroup(group);
    if (!groupResult.ok) {
      return err(groupResult.error.code === "NOT_FOUND" ? "NOT_FOUND" : "DATABASE_ERROR");
    }

    const decrypted = groupResult.value;
    const masked: Record<string, string | null> = {};

    for (const key of keys) {
      const value = decrypted[key];
      if (value === undefined || value === null) {
        masked[key] = null;
      } else if (NON_SECRET_KEYS.has(key)) {
        masked[key] = value;
      } else {
        masked[key] = this.maskSecret(value);
      }
    }

    return ok(masked);
  }

  /**
   * @method setGroupSettings
   * @description Validates keys against CREDENTIAL_KEYS and stores each credential.
   * @param group - The credential group
   * @param values - Key-value map of credentials to store
   * @param updatedBy - The admin userId performing the update
   * @returns Result with void on success
   */
  async setGroupSettings(
    group: CredentialGroup,
    values: Record<string, string>,
    updatedBy: string
  ): Promise<Result<void, SettingsError>> {
    const allowedKeys = CREDENTIAL_KEYS[group];
    if (!allowedKeys) return err("VALIDATION_ERROR");

    const unknownKeys = Object.keys(values).filter((k) => !allowedKeys.includes(k));
    if (unknownKeys.length > 0) return err("VALIDATION_ERROR");

    for (const [key, value] of Object.entries(values)) {
      const result = await this.credentialService.setCredential(group, key, value, updatedBy);
      if (!result.ok) {
        return err(result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "DATABASE_ERROR");
      }
    }

    return ok(undefined);
  }

  /**
   * @method getConfigurationStatus
   * @description Returns configuration status for all credential groups.
   * @returns Map of groups to boolean + overall health indicator
   */
  async getConfigurationStatus(): Promise<Result<ConfigurationStatus, SettingsError>> {
    const configuredResult = await this.credentialService.listConfiguredGroups();
    if (!configuredResult.ok) {
      return err(configuredResult.error.code === "NOT_FOUND" ? "NOT_FOUND" : "DATABASE_ERROR");
    }

    const configuredSet = new Set(configuredResult.value);
    const groups: Record<string, boolean> = {};

    for (const group of Object.keys(CREDENTIAL_KEYS)) {
      groups[group] = configuredSet.has(group as CredentialGroup);
    }

    const configuredCount = configuredResult.value.length;
    const criticalConfigured = CRITICAL_GROUPS.every((g) => configuredSet.has(g));

    let overallHealth: "healthy" | "partial" | "unconfigured";
    if (criticalConfigured) {
      overallHealth = "healthy";
    } else if (configuredCount > 0) {
      overallHealth = "partial";
    } else {
      overallHealth = "unconfigured";
    }

    return ok({ groups, overallHealth });
  }

  /**
   * @method testConnection
   * @description Tests connectivity for a credential group using stored credentials.
   * @param group - The credential group to test
   * @returns Connection test result with success status and latency
   */
  async testConnection(
    group: CredentialGroup
  ): Promise<Result<ConnectionTestResult, SettingsError>> {
    if (group === "PLATFORM" || group === "MONITORING") {
      return ok({
        success: true,
        message: "No connection test needed",
      });
    }

    const groupResult = await this.credentialService.getGroup(group);
    if (!groupResult.ok) {
      return err(groupResult.error.code === "NOT_FOUND" ? "NOT_FOUND" : "DATABASE_ERROR");
    }

    const creds = groupResult.value;
    if (Object.keys(creds).length === 0) {
      return ok({
        success: false,
        message: "No credentials configured for this group",
      });
    }

    const start = Date.now();
    try {
      const result = await this.executeConnectionTest(group, creds);
      return ok({ ...result, latencyMs: Date.now() - start });
    } catch {
      return ok({
        success: false,
        message: "Connection test failed unexpectedly",
        latencyMs: Date.now() - start,
      });
    }
  }

  /**
   * @method logEncryptionKeyRotation
   * @description Creates a PlatformEncryptionKey rotation record and audit log.
   * @param adminId - The admin userId performing the rotation
   * @param note - Optional note about the rotation
   */
  async logEncryptionKeyRotation(
    adminId: string,
    note?: string
  ): Promise<Result<void, SettingsError>> {
    try {
      const latestKey = await this.prisma.platformEncryptionKey.findFirst({
        where: { isActive: true },
        orderBy: { keyVersion: "desc" },
      });

      const nextVersion = latestKey ? latestKey.keyVersion + 1 : 1;

      await this.prisma.platformEncryptionKey.create({
        data: {
          keyVersion: nextVersion,
          rotatedBy: adminId,
          ...(note !== undefined && { note }),
          isActive: true,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          action: "ENCRYPTION_KEY_ROTATED",
          resource: "platform_encryption_key",
          details: { version: nextVersion },
          userId: adminId,
        },
      });

      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method getAiRateLimit
   * @description Returns AI token usage status for an account.
   * @param accountId - The account to query
   * @returns Rate limit status including BYOK info and token usage
   */
  async getAiRateLimit(accountId: string): Promise<Result<AiRateLimitStatus, SettingsError>> {
    try {
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const [tokenUsage, budgetResult, byokResult] = await Promise.all([
        this.prisma.aiTokenUsage.aggregate({
          where: {
            accountId,
            usedAt: { gte: firstOfMonth },
            isByok: false,
          },
          _sum: { tokensUsed: true },
        }),
        this.credentialService.getCredential("AI_POOL", "monthlyTokenBudget"),
        this.credentialService.getAccountCredential(accountId, "AI_BYOK", "openai"),
      ]);

      const usedThisMonth = tokenUsage._sum.tokensUsed ?? 0;
      const monthlyBudget = budgetResult.ok && budgetResult.value ? Number(budgetResult.value) : 0;
      const hasOwnKey = byokResult.ok && byokResult.value !== null;

      return ok({
        hasOwnKey,
        byokProvider: hasOwnKey ? "openai" : null,
        monthlyBudget,
        usedThisMonth,
        remainingTokens: Math.max(0, monthlyBudget - usedThisMonth),
        resetDate: firstOfNextMonth,
      });
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method setByokKey
   * @description Stores a BYOK API key for an account.
   * @param accountId - The account
   * @param provider - The AI provider name
   * @param apiKey - The plaintext API key
   */
  async setByokKey(
    accountId: string,
    provider: string,
    apiKey: string
  ): Promise<Result<void, SettingsError>> {
    const result = await this.credentialService.setAccountCredential(
      accountId,
      "AI_BYOK",
      provider,
      apiKey
    );
    if (!result.ok) {
      return err(result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "DATABASE_ERROR");
    }
    return ok(undefined);
  }

  /**
   * @method deleteByokKey
   * @description Deletes a BYOK API key for an account.
   * @param accountId - The account
   * @param provider - The AI provider name
   */
  async deleteByokKey(accountId: string, provider: string): Promise<Result<void, SettingsError>> {
    const result = await this.credentialService.deleteAccountCredential(
      accountId,
      "AI_BYOK",
      provider
    );
    if (!result.ok) {
      return err(result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "DATABASE_ERROR");
    }
    return ok(undefined);
  }

  /**
   * @method testByokKey
   * @description Tests an AI provider key without storing it.
   * @param provider - The AI provider name
   * @param apiKey - The plaintext API key to test
   * @returns Connection test result
   */
  async testByokKey(
    provider: string,
    apiKey: string
  ): Promise<Result<ConnectionTestResult, SettingsError>> {
    const start = Date.now();
    try {
      const result = await this.testAiProviderKey(provider, apiKey);
      return ok({ ...result, latencyMs: Date.now() - start });
    } catch {
      return ok({
        success: false,
        message: "Connection test failed unexpectedly",
        latencyMs: Date.now() - start,
      });
    }
  }

  /**
   * @method maskSecret
   * @description Masks a secret value showing first 4 and last 4 characters.
   */
  private maskSecret(value: string): string {
    if (value.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    return value.slice(0, 4) + "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" + value.slice(-4);
  }

  /**
   * @method executeConnectionTest
   * @description Dispatches connection test to the appropriate handler per group.
   */
  private async executeConnectionTest(
    group: CredentialGroup,
    creds: Record<string, string>
  ): Promise<Omit<ConnectionTestResult, "latencyMs">> {
    switch (group) {
      case "STRIPE":
        return this.testStripe(creds);
      case "PADDLE":
        return this.testPaddle(creds);
      case "RESEND":
        return this.testResend(creds);
      case "AI_POOL":
        return this.testAiPool(creds);
      case "STORAGE":
        return this.testStorage(creds);
      default:
        if (group.startsWith("SOCIAL_")) {
          return this.testSocialProvider(group, creds);
        }
        return { success: true, message: "No connection test available" };
    }
  }

  private async testStripe(
    creds: Record<string, string>
  ): Promise<Omit<ConnectionTestResult, "latencyMs">> {
    const key = creds["secretKey"];
    if (!key) return { success: false, message: "secretKey not configured" };

    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });

    return res.ok
      ? { success: true, message: "Stripe API connected" }
      : {
          success: false,
          message: `Stripe returned ${res.status}: ${res.statusText}`,
        };
  }

  private async testPaddle(
    creds: Record<string, string>
  ): Promise<Omit<ConnectionTestResult, "latencyMs">> {
    const key = creds["apiKey"];
    if (!key) return { success: false, message: "apiKey not configured" };

    const sandbox = creds["sandboxMode"] === "true";
    const baseUrl = sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";

    const res = await fetch(`${baseUrl}/customers?per_page=1`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });

    return res.ok
      ? { success: true, message: "Paddle API connected" }
      : {
          success: false,
          message: `Paddle returned ${res.status}: ${res.statusText}`,
        };
  }

  private async testResend(
    creds: Record<string, string>
  ): Promise<Omit<ConnectionTestResult, "latencyMs">> {
    const key = creds["apiKey"];
    if (!key) return { success: false, message: "apiKey not configured" };

    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });

    return res.ok
      ? { success: true, message: "Resend API connected" }
      : {
          success: false,
          message: `Resend returned ${res.status}: ${res.statusText}`,
        };
  }

  private async testAiPool(
    creds: Record<string, string>
  ): Promise<Omit<ConnectionTestResult, "latencyMs">> {
    const provider = creds["defaultProvider"] ?? "openai";
    const keyMap: Record<string, string> = {
      openai: "openaiApiKey",
      anthropic: "anthropicApiKey",
      gemini: "geminiApiKey",
      perplexity: "perplexityApiKey",
    };
    const apiKey = creds[keyMap[provider] ?? "openaiApiKey"];
    if (!apiKey) return { success: false, message: `${provider} API key not configured` };

    return this.testAiProviderKey(provider, apiKey);
  }

  private async testAiProviderKey(
    provider: string,
    apiKey: string
  ): Promise<Omit<ConnectionTestResult, "latencyMs">> {
    const endpoints: Record<string, { url: string; authHeader: string }> = {
      openai: {
        url: "https://api.openai.com/v1/models",
        authHeader: `Bearer ${apiKey}`,
      },
      anthropic: {
        url: "https://api.anthropic.com/v1/models",
        authHeader: apiKey,
      },
      gemini: {
        url: `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
        authHeader: "",
      },
      perplexity: {
        url: "https://api.perplexity.ai/chat/completions",
        authHeader: `Bearer ${apiKey}`,
      },
    };

    const config = endpoints[provider];
    if (!config) return { success: false, message: `Unknown AI provider: ${provider}` };

    const headers: Record<string, string> = {};
    if (config.authHeader) {
      if (provider === "anthropic") {
        headers["x-api-key"] = config.authHeader;
        headers["anthropic-version"] = "2023-06-01";
      } else {
        headers["Authorization"] = config.authHeader;
      }
    }

    const res = await fetch(config.url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5_000),
    });

    return res.ok
      ? { success: true, message: `${provider} API connected` }
      : {
          success: false,
          message: `${provider} returned ${res.status}: ${res.statusText}`,
        };
  }

  private async testStorage(
    creds: Record<string, string>
  ): Promise<Omit<ConnectionTestResult, "latencyMs">> {
    const endpoint = creds["endpoint"];
    const bucket = creds["bucketName"];
    if (!endpoint || !bucket)
      return {
        success: false,
        message: "Storage endpoint or bucket not configured",
      };

    try {
      const url = endpoint.endsWith("/") ? `${endpoint}${bucket}` : `${endpoint}/${bucket}`;
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
      return res.ok || res.status === 403
        ? { success: true, message: "Storage endpoint reachable" }
        : {
            success: false,
            message: `Storage returned ${res.status}: ${res.statusText}`,
          };
    } catch {
      return { success: false, message: "Storage endpoint unreachable" };
    }
  }

  private async testSocialProvider(
    group: CredentialGroup,
    creds: Record<string, string>
  ): Promise<Omit<ConnectionTestResult, "latencyMs">> {
    const providerTests: Record<
      string,
      { url: string; tokenKey: string; authType: "bearer" | "query" }
    > = {
      SOCIAL_FACEBOOK: {
        url: "https://graph.facebook.com/v19.0/me",
        tokenKey: "accessToken",
        authType: "query",
      },
      SOCIAL_INSTAGRAM: {
        url: "https://graph.facebook.com/v19.0/me",
        tokenKey: "accessToken",
        authType: "query",
      },
      SOCIAL_X: {
        url: "https://api.x.com/2/users/me",
        tokenKey: "accessToken",
        authType: "bearer",
      },
      SOCIAL_YOUTUBE: {
        url: "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
        tokenKey: "accessToken",
        authType: "bearer",
      },
      SOCIAL_TIKTOK: {
        url: "https://open.tiktokapis.com/v2/user/info/",
        tokenKey: "accessToken",
        authType: "bearer",
      },
      SOCIAL_LINKEDIN: {
        url: "https://api.linkedin.com/v2/userinfo",
        tokenKey: "accessToken",
        authType: "bearer",
      },
      SOCIAL_SNAPCHAT: {
        url: "https://adsapi.snapchat.com/v1/me/organizations",
        tokenKey: "accessToken",
        authType: "bearer",
      },
      SOCIAL_TELEGRAM: {
        url: "https://api.telegram.org/bot{token}/getMe",
        tokenKey: "botToken",
        authType: "query",
      },
      SOCIAL_PINTEREST: {
        url: "https://api.pinterest.com/v5/user_account",
        tokenKey: "accessToken",
        authType: "bearer",
      },
      SOCIAL_BLUESKY: {
        url: "https://bsky.social/xrpc/com.atproto.server.describeServer",
        tokenKey: "identifier",
        authType: "query",
      },
      SOCIAL_THREADS: {
        url: "https://graph.threads.net/v1.0/me",
        tokenKey: "accessToken",
        authType: "query",
      },
    };

    const config = providerTests[group];
    if (!config)
      return {
        success: false,
        message: `No test available for ${group}`,
      };

    const token = creds[config.tokenKey];
    if (!token)
      return {
        success: false,
        message: `${config.tokenKey} not configured for ${group}`,
      };

    let url = config.url;
    const headers: Record<string, string> = {};

    if (group === "SOCIAL_TELEGRAM") {
      url = url.replace("{token}", token);
    } else if (config.authType === "bearer") {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}access_token=${token}`;
    }

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    const providerName = group.replace("SOCIAL_", "");

    return res.ok
      ? { success: true, message: `${providerName} API connected` }
      : {
          success: false,
          message: `${providerName} returned ${res.status}: ${res.statusText}`,
        };
  }

  // ─── Public Platform Settings ──────────────────────────────────────

  /**
   * @method getPublicPlatformSettings
   * @description Returns non-secret PLATFORM credential values safe for public exposure.
   *   Only returns keys present in NON_SECRET_KEYS — never returns masked secrets.
   * @returns Record of non-secret platform settings
   */
  async getPublicPlatformSettings(): Promise<Result<Record<string, string>, SettingsError>> {
    const result = await this.credentialService.getGroup("PLATFORM");
    if (!result.ok) return err("DATABASE_ERROR");

    const publicSettings: Record<string, string> = {};
    for (const [key, value] of Object.entries(result.value)) {
      if (NON_SECRET_KEYS.has(key) && value) {
        publicSettings[key] = value;
      }
    }

    return ok(publicSettings);
  }
}
