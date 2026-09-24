/**
 * @file publishHandler.ts
 * @description Core publish orchestrator that renders posts, executes provider publishing (single
 *              and threaded), records receipts, and coordinates with saga notifiers.
 * @layer infrastructure
 */
import { UnrecoverableError } from "bullmq";
import {
  readPublishJobId,
  type RenderedPost,
  type Result,
  type ThreadPlan,
  type ThreadReceipt,
  type PublishError,
  type Thread,
  type Tweet,
} from "@shared/types";
import type { PublishReceipt } from "@ports/core";
import { ContentFingerprint, PUBLICATION_OUTCOME_KINDS } from "@core/domain/index.js";
import type { RecordChannelPublicationAttemptOutput } from "@core/posts";
import type {
  ContentMetrics,
  PublishInstrumentation,
  DatabaseInstrumentation,
  BusinessKPITracker,
} from "./telemetry/instrumentationTypes.js";
import { classifyPublishFailure } from "./lib/classifyPublishFailure.js";
import type { ChannelRecordState } from "./publicationRecordProbe.js";
import type { PublishOutcomeReceipt, PublishOutcomeUnrecorded } from "./publishOutcomeRecorder.js";

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
  PublicationAttemptContext,
  PublishHandlerDeps,
  PublishJobInput,
} from "./publishHandlerTypes.js";

import type {
  PublishRepo,
  PublishProvider,
  SagaNotifier,
  PublicationAttemptContext,
  PublishHandlerDeps,
  PublishJobInput,
} from "./publishHandlerTypes.js";

/** What the record says this job may do: attempt, or one of the reasons it may not. */
type ChannelVerdict = "attempt" | "stale" | "published" | "excluded";

/**
 * @function readChannelVerdict
 * @description Decides, from the record alone, whether this job's channel is still
 *   open at this job's episode.
 *
 *   A record on ANY other episode — ahead or behind — is not this job's business,
 *   and asking again cannot make it so: the pivot opens the episode before it
 *   enqueues, so a job can only be looking at a record that moved on without it.
 * @param channel - The channel's recorded state.
 * @param episode - The episode the job id names.
 * @returns The verdict.
 */
