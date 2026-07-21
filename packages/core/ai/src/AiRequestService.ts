/**
 * @file AiRequestService.ts
 * @description Central AI request service with pool/BYOK routing and rate
 *   limiting. All AI feature requests go through this service. It selects
 *   the appropriate provider (BYOK if configured, pool otherwise), enforces
 *   rate limits for pool requests, and tracks token usage in AiTokenUsage.
 *
 *   Framework-free: depends only on @core/domain ports + @observability/logger.
 *   The concrete BullMQ scheduler + cache + provider SDKs are wrapped behind
 *   the `AIRequestExecutorPort` adapter that lives in apps/api.
 * @layer application
 */
import { ok, err, type Result } from "@shared/types";
import { createLogger } from "@observability/logger";
import type { PlatformCredentialPort } from "@ports/core";
import type { AIProviderName, AIResponse, AITask } from "@core/domain/ai/AIContracts.js";
import type { AIRequestExecutorPort } from "@core/domain/repositories/AIRequestExecutorPort.js";
import type { AccountSubscriptionBillingRepository } from "@core/domain/repositories/AccountSubscriptionBillingRepository.js";
import type { AiTokenUsageReader } from "@core/domain/repositories/AiTokenUsageReader.js";

const aiLogger = createLogger("ai-request");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiRequestParams {
  accountId: string;
  task: AITask;
  preferredProvider?: AIProviderName;
}

interface AiRequestResult {
  response: unknown;
  provider: string;
  model: string;
  tokensUsed: number;
  isByok: boolean;
}

type AiError =
  "NO_PROVIDERS_CONFIGURED" | "RATE_LIMIT_EXCEEDED" | "PROVIDER_ERROR" | "DATABASE_ERROR";

const BASE_TOKENS_PER_UNIT = 10_000;

/**
 * @class AiRequestService
 * @description Routes AI requests through BYOK or pool providers, enforces rate limits,
 *   and tracks token usage. All AI feature endpoints should use this service.
 */
export class AiRequestService {
  constructor(
    private readonly credentialService: PlatformCredentialPort,
    private readonly executor: AIRequestExecutorPort,
    private readonly subscriptionRepo: AccountSubscriptionBillingRepository,
    private readonly tokenUsageRepo: AiTokenUsageReader
  ) {}

  /**
   * @method executeRequest
   * @description Routes an AI request through BYOK (if configured) or pool with rate limiting.
   */
  async executeRequest(params: AiRequestParams): Promise<Result<AiRequestResult, AiError>> {
    const { accountId, task, preferredProvider } = params;

    // Step 1: Check for BYOK
    const byokProvider = preferredProvider ?? "openai";
    const byokResult = await this.credentialService.getAccountCredential(
      accountId,
      "AI_BYOK",
      byokProvider
    );

    if (byokResult.ok && byokResult.value) {
      return this.executeWithByok(accountId, byokProvider, byokResult.value, task);
    }

    // Step 2: Check pool rate limit
    const rateCheck = await this.checkPoolRateLimit(accountId);
    if (!rateCheck.allowed) {
      return err("RATE_LIMIT_EXCEEDED");
    }

    // Step 3: Use pool
    return this.executeWithPool(accountId, task, preferredProvider);
  }

  private async executeWithByok(
    accountId: string,
    providerName: AIProviderName,
    apiKey: string,
    task: AITask
  ): Promise<Result<AiRequestResult, AiError>> {
    const response = await this.executor.executeWithApiKey(
      providerName,
      apiKey,
      task,
      async (prov, tokens) => {
        await this.trackUsage(accountId, prov, tokens, true);
      }
    );

    return this.mapResponse(response, true);
  }

  private async executeWithPool(
    accountId: string,
    task: AITask,
    preferredProvider?: AIProviderName
  ): Promise<Result<AiRequestResult, AiError>> {
    const poolResult = await this.credentialService.getGroup("AI_POOL");
    if (!poolResult.ok) {
      return err("NO_PROVIDERS_CONFIGURED");
    }

    const response = await this.executor.executeWithPool(
      poolResult.value,
      preferredProvider,
      task,
      async (prov, tokens) => {
        await this.trackUsage(accountId, prov, tokens, false);
      }
    );

    if (!response.ok && response.error?.code === "NO_PROVIDERS_CONFIGURED") {
      return err("NO_PROVIDERS_CONFIGURED");
    }

    return this.mapResponse(response, false);
  }

  private mapResponse(
    response: AIResponse<unknown>,
    isByok: boolean
  ): Result<AiRequestResult, AiError> {
    if (!response.ok) {
      return err("PROVIDER_ERROR");
    }

    return ok({
      response: response.value,
      provider: response.metadata.provider,
      model: response.metadata.model,
      tokensUsed: response.metadata.tokensUsed,
      isByok,
    });
  }

  /**
   * @method checkPoolRateLimit
   * @description Checks if an account has remaining pool token budget for the current month.
   */
  private async checkPoolRateLimit(
    accountId: string
  ): Promise<{ allowed: boolean; remaining: number }> {
    const subResult = await this.subscriptionRepo.findActiveOrTrialingByAccount(accountId);
    if (!subResult.ok) {
      aiLogger.warn({ accountId }, "Rate limit check: subscription read failed, allowing request");
      return { allowed: true, remaining: BASE_TOKENS_PER_UNIT };
    }
    const subscription = subResult.value;

    const providers = subscription?.providers?.length ?? 1;
    const accountCount = subscription?.accountCount ?? 1;
    const monthlyBudget = Math.max(providers, 1) * Math.max(accountCount, 1) * BASE_TOKENS_PER_UNIT;

    const usageResult = await this.tokenUsageRepo.sumTokensThisMonth(accountId, false);
    if (!usageResult.ok) {
      aiLogger.warn({ accountId }, "Rate limit check: usage read failed, allowing request");
      return { allowed: true, remaining: monthlyBudget };
    }

    const used = usageResult.value;
    const remaining = monthlyBudget - used;

    return { allowed: remaining > 0, remaining };
  }

  /**
   * @method trackUsage
   * @description Writes a token usage record. Never throws — logs warning on failure.
   */
  private async trackUsage(
    accountId: string,
    provider: string,
    tokens: number,
    isByok: boolean
  ): Promise<void> {
    const result = await this.tokenUsageRepo.recordUsage(accountId, provider, tokens, isByok);
    if (!result.ok) {
      aiLogger.warn({ accountId, provider }, "Failed to write AiTokenUsage");
    }
  }
}
