/**
 * @file publishHandler.ts
 * @description Core publish orchestrator that renders posts, executes provider publishing (single
 *              and threaded), records receipts, and coordinates with saga notifiers.
 * @layer infrastructure
 */
import type {
  RenderedPost,
  Result,
  ThreadPlan,
  ThreadReceipt,
  PublishError,
  Thread,
} from "@shared/types";
import type { PublishReceipt } from "@ports/core";
import type {
  ContentMetrics,
  PublishInstrumentation,
  DatabaseInstrumentation,
  BusinessKPITracker,
} from "./telemetry/instrumentationTypes.js";

export type {
  ContentMetrics,
  PublishInstrumentation,
  DatabaseInstrumentation,
  BusinessKPITracker,
} from "./telemetry/instrumentationTypes.js";
export type {
  PublishRepo,
  PublishProvider,
  SagaNotifier,
  PublishHandlerDeps,
  PublishJobInput,
} from "./publishHandlerTypes.js";

import type {
  PublishRepo,
  PublishProvider,
  SagaNotifier,
  PublishHandlerDeps,
  PublishJobInput,
} from "./publishHandlerTypes.js";

/**
 * Core publishing orchestrator. Resolves the correct provider adapter from
 * the registry based on `job.data.provider`, defaulting to "x" when absent.
 */
export class PublishHandler {
  private readonly repo: PublishRepo;
  private readonly providerRegistry: Record<string, PublishProvider>;
  private readonly credentialResolver: PublishHandlerDeps["credentialResolver"];
  private readonly workerMetrics: PublishHandlerDeps["workerMetrics"];
  private readonly logger: PublishHandlerDeps["logger"];
  private readonly instrumentation: PublishInstrumentation;
  private readonly databaseInstrumentation: DatabaseInstrumentation;
  private readonly businessKPITracker: BusinessKPITracker;
  private readonly notifyRedis?: SagaNotifier;

  constructor(deps: PublishHandlerDeps) {
    this.repo = deps.repo;
    this.providerRegistry = deps.providerRegistry;
    this.credentialResolver = deps.credentialResolver;
    this.workerMetrics = deps.workerMetrics;
    this.logger = deps.logger;
    this.instrumentation = deps.instrumentation;
    this.databaseInstrumentation = deps.databaseInstrumentation;
    this.businessKPITracker = deps.businessKPITracker;
    if (deps.notifyRedis) {
      this.notifyRedis = deps.notifyRedis;
    }
  }

  /**
   * Resolve a provider adapter from the registry.
   * Throws if the provider name is unknown.
   */
  private resolveProvider(providerName: string): PublishProvider {
    const adapter = this.providerRegistry[providerName];
    if (!adapter) {
      const available = Object.keys(this.providerRegistry).join(", ");
      throw new Error(`Unknown provider: ${providerName}. Available: ${available}`);
    }
    return adapter;
  }

  /**
   * @method resolveJobAccountId
   * @description Determine the tenant scope for a publish job. Prefers the
   *              `accountId` in the job payload; for legacy jobs enqueued before
   *              the payload carried it, falls back to the channel's owner
   *              (accountId column only, never decrypting). Throws `"AUTH"` when
   *              neither yields a tenant — the job cannot be tenant-scoped and
   *              fails like a missing-channel credential resolve. Remove this
   *              fallback and make `payload.accountId` required once no
   *              pre-deploy jobs remain in the PUBLISH queue (including the
   *              BullMQ delayed set — scheduled posts can sit for days).
   * @param channelId - Channel the job publishes to.
   * @param payloadAccountId - Tenant carried in the job payload, if present.
   * @returns The effective tenant accountId for this job.
   */
  private async resolveJobAccountId(
    channelId: string,
    payloadAccountId: string | undefined
  ): Promise<string> {
    if (payloadAccountId !== undefined) {
      return payloadAccountId;
    }
    const owner = await this.repo.getChannelOwnerAccountId(channelId);
    if (owner.ok && owner.value !== null) {
      return owner.value;
    }
    throw new Error("AUTH");
  }