function readChannelVerdict(channel: ChannelRecordState, episode: number): ChannelVerdict {
  if (channel.episode !== episode) {
    return "stale";
  }
  if (channel.outcome === PUBLICATION_OUTCOME_KINDS.PUBLISHED) {
    return "published";
  }
  return channel.outcome === PUBLICATION_OUTCOME_KINDS.EXCLUDED ? "excluded" : "attempt";
}

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
  private readonly outcomeRecorder: PublishHandlerDeps["outcomeRecorder"];
  private readonly publicationRecord: PublishHandlerDeps["publicationRecord"];
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
    this.outcomeRecorder = deps.outcomeRecorder;
    this.publicationRecord = deps.publicationRecord;
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
   * @method notifyPublishFailed
   * @description Nudges the saga that this job produced no publication. The saga
   *              settles on the publication record, so this only wakes the waiting
   *              step; it is skipped entirely for a job that belongs to no saga.
   * @param sagaId - The saga waiting on this channel, when there is one.
   * @param data - What the event carries about the job.
   * @returns Nothing.
   */
  private async notifyPublishFailed(
    sagaId: string | undefined,
    data: Record<string, unknown>
  ): Promise<void> {
    if (!sagaId) return;
    await this.notifySaga(sagaId, { type: "publish.job.failed", data });
  }

  /**
   * @method recordOutcome
   * @description Makes one channel's outcome durable and answers whether the queue
   *              should run this job again. The recorder never throws, and this
   *              never lets it: a raised error here would reach BullMQ, which
   *              re-runs the handler over content the provider has already accepted.
   * @param receipt - What this attempt achieved, as a primitive wire value.
   * @returns True while the record the write produced is still unresolved.
   */
  private async recordOutcome(receipt: PublishOutcomeReceipt): Promise<boolean> {
    const recorded: Result<RecordChannelPublicationAttemptOutput, PublishOutcomeUnrecorded> =
      await this.outcomeRecorder.record(receipt);
    if (!recorded.ok) {
      // The outcome is either on the durable queue or already counted as lost. Either
      // way the provider call stands, so re-running it would publish the same content
      // a second time to win another chance at a write.
      return false;
    }
    return recorded.value.outcome.kind === PUBLICATION_OUTCOME_KINDS.UNRESOLVED;
  }

  /**
   * @method failedReceipt
   * @description Builds the receipt for an attempt that did not publish, classifying
   *              the failure and carrying whatever the provider left live.
   * @param job - Post, channel and plan size this attempt belongs to.
   * @param attempt - Tenant, episode and ordinal the record is written against.
   * @param failure - The provider's error code, a render error, or a thrown value.
   * @param liveFragments - What reached the provider before the failure, in order.
   * @param detail - A short human-readable cause, when the code does not carry one.
   * @returns The receipt.
   */
  private failedReceipt(
    job: { postId: string; channelId: string; planSize: number },
    attempt: PublicationAttemptContext,
    failure: unknown,
    liveFragments: ThreadReceipt["tweets"],
    detail?: string
  ): PublishOutcomeReceipt {
    const verdict = classifyPublishFailure(failure);
    return {
      postId: job.postId,
      channelId: job.channelId,
      accountId: attempt.accountId,
      episode: attempt.episode,
      attemptNo: attempt.attemptNo,
      planSize: job.planSize,
      result: {
        kind: "failed",
        classification: verdict.classification,
        ...(verdict.code !== undefined && { code: verdict.code }),
        ...(detail !== undefined && { detail }),
        publishedFragments: liveFragments.map((fragment) => ({
          index: fragment.sequence,
          externalId: fragment.providerTweetId,
          ...(fragment.url !== undefined && { url: fragment.url }),
        })),
      },
    };
  }

  /**
   * @method publishedReceipt
   * @description Builds the receipt for an attempt where every fragment went out.
   * @param job - Post, channel and plan size this attempt belongs to.
   * @param attempt - Tenant, episode, ordinal and the fingerprint of what was sent.
   * @param fragments - Every fragment the provider confirmed, in order.
   * @param publishedAt - When the provider reported the publication.
   * @returns The receipt.
   */
  private publishedReceipt(
    job: { postId: string; channelId: string; planSize: number },
    attempt: PublicationAttemptContext,
    fragments: ThreadReceipt["tweets"],
    publishedAt: Date
  ): PublishOutcomeReceipt {
    const head = fragments[0]?.providerTweetId;
    return {
      postId: job.postId,
      channelId: job.channelId,
      accountId: attempt.accountId,
      episode: attempt.episode,
      attemptNo: attempt.attemptNo,
      planSize: job.planSize,
      result: {
        kind: "published",
        fragments: fragments.map((fragment) => ({
          index: fragment.sequence,
          externalId: fragment.providerTweetId,
          ...(fragment.url !== undefined && { url: fragment.url }),
        })),
        ...(head !== undefined && { headExternalId: head }),
        publishedAt: publishedAt.toISOString(),
        contentHash: attempt.contentHash,
      },
    };
  }

  /**
   * @method writeReceiptMirror
   * @description Writes the best-effort `publish_log` mirror row. It is a receipt,
   *              never a source of truth: the publication record already committed,
   *              so a mirror that cannot be written costs visibility and nothing else.
   * @param input - The row to upsert, keyed by the episode-stripped job id.
   * @returns Nothing.
   */
  private async writeReceiptMirror(input: {
    postId: string;
    provider: string;
    channelId: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<void> {
    try {
      await this.repo.logPublish({ ...input, status: "OK" });
    } catch (error: unknown) {
      this.logger.warn(
        { err: error, postId: input.postId, channelId: input.channelId },
        "Could not mirror the publication receipt"
      );
    }
  }

  /**
   * @method publishSinglePost
   * @description Publish a single rendered post through a provider adapter, record
   *              what the attempt achieved, mirror the receipt, update metrics, and
   *              notify the saga.
   * @param postId - Aggregate identifier of the post being published.
   * @param channelId - Destination channel.
   * @param dedupeKey - Stable key used for idempotency and correlation tracking.
   * @param rendered - Provider-rendered post payload.
   * @param providerName - Provider key matching the registry entry.
   * @param provider - Resolved provider adapter implementation.
   * @param attempt - Tenant, episode and ordinal this attempt is recorded under.
   * @param sagaId - Optional saga identifier for orchestration callbacks.
   * @returns The provider's publish receipt, or void when a settled failure ends the job.
   */
  async publishSinglePost(
    postId: string,
    channelId: string,
    dedupeKey: string,
    rendered: RenderedPost,
    providerName: string,
    provider: PublishProvider,
    attempt: PublicationAttemptContext,
    sagaId?: string
  ): Promise<PublishReceipt | void> {
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

        // A single item publishes all-or-nothing, so a failure leaves nothing live.
        const job = { postId, channelId, planSize: 1 };

        try {
          const credentialResult = await this.credentialResolver.resolve(
            channelId,
            attempt.accountId
          );
          if (!credentialResult.ok) {
            providerTimer({ status: "error" });
            this.workerMetrics.metrics.publishErr.inc({
              provider: providerName,
              content_type: "single",
              error_type: "auth_error",
              channel_id: channelId,
            });
            this.workerMetrics.recordError("publisher", "auth_error", true);
            this.workerMetrics.recordPostPublishFailed();
            this.workerMetrics.recordProviderPublishFailure(providerName);

            const retry = await this.recordOutcome(
              this.failedReceipt(job, attempt, credentialResult.error, [])
            );
            await this.notifyPublishFailed(sagaId, { postId, channelId, provider: providerName });
            endTimer();
            if (retry) {
              throw new Error("AUTH");
            }
            return;
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

            const retry = await this.recordOutcome(this.failedReceipt(job, attempt, res.error, []));
            await this.notifyPublishFailed(sagaId, { postId, channelId, provider: providerName });

            endTimer();
            if (retry) {
              throw new Error(String(res.error));
            }
            return;
          }

          providerTimer({ status: "success" });

          // The record commits FIRST and the mirror follows it. A mirror written
          // ahead of the record would be the only durable trace of a publication
          // nothing else accounts for — the state this record exists to delete.
          await this.recordOutcome(
            this.publishedReceipt(
              job,
              attempt,
              [
                {
                  sequence: 1,
                  providerTweetId: res.value.providerPostId,
                  ...(res.value.url !== undefined && { url: res.value.url }),
                  publishedAt: res.value.publishedAt,
                },
              ],
              res.value.publishedAt
            )
          );

          await this.databaseInstrumentation.instrumentQuery("insert", "publish_log", async () =>
            this.writeReceiptMirror({
              postId,
              provider: providerName,
              channelId,
              payload: { ...res.value, correlationId },
              dedupeKey,
            })
          );

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
    )) as PublishReceipt | void;
  }

  /**
   * @method markFragmentsPublished
   * @description Marks the tweet row of every fragment the provider confirmed as
   *              PUBLISHED, carrying its provider id and timestamp. Used by BOTH
   *              thread outcomes: a thread that failed part-way still left its
   *              earlier fragments live, and these rows are what keeps them
   *              addressable.
   * @param threadId - Thread whose rows are reconciled.
   * @param fragments - Fragments the provider confirmed, in order.
   * @returns Nothing. A repository failure is counted and rethrown; the FAILURE
   *          path's caller catches it so the provider's verdict still reaches
   *          the saga.
   */
  private async markFragmentsPublished(
    threadId: string,
    fragments: ThreadReceipt["tweets"]
  ): Promise<void> {
    if (fragments.length === 0) {
      return;
    }

    // One read for the whole thread. The rows are this worker's own and nothing
    // else writes them while the loop runs, so re-reading them per fragment only
    // bought a query per fragment.
    let rows: Tweet[] = [];
    try {
      const tweets = await this.repo.getTweetsByThread(threadId);
      if (!tweets.ok) {
        // Every fragment update depends on this read, so a refusal drops ALL of
        // them. Skipping it silently left the live set with no rows and nothing
        // saying so; it is reported through the same counter the write failure
        // feeds, so the alert sees both arms of the one condition.
        this.logger.error(
          { threadId, error: tweets.error, liveFragmentCount: fragments.length },
          "Could not read the thread rows of an interrupted thread; every fragment update is dropped"
        );
        this.workerMetrics.recordError("publisher", "thread_live_fragments_unrecorded", true);
        return;
      }
      rows = tweets.value;
    } catch (e) {
      this.workerMetrics.recordError("database", "tweet_update_failed", true);
      throw e;
    }

    for (const fragment of fragments) {
      const dbTimer = this.workerMetrics.metrics.dbOperationDuration.startTimer({
        operation: "update_tweet",
        result: "pending",
      });

      try {
        const tweet = rows.find((t) => t.sequenceNumber === fragment.sequence);
        if (tweet) {
          await this.repo.updateTweet(tweet.id, {
            tweetId: fragment.providerTweetId,
            status: "PUBLISHED",
            publishedAt: fragment.publishedAt,
          });
        }
        dbTimer({ result: "success" });
      } catch (e) {
        dbTimer({ result: "error" });
        this.workerMetrics.recordError("database", "tweet_update_failed", true);
        throw e;
      }
    }
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
   * @param attempt - Tenant, episode and ordinal this attempt is recorded under.
   * @param sagaId - Optional saga identifier for orchestration callbacks.
   * @returns The thread receipt, or void when the thread was already complete or a
   *          settled failure ended the job.
   */
  async publishThreadPost(
    postId: string,
    channelId: string,
    dedupeKey: string,
    threadPlan: ThreadPlan,
    providerName: string,
    provider: PublishProvider,
    attempt: PublicationAttemptContext,
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

    const job = { postId, channelId, planSize: tweetCount };

    const credentialResult = await this.credentialResolver.resolve(channelId, attempt.accountId);
    if (!credentialResult.ok) {
      providerTimer({ status: "error" });
      const retry = await this.recordOutcome(
        this.failedReceipt(job, attempt, credentialResult.error, [])
      );
      await this.notifyPublishFailed(sagaId, { postId, channelId, provider: providerName });
      threadEndTimer();
      endTimer();
      if (retry) {
        throw new Error("AUTH");
      }
      return;
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
      const { code, publishedFragments } = publishResult.error;

      // The rows first, so the references the record is about to carry have rows
      // behind them. A repository blip here is REPORTED and then stepped over: it
      // says nothing about what is live, and the record below is what does.
      try {
        await this.markFragmentsPublished(thread.id, publishedFragments);
      } catch (rowError: unknown) {
        this.logger.error(
          {
            postId,
            channelId,
            threadId: thread.id,
            code,
            liveFragmentCount: publishedFragments.length,
            err: rowError,
          },
          "Could not record the live fragments of an interrupted thread"
        );
        this.workerMetrics.recordError("publisher", "thread_live_fragments_unrecorded", true);
      }

      // The record write sits OUTSIDE the catch above and BEFORE the saga is told
      // anything: a row that could not be written must not take the channel's
      // exclusion with it, and nobody may act on this channel before the record
      // names what is live on the provider.
      const retry = await this.recordOutcome(
        this.failedReceipt(job, attempt, code, publishedFragments)
      );

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

      await this.notifyPublishFailed(sagaId, {
        postId,
        channelId,
        provider: providerName,
        threadId: thread.id,
        publishedFragments,
      });

      threadEndTimer();
      endTimer();
      // Rethrowing hands the job back to BullMQ, which re-runs the WHOLE plan over
      // fragments that are already live. Only a channel the record still leaves
      // unresolved has budget for that.
      if (retry) {
        throw new Error(code);
      }
      return;
    }

    providerTimer({ status: "success" });

    // The same rule as the failure path above, on the path where every fragment
    // went out: the rows are a secondary trace and the record below is what this
    // channel is decided on, so a repository blip is REPORTED and stepped over.
    // An escaping throw would skip the record write, and the redelivery would
    // then find a channel still unresolved over a thread that is already live.
    try {
      await this.markFragmentsPublished(thread.id, publishResult.value.tweets);
    } catch (rowError: unknown) {
      this.logger.error(
        {
          postId,
          channelId,
          threadId: thread.id,
          liveFragmentCount: publishResult.value.tweets.length,
          err: rowError,
        },
        "Could not record the rows of a fully published thread"
      );
      this.workerMetrics.recordError("publisher", "thread_live_fragments_unrecorded", true);
    }

    const publishedAt =
      publishResult.value.tweets[publishResult.value.tweets.length - 1]?.publishedAt ?? new Date();
    await this.recordOutcome(
      this.publishedReceipt(job, attempt, publishResult.value.tweets, publishedAt)
    );

    await this.writeReceiptMirror({
      postId,
      provider: providerName,
      channelId,
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
   * @method refuseJob
   * @description Ends a job the queue must never run again, counting WHY. None of
   *              the three causes becomes runnable by trying: a job with no tenant
   *              or no episode predates the publication record, and a channel the
   *              record does not hold is addressed at nothing.
   * @param reason - Which cause applied, as the counter's label.
   * @param context - Job identity for the log.
   * @returns The error to throw so BullMQ retires the job immediately.
   */
  private refuseJob(reason: string, context: object): Error {
    this.workerMetrics.metrics.publishJobUnrecoverable.inc({ reason });
    this.logger.error({ ...context, reason }, "Publish job refused: it can never succeed");
    return new UnrecoverableError(`publish job refused (${reason})`);
  }

  /**
   * @method handleJob
   * @description Entry point for a BullMQ publish job. Refuses a job that names no
   *              tenant or no episode, reads the publication record to decide
   *              whether this channel is still open, then loads, renders and
   *              dispatches to single or thread publishing. Rethrows only while the
   *              record the attempt produced leaves the channel unresolved.
   * @param job - Job payload from BullMQ with post/channel/provider hints.
   * @returns Nothing.
   */
  async handleJob(job: PublishJobInput): Promise<void> {
    const finishJob = this.workerMetrics.recordJobStart();
    const { postId, channelId } = job.payload;
    const providerName = job.payload.provider || "x";
    const sagaId = job.payload.sagaId;

    // W4, before anything is touched. The payload arrives as queue data, so the
    // typed shape is a claim about the producer and these two are the check.
    const accountId = job.payload.accountId;
    const identity = readPublishJobId(job.dedupeKey);
    if (typeof accountId !== "string" || accountId.length === 0 || identity === undefined) {
      finishJob();
      throw this.refuseJob("pre_change_job", { postId, channelId, jobId: job.dedupeKey });
    }
    const dedupeKey = identity.mirrorKey;

    try {
      // Resolve the provider adapter from the registry
      const provider = this.resolveProvider(providerName);

      // Idempotency lives in the RECORD now: it is the one place that says what
      // each channel did with this post, and it is what the saga settles on.
      const observed = await this.publicationRecord.readChannel({ postId, channelId, accountId });
      if (!observed.ok) {
        // An unreadable record is not "nothing has happened yet". Nothing is live
        // at this point, so handing the job back is the safe answer.
        this.workerMetrics.recordError("database", "publication_record_unreadable", true);
        throw new Error(`Publication record unreadable: ${observed.error}`);
      }
      if (observed.value === undefined) {
        throw this.refuseJob("missing_record", { postId, channelId, jobId: job.dedupeKey });
      }
      const verdict = readChannelVerdict(observed.value, identity.episode);

      if (verdict !== "attempt") {
        this.logger.info(
          { postId, channelId, provider: providerName, verdict },
          "Skip publish (this job's channel is not open at this episode)"
        );
        this.workerMetrics.metrics.jobsSkipped.inc();
        if (verdict === "stale") {
          this.workerMetrics.metrics.publishJobUnrecoverable.inc({ reason: "stale_episode" });
        }
        if (verdict === "published") {
          if (sagaId) {
            await this.notifySaga(sagaId, {
              type: "publish.job.completed",
              data: { postId, channelId, provider: providerName },
            });
          }
        } else {
          await this.notifyPublishFailed(sagaId, {
            postId,
            channelId,
            provider: providerName,
            verdict,
          });
        }
        finishJob();
        return;
      }

      const dbTimer = this.workerMetrics.metrics.dbOperationDuration.startTimer({
        operation: "get_post",
        result: "pending",
      });
      const post = await this.repo.getPostById(postId);
      if (!post.ok) {
        if (post.error === "SOFT_DELETED") {
          // Deletion liveness gate. The repo saw the row and classified its
          // chain (post → project → account) as soft-deleted. Adjudicated as a
          // TERMINAL no-op, not an error: throwing would hand the job to
          // BullMQ's retry policy, and a retry that lands after the entity is
          // restored would publish content the tenant deleted — restoring must
          // never republish as a queue side effect. The read itself succeeded.
          dbTimer({ result: "success" });
          this.logger.info(
            { postId, channelId, provider: providerName, dedupeKey, reason: "SOFT_DELETED" },
            "Skip publish (post, project, or account soft-deleted)"
          );
          this.workerMetrics.metrics.jobsSkipped.inc();
          finishJob();
          return;
        }
        dbTimer({ result: "error" });
        this.workerMetrics.recordError("database", "post_not_found", false);
        throw new Error(`Post not found or repo unavailable: ${post.error}`);
      }
      dbTimer({ result: "success" });

      // The fingerprint of what is about to be sent, computed once over the same
      // canonical form every other reader of this post computes it over.
      const attempt: PublicationAttemptContext = {
        accountId,
        episode: identity.episode,
        attemptNo: job.attemptsMade + 1,
        contentHash: ContentFingerprint.ofContent({
          body: post.value.body,
          mediaIds: (post.value.media ?? []).map((item) => item.id),
        }).value,
      };

      // Use provider's render method to get thread-aware content
      const renderTimer = this.workerMetrics.metrics.renderDuration.startTimer({
        provider: providerName,
        content_type: "unknown",
      });
      const rendered = provider.render(post.value);
      if (!rendered.ok) {
        renderTimer();
        this.workerMetrics.recordError("renderer", "render_failed", true);
        // The render error VALUE reaches the classifier, not a string built from
        // it: the closed union is what makes this a named channel failure instead
        // of one more unrecognised shape.
        const retry = await this.recordOutcome(
          this.failedReceipt({ postId, channelId, planSize: 1 }, attempt, rendered.error, [])
        );
        await this.notifyPublishFailed(sagaId, { postId, channelId, provider: providerName });
        finishJob();
        if (retry) {
          throw new Error(`Render error: ${rendered.error}`);
        }
        return;
      }
      renderTimer({ content_type: rendered.value.type });

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
          attempt,
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
          attempt,
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
      await this.notifyPublishFailed(sagaId, {
        postId,
        channelId,
        provider: providerName,
        error: e instanceof Error ? e.message : "Unknown error",
      });

      finishJob();
      // Re-throw so BullMQ marks the job failed and the queue's retry
      // policy takes effect. Swallowing here would let every publish
      // failure look like a success to the queue layer.
      throw e;
    }
  }
}
