/**
 * @file AiRequestService.ts
 * @description Central AI request service with pool/BYOK routing and rate limiting.
 *   All AI feature requests go through this service. It selects the appropriate
 *   provider (BYOK if configured, pool otherwise), enforces rate limits for pool
 *   requests, and tracks token usage in AiTokenUsage.
 * @layer application
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { CachePort } from "@ports/core";
import type { PlatformCredentialService } from "@core/application/security/PlatformCredentialService.js";
import type { AITask, AIResponse, AIProvider } from "./types.js";
import { AIOrchestrator } from "./orchestrator.js";
import { AIProviderFactory } from "./AIProviderFactory.js";
import { logger } from "../lib/logger.js";

const aiLogger = logger.child({ module: "ai-request" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AiProviderName = "openai" | "anthropic" | "gemini" | "perplexity";

interface AiRequestParams {
  accountId: string;
  task: AITask;
  preferredProvider?: AiProviderName;
}

interface AiRequestResult {
  response: unknown;
  provider: string;
  model: string;
  tokensUsed: number;
  isByok: boolean;
}

type AiError =
  | "NO_PROVIDERS_CONFIGURED"
  | "RATE_LIMIT_EXCEEDED"
  | "PROVIDER_ERROR"
  | "DATABASE_ERROR";

const PROVIDER_KEY_MAP: Record<AiProviderName, string> = {
  openai: "openaiApiKey",
  anthropic: "anthropicApiKey",
  gemini: "geminiApiKey",
  perplexity: "perplexityApiKey",
};

const PROVIDER_MODEL_MAP: Record<AiProviderName, string> = {
  openai: "openaiModel",
  anthropic: "anthropicModel",
  gemini: "geminiModel",
  perplexity: "perplexityModel",
};

const BASE_TOKENS_PER_UNIT = 10_000;

/**
 * @class AiRequestService
 * @description Routes AI requests through BYOK or pool providers, enforces rate limits,
 *   and tracks token usage. All AI feature endpoints should use this service.
 */
export class AiRequestService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly credentialService: PlatformCredentialService,
    private readonly scheduler: BackgroundTaskScheduler,
    private readonly cache: CachePort
  ) {}

  /**
   * @method executeRequest
   * @description Routes an AI request through BYOK (if configured) or pool with rate limiting.
   * @param params - accountId, task, and optional preferred provider
   * @returns Result with response data or typed error
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

  /**
   * @method executeWithByok
   * @description Executes an AI task using the client's own API key.
   */
  private async executeWithByok(
    accountId: string,
    providerName: AiProviderName,
    apiKey: string,
    task: AITask
  ): Promise<Result<AiRequestResult, AiError>> {
    const provider = AIProviderFactory.createProvider(providerName, apiKey);
    const providers = new Map<string, AIProvider>([[providerName, provider]]);

    const orchestrator = new AIOrchestrator(
      providers,
      this.scheduler,
      this.cache,
      async (prov, tokens) => {
        await this.trackUsage(accountId, prov, tokens, true);
      }
    );

    return this.executeWithOrchestrator(orchestrator, task, true);
  }

  /**
   * @method executeWithPool
   * @description Executes an AI task using the shared platform pool credentials.
   */
  private async executeWithPool(
    accountId: string,
    task: AITask,
    preferredProvider?: AiProviderName
  ): Promise<Result<AiRequestResult, AiError>> {
    const poolResult = await this.credentialService.getGroup("AI_POOL");
    if (!poolResult.ok) {
      return err("NO_PROVIDERS_CONFIGURED");
    }

    const poolCreds = poolResult.value;
    const providers = new Map<string, AIProvider>();
    const providerNames: AiProviderName[] = ["openai", "anthropic", "gemini", "perplexity"];

    // Build providers, putting preferred first
    const ordered = preferredProvider
      ? [preferredProvider, ...providerNames.filter((p) => p !== preferredProvider)]
      : providerNames;

    for (const name of ordered) {
      const apiKey = poolCreds[PROVIDER_KEY_MAP[name]];
      const model = poolCreds[PROVIDER_MODEL_MAP[name]];
      if (apiKey) {
        providers.set(name, AIProviderFactory.createProvider(name, apiKey, model));
      }
    }

    if (providers.size === 0) {
      return err("NO_PROVIDERS_CONFIGURED");
    }

    const orchestrator = new AIOrchestrator(
      providers,
      this.scheduler,
      this.cache,
      async (prov, tokens) => {
        await this.trackUsage(accountId, prov, tokens, false);
      }
    );

    return this.executeWithOrchestrator(orchestrator, task, false);
  }

  /**
   * @method executeWithOrchestrator
   * @description Runs a task through the given orchestrator and maps the response.
   */
  private async executeWithOrchestrator(
    orchestrator: AIOrchestrator,
    task: AITask,
    isByok: boolean
  ): Promise<Result<AiRequestResult, AiError>> {
    const response: AIResponse<unknown> = await orchestrator.executeTask(task);

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
   * @param accountId - The account to check
   * @returns Whether the request is allowed and remaining tokens
   */
  private async checkPoolRateLimit(
    accountId: string
  ): Promise<{ allowed: boolean; remaining: number }> {
    try {
      const subscription = await this.prisma.accountSubscription.findFirst({
        where: { accountId, status: { in: ["ACTIVE", "TRIALING"] } },
      });

      const providers = (subscription?.providers as string[])?.length ?? 1;
      const accountCount = subscription?.accountCount ?? 1;
      const monthlyBudget =
        Math.max(providers, 1) * Math.max(accountCount, 1) * BASE_TOKENS_PER_UNIT;

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const usage = await this.prisma.aiTokenUsage.aggregate({
        where: { accountId, isByok: false, usedAt: { gte: startOfMonth } },
        _sum: { tokensUsed: true },
      });

      const used = Number(usage._sum.tokensUsed ?? 0);
      const remaining = monthlyBudget - used;

      return { allowed: remaining > 0, remaining };
    } catch (error: unknown) {
      aiLogger.warn({ err: error, accountId }, "Rate limit check failed, allowing request");
      return { allowed: true, remaining: BASE_TOKENS_PER_UNIT };
    }
  }

  /**
   * @method trackUsage
   * @description Writes a token usage record. Never throws — logs warning on failure.
   * @param accountId - The account
   * @param provider - The provider name
   * @param tokens - Number of tokens used
   * @param isByok - Whether the request used BYOK
   */
  private async trackUsage(
    accountId: string,
    provider: string,
    tokens: number,
    isByok: boolean
  ): Promise<void> {
    try {
      await this.prisma.aiTokenUsage.create({
        data: { accountId, provider, tokensUsed: tokens, isByok },
      });
    } catch (error: unknown) {
      aiLogger.warn({ err: error, accountId, provider }, "Failed to write AiTokenUsage");
    }
  }
}