  /**
   * Notify the saga orchestrator of a job outcome via Redis pub/sub.
   * Best-effort -- failures are logged but do not fail the job.
   */
  private async notifySaga(
    sagaId: string,
    event: {
      type: string;
      data: Record<string, unknown>;
    }
  ): Promise<void> {
    if (!this.notifyRedis) return;

    try {
      await this.notifyRedis.publish(
        "saga:events",
        JSON.stringify({
          type: event.type,
          data: event.data,
          metadata: { sagaId },
        })
      );
    } catch {
      this.logger.warn({ sagaId }, "Failed to notify saga of job completion");
    }
  }

  /**
   * @method publishSinglePost
   * @description Publish a single rendered post through a provider adapter,
   *              logging the outcome, updating metrics, and optionally notifying
   *              the saga orchestrator.
   * @param postId - Aggregate identifier of the post being published.
   * @param channelId - Destination channel.
   * @param dedupeKey - Stable key used for idempotency and correlation tracking.
   * @param rendered - Provider-rendered post payload.
   * @param providerName - Provider key matching the registry entry.
   * @param provider - Resolved provider adapter implementation.
   * @param accountId - Tenant scope for the credential lookup (D2/D9).
   * @param sagaId - Optional saga identifier for orchestration callbacks.
   * @returns The provider's publish receipt.
   */
  async publishSinglePost(
    postId: string,
    channelId: string,
    dedupeKey: string,
    rendered: RenderedPost,
    providerName: string,
    provider: PublishProvider,
    accountId: string,
    sagaId?: string
  ): Promise<PublishReceipt> {
    return (await this.instrumentation.instrumentPublishing(
      "publish_single_post",
      providerName,
      channelId,
      "single",
      async (span) => {
        const correlationId = this.workerMetrics.generateCorrelationId(dedupeKey);
        const endTimer = this.workerMetrics.metrics.publishDuration.startTimer({
          provider: providerName,
          content_type: "single",
        });

        span.setAttributes({
          "social.post_id": postId,
          "social.channel_id": channelId,
          "social.dedupe_key": dedupeKey,
          "social.provider": providerName,
          "correlation.id": correlationId,
        });

        const providerTimer = this.workerMetrics.metrics.providerRequestDuration.startTimer({
          provider: providerName,
          operation: "publish",
          status: "pending",
        });

        try {
          const credentialResult = await this.credentialResolver.resolve(channelId, accountId);
          if (!credentialResult.ok) {
            providerTimer({ status: "error" });
            await this.databaseInstrumentation.instrumentQuery("insert", "publish_log", async () =>
              this.repo.logPublish({
                postId,
                provider: providerName,
                channelId,
                status: "ERR",
                payload: { error: "AUTH", correlationId },
                dedupeKey,
              })
            );
            this.workerMetrics.metrics.publishErr.inc({
              provider: providerName,
              content_type: "single",
              error_type: "auth_error",
              channel_id: channelId,
            });
            this.workerMetrics.recordError("publisher", "auth_error", true);
            this.workerMetrics.recordPostPublishFailed();
            this.workerMetrics.recordProviderPublishFailure(providerName);
            endTimer();
            throw new Error("AUTH");
          }

          const res = (await this.instrumentation.instrumentProviderAPI(
            providerName,
            "publish",
            "POST",
            async (apiSpan) => {
              apiSpan.setAttributes({
                "social.post_id": postId,
                "social.channel_id": channelId,
              });
              return await provider.publish(
                {
                  channelId,
                  post: rendered,
                  dedupeKey,
                },
                credentialResult.value
              );
            }
          )) as Result<PublishReceipt, PublishError>;

          if (!res.ok) {
            providerTimer({ status: "error" });

            await this.databaseInstrumentation.instrumentQuery(
              "insert",
              "publish_log",
              async () => {
                return await this.repo.logPublish({
                  postId,
                  provider: providerName,
                  channelId,
                  status: "ERR",
                  payload: { error: res.error, correlationId },
                  dedupeKey,
                });
              }
            );

            const contentMetrics: ContentMetrics = {
              postId,
              provider: providerName,
              contentType: "single",
              publishTime: new Date(),
              success: false,
              error: String(res.error),
            };
            this.businessKPITracker.trackContentPublication(contentMetrics);

            this.workerMetrics.metrics.publishErr.inc({
              provider: providerName,
              content_type: "single",
              error_type: "provider_error",
              channel_id: channelId,
            });
            this.workerMetrics.recordError("publisher", "provider_error", true);
            this.workerMetrics.recordPostPublishFailed();
            this.workerMetrics.recordProviderPublishFailure(providerName);

            if (sagaId) {
              await this.notifySaga(sagaId, {
                type: "publish.job.failed",
                data: { postId, channelId, provider: providerName },
              });
            }

            endTimer();
            throw new Error(String(res.error));
          }

          providerTimer({ status: "success" });

          await this.databaseInstrumentation.instrumentQuery("insert", "publish_log", async () => {
            return await this.repo.logPublish({
              postId,
              provider: providerName,
              channelId,
              status: "OK",
              payload: { ...res.value, correlationId },
              dedupeKey,
            });
          });

          const contentMetrics: ContentMetrics = {
            postId,
            provider: providerName,
            contentType: "single",
            publishTime: new Date(),
            success: true,
          };
          this.businessKPITracker.trackContentPublication(contentMetrics);

          this.workerMetrics.metrics.publishOk.inc({
            provider: providerName,
            content_type: "single",
            channel_id: channelId,
          });
          this.workerMetrics.recordPostPublished();
          this.workerMetrics.recordProviderPublishSuccess(providerName);

          if (sagaId) {
            await this.notifySaga(sagaId, {
              type: "publish.job.completed",
              data: { postId, channelId, provider: providerName },
            });
          }

          this.logger.info(
            { postId, channelId, provider: providerName, receipt: res.value, correlationId },
            "Published single post"
          );
          endTimer();

          return res.value;
        } finally {
          this.workerMetrics.removeCorrelationId(dedupeKey);
        }
      },
      {
        post_id: postId,
        channel_id: channelId,
        dedupe_key: dedupeKey,
      }
    )) as PublishReceipt;
  }

