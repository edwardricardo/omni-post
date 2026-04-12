/**
 * @file PublishingOrchestratorExecution.ts
 * @description Execution strategy implementations (simultaneous, sequential,
 *              dependency-based, optimized timing) with per-provider retry support.
 * @layer infrastructure
 */

import { OrchestrationPlan, OrchestrationExecution, PublishResult } from "@shared/orchestration";
import type { Result } from "@shared/types";
import type { ProviderId, ProviderAdapter } from "../providers/providerAdapter.interface";
import { providerRegistry } from "../providers/providerRegistry";
import { AppError } from "../lib/errors/AppError.js";
import { PublishingOrchestratorHelpers } from "./PublishingOrchestratorHelpers";
import { createLogger } from "../lib/logger.js";

const log = createLogger("orchestration");

export class PublishingOrchestratorExecution extends PublishingOrchestratorHelpers {
  /** Populated by the concrete PublishingOrchestrator subclass */
  protected activeExecutions!: Map<string, OrchestrationExecution>;

  // ─── Main async execution dispatcher ────────────────────────────────────────

  async executeAsync(execution: OrchestrationExecution, plan: OrchestrationPlan): Promise<void> {
    try {
      execution.status = "executing";
      const startTime = Date.now();

      // Execute based on strategy
      switch (plan.strategy) {
        case "SIMULTANEOUS":
          await this.executeSimultaneous(execution, plan);
          break;
        case "SEQUENTIAL":
          await this.executeSequential(execution, plan);
          break;
        case "DEPENDENCY_BASED":
          await this.executeDependencyBased(execution, plan);
          break;
        case "OPTIMIZED_TIMING":
          await this.executeOptimizedTiming(execution, plan);
          break;
        default:
          throw AppError.badRequest(`Unsupported publishing strategy: ${plan.strategy}`);
      }

      // Finalize execution
      execution.status = "completed";
      execution.completedAt = new Date();
      execution.metrics.totalDuration = Date.now() - startTime;

      // Check if rollback is needed
      if (this.shouldRollback(execution, plan)) {
        await this.executeRollback(execution, plan);
      }

      await this.emitEvent({
        type: "ORCHESTRATION_COMPLETED",
        orchestrationId: execution.id,
        timestamp: new Date(),
        data: { execution, plan },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      execution.status = "failed";
      execution.completedAt = new Date();
      execution.errors.push({
        id: this.generateId(),
        type: "system",
        message: errorMessage,
        retryable: false,
        occurredAt: new Date(),
        ...(errorStack !== undefined && { stack: errorStack }),
      });

      await this.emitEvent({
        type: "ORCHESTRATION_FAILED",
        orchestrationId: execution.id,
        timestamp: new Date(),
        data: { execution, error: errorMessage },
      });
    } finally {
      // Store final execution state
      await this.storeExecution(execution);

      // Remove from active executions
      this.activeExecutions.delete(execution.id);
    }
  }

  // ─── SIMULTANEOUS strategy ──────────────────────────────────────────────────

  protected async executeSimultaneous(
    execution: OrchestrationExecution,
    plan: OrchestrationPlan
  ): Promise<void> {
    const publishPromises = plan.providers.map((providerId) =>
      this.publishToProvider(execution, plan, providerId)
    );

    const results = await Promise.allSettled(publishPromises);

    results.forEach((result, index) => {
      const providerId = plan.providers[index];
      if (!providerId) {
        log.warn({ index }, "Provider ID at index is undefined, skipping result");
        return;
      }

      if (result.status === "fulfilled") {
        execution.results[providerId] = result.value;
      } else {
        execution.results[providerId] = {
          providerId,
          status: "failed",
          error: result.reason.message,
          retryCount: 0,
          duration: 0,
        };
      }
    });

    this.updateExecutionMetrics(execution);
  }

  // ─── SEQUENTIAL strategy ────────────────────────────────────────────────────

  protected async executeSequential(
    execution: OrchestrationExecution,
    plan: OrchestrationPlan
  ): Promise<void> {
    for (const providerId of plan.providers) {
      // Check for cancellation
      if (execution.status === "cancelled") {
        break;
      }

      const result = await this.publishToProvider(execution, plan, providerId);
      execution.results[providerId] = result;

      // Apply delay if configured
      const delay = plan.timing.providerDelays?.[providerId];
      if (delay && delay > 0) {
        await this.sleep(delay);
      }

      // Handle conflicts if any
      await this.handleProviderConflicts(execution, result);
    }

    this.updateExecutionMetrics(execution);
  }

  // ─── DEPENDENCY_BASED strategy ──────────────────────────────────────────────

  protected async executeDependencyBased(
    execution: OrchestrationExecution,
    plan: OrchestrationPlan
  ): Promise<void> {
    const completed = new Set<ProviderId>();
    const remaining = new Set(plan.providers);

    while (remaining.size > 0 && execution.status !== "cancelled") {
      const readyProviders = this.getReadyProviders(remaining, completed, plan.dependencies);

      if (readyProviders.length === 0) {
        // Deadlock detection
        throw AppError.internal("Dependency deadlock detected - no providers ready to execute");
      }

      // Execute ready providers in parallel
      const promises = readyProviders.map((providerId) =>
        this.publishToProvider(execution, plan, providerId)
      );

      const results = await Promise.allSettled(promises);

      results.forEach((result, index) => {
        const providerId = readyProviders[index];
        if (!providerId) {
          log.warn(
            { index },
            "Provider ID at index is undefined in readyProviders, skipping result"
          );
          return;
        }

        if (result.status === "fulfilled") {
          execution.results[providerId] = result.value;
          if (result.value.status === "success") {
            completed.add(providerId);
          }
        } else {
          execution.results[providerId] = {
            providerId,
            status: "failed",
            error: result.reason.message,
            retryCount: 0,
            duration: 0,
          };
        }
        remaining.delete(providerId);
      });
    }

    this.updateExecutionMetrics(execution);
  }

  // ─── OPTIMIZED_TIMING strategy ──────────────────────────────────────────────

  protected async executeOptimizedTiming(
    execution: OrchestrationExecution,
    plan: OrchestrationPlan
  ): Promise<void> {
    // Sort providers by optimal timing windows
    const sortedProviders = await this.sortProvidersByOptimalTiming(plan);

    for (const { providerId, delay } of sortedProviders) {
      // Check for cancellation
      if (execution.status === "cancelled") {
        break;
      }

      // Wait for optimal timing
      if (delay > 0) {
        await this.sleep(delay);
      }

      const result = await this.publishToProvider(execution, plan, providerId);
      execution.results[providerId] = result;

      await this.handleProviderConflicts(execution, result);
    }

    this.updateExecutionMetrics(execution);
  }

  // ─── Per-provider publish ────────────────────────────────────────────────────

  protected async publishToProvider(
    execution: OrchestrationExecution,
    plan: OrchestrationPlan,
    providerId: ProviderId
  ): Promise<PublishResult> {
    const startTime = Date.now();

    try {
      await this.emitEvent({
        type: "PROVIDER_PUBLISH_STARTED",
        orchestrationId: execution.id,
        timestamp: new Date(),
        data: { providerId, planId: plan.id },
      });

      // Get provider adapter
      const adapter = providerRegistry.getAdapter(providerId) as unknown as ProviderAdapter;
      if (!adapter) {
        throw AppError.notFound(`Provider adapter '${providerId}'`);
      }

      // Get post content
      const post = await this.getPostContent(plan.postId);
      if (!post) {
        throw AppError.notFound(`Post '${plan.postId}'`);
      }

      // Render content for provider
      const renderResult = adapter.render(post);
      if (!renderResult.ok) {
        throw AppError.internal(`Content rendering failed: ${renderResult.error}`);
      }

      // Get channel configuration
      const channelConfig = await this.getChannelConfig(plan.projectId, providerId);
      if (!channelConfig) {
        throw AppError.notFound(`Channel configuration for provider '${providerId}'`);
      }

      // Publish with retry logic
      const publishResult = await this.publishWithRetry(
        adapter,
        {
          channelId: channelConfig.id,
          post: renderResult.value,
          dedupeKey: `${plan.id}:${providerId}`,
          config: channelConfig,
        },
        this.config.defaultRetryPolicy
      );

      const result: PublishResult = {
        providerId,
        status: publishResult.ok ? "success" : "failed",
        retryCount: 0, // Will be set by retry logic
        duration: Date.now() - startTime,
        ...(publishResult.ok && {
          providerPostId: publishResult.value.providerPostId,
          url: publishResult.value.url,
          publishedAt: publishResult.value.publishedAt,
        }),
        ...(publishResult.ok === false && {
          error: publishResult.error,
        }),
      };

      await this.emitEvent({
        type: publishResult.ok ? "PROVIDER_PUBLISH_COMPLETED" : "PROVIDER_PUBLISH_FAILED",
        orchestrationId: execution.id,
        timestamp: new Date(),
        data: { providerId, result },
      });

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: PublishResult = {
        providerId,
        status: "failed",
        error: errorMessage,
        retryCount: 0,
        duration: Date.now() - startTime,
      };

      await this.emitEvent({
        type: "PROVIDER_PUBLISH_FAILED",
        orchestrationId: execution.id,
        timestamp: new Date(),
        data: { providerId, result, error: errorMessage },
      });

      return result;
    }
  }

  // ─── Retry logic ─────────────────────────────────────────────────────────────

  protected async publishWithRetry(
    adapter: ProviderAdapter,
    publishRequest: Parameters<ProviderAdapter["publish"]>[0],
    retryPolicy: {
      maxAttempts: number;
      baseDelay: number;
      maxDelay: number;
      backoffStrategy: string;
      retryableErrors: string[];
    }
  ): Promise<Result<{ providerPostId: string; url?: string; publishedAt: Date }, string>> {
    let lastError: string = "";

    for (let attempt = 0; attempt < retryPolicy.maxAttempts; attempt++) {
      try {
        const result = await adapter.publish(publishRequest);
        if (result.ok) {
          return result;
        }

        lastError = result.error;

        // Check if error is retryable
        if (!retryPolicy.retryableErrors.includes(result.error)) {
          break;
        }

        // Calculate delay for next attempt
        if (attempt < retryPolicy.maxAttempts - 1) {
          const delay = this.calculateRetryDelay(attempt, retryPolicy);
          await this.sleep(delay);
        }
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);

        if (attempt < retryPolicy.maxAttempts - 1) {
          const delay = this.calculateRetryDelay(attempt, retryPolicy);
          await this.sleep(delay);
        }
      }
    }

    return { ok: false, error: lastError };
  }

  protected calculateRetryDelay(
    attempt: number,
    retryPolicy: { baseDelay: number; maxDelay: number; backoffStrategy: string }
  ): number {
    const { baseDelay, maxDelay, backoffStrategy } = retryPolicy;

    let delay: number;
    switch (backoffStrategy) {
      case "linear":
        delay = baseDelay * (attempt + 1);
        break;
      case "exponential":
        delay = baseDelay * Math.pow(2, attempt);
        break;
      case "fixed":
      default:
        delay = baseDelay;
        break;
    }

    return Math.min(delay, maxDelay);
  }

  // ─── Dependency graph helper ─────────────────────────────────────────────────

  protected getReadyProviders(
    remaining: Set<ProviderId>,
    completed: Set<ProviderId>,
    dependencies: import("@shared/orchestration").ProviderDependency[]
  ): ProviderId[] {
    const ready: ProviderId[] = [];

    for (const providerId of remaining) {
      const dependency = dependencies.find((d) => d.providerId === providerId);

      // Provider is ready if it has no dependency or all its dependencies are completed
      if (!dependency || dependency.dependsOn.every((dep) => completed.has(dep))) {
        ready.push(providerId);
      }
    }

    return ready;
  }
}