  /**
   * @method publishThreadPost
   * @description Publish a thread (multi-tweet) post: create the thread + tweet
   *              records, invoke the provider's `publishThread`, update tweet
   *              statuses with provider IDs, log the receipt, and emit thread
   *              metrics. Returns void when the thread is already fully
   *              published (idempotent re-entry).
   * @param postId - Aggregate identifier of the post being threaded.
   * @param channelId - Destination channel.
   * @param dedupeKey - Stable key used for idempotency and correlation tracking.
   * @param threadPlan - Strategy + ordered tweet fragments to publish.
   * @param providerName - Provider key matching the registry entry.
   * @param provider - Resolved provider adapter (must implement `publishThread`).
   * @param accountId - Tenant scope for the credential lookup (D2/D9).
   * @param sagaId - Optional saga identifier for orchestration callbacks.
   * @returns The thread receipt, or void if the thread was already complete.
   */
  async publishThreadPost(
    postId: string,
    channelId: string,
    dedupeKey: string,
    threadPlan: ThreadPlan,
    providerName: string,
    provider: PublishProvider,
    accountId: string,
    sagaId?: string
  ): Promise<ThreadReceipt | void> {
    const correlationId = this.workerMetrics.generateCorrelationId(dedupeKey);
    const endTimer = this.workerMetrics.metrics.publishDuration.startTimer({
      provider: providerName,
      content_type: "thread",
    });
    const threadEndTimer = this.workerMetrics.recordThreadStart(providerName);
    const tweetCount = threadPlan.tweets.length;
    const tweetCountRange = this.workerMetrics.getTweetCountRange(tweetCount);

    // Track thread creation
    this.workerMetrics.metrics.threadCreated.inc({
      strategy: threadPlan.strategy,
      provider: providerName,
    });
    this.workerMetrics.metrics.threadTweetCount.observe(tweetCount);

    // First, create the thread record in database
    const threadResult = await this.repo.createThread({
      postId,
      strategy: threadPlan.strategy,
    });

    if (!threadResult.ok) {
      if (threadResult.error === "THREAD_EXISTS") {
        this.logger.info({ postId, correlationId }, "Thread already exists, checking completion");
        const existingThread = await this.repo.getThreadByPostId(postId);
        if (existingThread.ok && existingThread.value) {
          const tweets = await this.repo.getTweetsByThread(existingThread.value.id);
          if (tweets.ok && tweets.value.length === threadPlan.tweets.length) {
            const allPublished = tweets.value.every((tweet) => tweet.status === "PUBLISHED");
            if (allPublished) {
              this.logger.info({ postId, correlationId }, "Thread already fully published");
              this.workerMetrics.metrics.threadPublished.inc({
                strategy: threadPlan.strategy,
                provider: providerName,
                tweet_count: tweetCount.toString(),
              });
              threadEndTimer();
              endTimer();
              return;
            }
          }
        }
      } else {
        this.workerMetrics.metrics.threadErrors.inc({
          phase: "creation",
          error_type: "thread_creation_failed",
          provider: providerName,
        });
        this.workerMetrics.recordError("thread", "creation_failed", false);
        throw new Error(`Failed to create thread: ${threadResult.error}`);
      }
    }

    let thread: Thread;
    if (threadResult.ok) {
      thread = threadResult.value;
    } else {
      const existingThreadResult = await this.repo.getThreadByPostId(postId);
      if (!existingThreadResult.ok || !existingThreadResult.value) {
        throw new Error(`Unable to get thread for post ${postId}`);
      }
      thread = existingThreadResult.value;
    }

    // Create tweet records for each fragment
    for (const tweetFragment of threadPlan.tweets) {
      const dbTimer = this.workerMetrics.metrics.dbOperationDuration.startTimer({
        operation: "create_tweet",
        result: "pending",
      });

      try {
        const tweetResult = await this.repo.createTweet({
          threadId: thread.id,
          sequenceNumber: tweetFragment.sequence,
          content: tweetFragment.text,
          media: tweetFragment.media || [],
        });

        if (!tweetResult.ok && tweetResult.error !== "SEQUENCE_EXISTS") {
          dbTimer({ result: "error" });
          this.workerMetrics.metrics.threadErrors.inc({
            phase: "tweet_creation",
            error_type: "db_error",
            provider: providerName,
          });
          this.workerMetrics.recordError("database", "tweet_creation_failed", true);
          throw new Error(`Failed to create tweet ${tweetFragment.sequence}: ${tweetResult.error}`);
        }
        dbTimer({ result: "success" });
      } catch (e) {
        dbTimer({ result: "error" });
        throw e;
      }
    }

    // Now publish the thread using provider
    const providerTimer = this.workerMetrics.metrics.providerRequestDuration.startTimer({
      provider: providerName,
      operation: "publish_thread",
      status: "pending",
    });

    if (!provider.publishThread) {
      throw new Error(`Provider "${providerName}" does not support thread publishing`);
    }

    const credentialResult = await this.credentialResolver.resolve(channelId, accountId);
    if (!credentialResult.ok) {
      providerTimer({ status: "error" });
      throw new Error("AUTH");
    }

    const publishResult = await provider.publishThread(
      {
        threadPlan,
        channelId,
        dedupeKey,
      },
      credentialResult.value
    );

    if (!publishResult.ok) {
      providerTimer({ status: "error" });
      await this.repo.logPublish({
        postId,
        provider: providerName,
        channelId,
        status: "ERR",
        payload: {
          error: publishResult.error,
          threadId: thread.id,
          correlationId,
        },
        dedupeKey,
      });
      this.workerMetrics.metrics.publishErr.inc({
        provider: providerName,
        content_type: "thread",
        error_type: "provider_error",
        channel_id: channelId,
      });
      this.workerMetrics.metrics.threadErrors.inc({
        phase: "publishing",
        error_type: "provider_error",
        provider: providerName,
      });
      this.workerMetrics.recordError("publisher", "thread_publish_failed", true);
      this.workerMetrics.recordPostPublishFailed();
      this.workerMetrics.recordProviderPublishFailure(providerName);

      if (sagaId) {
        await this.notifySaga(sagaId, {
          type: "publish.job.failed",
          data: { postId, channelId, provider: providerName, threadId: thread.id },
        });
      }

      threadEndTimer();
      endTimer();
      throw new Error(String(publishResult.error));
    }

    providerTimer({ status: "success" });

    // Update tweet records with provider's tweet IDs and published status
    for (const publishedTweet of publishResult.value.tweets) {
      const dbTimer = this.workerMetrics.metrics.dbOperationDuration.startTimer({
        operation: "update_tweet",
        result: "pending",
      });

      try {
        const tweets = await this.repo.getTweetsByThread(thread.id);
        if (tweets.ok) {
          const tweet = tweets.value.find((t) => t.sequenceNumber === publishedTweet.sequence);
          if (tweet) {
            await this.repo.updateTweet(tweet.id, {
              tweetId: publishedTweet.providerTweetId,
              status: "PUBLISHED",
              publishedAt: publishedTweet.publishedAt,
            });
          }
        }
        dbTimer({ result: "success" });
      } catch (e) {
        dbTimer({ result: "error" });
        this.workerMetrics.recordError("database", "tweet_update_failed", true);
        throw e;
      }
    }

    await this.repo.logPublish({
      postId,
      provider: providerName,
      channelId,
      status: "OK",
      payload: { ...publishResult.value, correlationId },
      dedupeKey,
    });

    // Record successful thread metrics
    this.workerMetrics.metrics.publishOk.inc({
      provider: providerName,
      content_type: "thread",
      channel_id: channelId,
    });
    this.workerMetrics.recordPostPublished();
    this.workerMetrics.recordProviderPublishSuccess(providerName);
    this.workerMetrics.metrics.threadPublished.inc({
      strategy: threadPlan.strategy,
      provider: providerName,
      tweet_count: tweetCount.toString(),
    });
    this.workerMetrics.metrics.threadDuration.observe(
      { strategy: threadPlan.strategy, tweet_count_range: tweetCountRange },
      Date.now()
    );

    if (sagaId) {
      await this.notifySaga(sagaId, {
        type: "publish.job.completed",
        data: {
          postId,
          channelId,
          provider: providerName,
          threadId: thread.id,
          totalTweets: publishResult.value.totalTweets,
        },
      });
    }

    this.logger.info(
      {
        postId,
        channelId,
        provider: providerName,
        threadId: thread.id,
        totalTweets: publishResult.value.totalTweets,
        correlationId,
        strategy: threadPlan.strategy,
      },
      "Published thread"
    );

    threadEndTimer();
    endTimer();
    this.workerMetrics.removeCorrelationId(dedupeKey);

    return publishResult.value;
  }

  /**
   * @method handleJob
   * @description Entry point for a BullMQ publish job. Resolves the provider,
   *              short-circuits on prior OK logs (idempotency), loads + renders
   *              the post, and dispatches to single or thread publishing.
   *              Rethrows on failure so BullMQ applies its retry policy.
   * @param job - Job payload from BullMQ with post/channel/provider hints.
   */
  async handleJob(job: PublishJobInput): Promise<void> {
    const finishJob = this.workerMetrics.recordJobStart();
    const { postId, channelId } = job.payload;
    const providerName = job.payload.provider || "x";
    const sagaId = job.payload.sagaId;
    const dedupeKey = job.dedupeKey ?? `${postId}:${channelId}`;

    try {
      // Resolve the provider adapter from the registry
      const provider = this.resolveProvider(providerName);

      // Idempotency: skip if already OK for this dedupeKey
      const existing = await this.repo.getLogByDedupeKey(dedupeKey);
      if (existing.ok && existing.value && existing.value.status === "OK") {
        this.logger.info({ dedupeKey, provider: providerName }, "Skip publish (already OK)");
        this.workerMetrics.metrics.jobsSkipped.inc();
        finishJob();
        return;
      }

      const dbTimer = this.workerMetrics.metrics.dbOperationDuration.startTimer({
        operation: "get_post",
        result: "pending",
      });
      const post = await this.repo.getPostById(postId);
      if (!post.ok) {
        dbTimer({ result: "error" });
        this.workerMetrics.recordError("database", "post_not_found", false);
        throw new Error(`Post not found or repo unavailable: ${post.error}`);
      }
      dbTimer({ result: "success" });

      // Use provider's render method to get thread-aware content
      const renderTimer = this.workerMetrics.metrics.renderDuration.startTimer({
        provider: providerName,
        content_type: "unknown",
      });
      const rendered = provider.render(post.value);
      if (!rendered.ok) {
        renderTimer();
        this.workerMetrics.recordError("renderer", "render_failed", true);
        throw new Error(`Render error: ${rendered.error}`);
      }
      renderTimer({ content_type: rendered.value.type });

      // Resolve the tenant scope for this job once (D2). Post-deploy jobs carry
      // it in the payload; legacy jobs fall back to the channel's owner.
      const accountId = await this.resolveJobAccountId(channelId, job.payload.accountId);

      // Log RUNNING with correlation tracking
      const correlationId = this.workerMetrics.generateCorrelationId(dedupeKey);
      await this.repo.logPublish({
        postId,
        provider: providerName,
        channelId,
        status: "RUNNING",
        payload: {
          contentType: rendered.value.type,
          needsThreading: rendered.value.type === "thread",
          correlationId,
        },
        dedupeKey,
      });

      // Handle based on content type
      if (rendered.value.type === "thread") {
        const threadPlan = rendered.value.content as ThreadPlan;
        await this.publishThreadPost(
          postId,
          channelId,
          dedupeKey,
          threadPlan,
          providerName,
          provider,
          accountId,
          sagaId
        );
      } else {
        const singleContent = rendered.value.content as RenderedPost;
        await this.publishSinglePost(
          postId,
          channelId,
          dedupeKey,
          singleContent,
          providerName,
          provider,
          accountId,
          sagaId
        );
      }

      // Record successful job completion
      this.workerMetrics.metrics.jobsCompleted.inc({
        content_type: rendered.value.type,
      });
      finishJob();
    } catch (e) {
      this.workerMetrics.metrics.jobsFailed.inc({
        error_category: "processing_error",
      });
      this.workerMetrics.recordError("worker", "job_failed", true);
      this.logger.error({ err: e, dedupeKey, provider: providerName }, "Worker job error");

      // Best-effort saga notification on unhandled errors
      if (sagaId) {
        await this.notifySaga(sagaId, {
          type: "publish.job.failed",
          data: {
            postId,
            channelId,
            provider: providerName,
            error: e instanceof Error ? e.message : "Unknown error",
          },
        });
      }

      finishJob();
      // Re-throw so BullMQ marks the job failed and the queue's retry
      // policy takes effect. Swallowing here would let every publish
      // failure look like a success to the queue layer.
      throw e;
    }
  }
}
