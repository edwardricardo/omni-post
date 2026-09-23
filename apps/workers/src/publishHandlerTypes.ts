/**
 * @file publishHandlerTypes.ts
 * @description Type definitions for the PublishHandler (repo, provider, deps, job input).
 * @layer infrastructure
 */

import type pino from "pino";
import type {
  CanonicalPost,
  Result,
  RenderedContent,
  RenderedPost,
  RenderError,
  ThreadPlan,
  ThreadReceipt,
  ThreadPublishFailure,
  PublishError,
  Thread,
  Tweet,
  TweetStatus,
  Media,
} from "@shared/types";
import type { PublishReceipt } from "@ports/core";
import type { WorkerMetrics } from "./metrics/workerMetrics.js";
import type { PublicationRecordProbe } from "./publicationRecordProbe.js";
import type { PublishOutcomeRecorder } from "./publishOutcomeRecorder.js";
import type {
  PublishInstrumentation,
  DatabaseInstrumentation,
  BusinessKPITracker,
} from "./telemetry/instrumentationTypes.js";

/**
 * Repository interface for the publish handler.
 * Mirrors the subset of RepoPort used by publish operations.
 */
export interface PublishRepo {
  logPublish(input: {
    postId: string;
    provider: string;
    channelId: string;
    status: "QUEUED" | "RUNNING" | "OK" | "ERR";
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<Result<unknown, string>>;

  getPostById(id: string): Promise<Result<CanonicalPost, string>>;

  createThread(input: { postId: string; strategy: string }): Promise<Result<Thread, string>>;

  getThreadByPostId(postId: string): Promise<Result<Thread | null, string>>;

  getTweetsByThread(threadId: string): Promise<Result<Tweet[], string>>;

  createTweet(input: {
    threadId: string;
    sequenceNumber: number;
    content: string;
    media: Media[];
  }): Promise<Result<Tweet, string>>;

  updateTweet(
    tweetId: string,
    input: {
      tweetId?: string;
      status: TweetStatus;
      publishedAt?: Date;
    }
  ): Promise<Result<Tweet, string>>;
}

/**
 * Provider interface used by the publish handler. Mirrors the credential-explicit
 * shape of ProviderAdapter — the handler resolves credentials before invoking
 * the provider, so adapters do not perform their own DB lookup.
 */
export interface PublishProvider {
  publish(
    input: {
      channelId: string;
      post: RenderedPost;
      dedupeKey: string;
    },
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>>;

  /**
   * A thread failure names which fragments already reached the provider
   * (`publishedFragments`, in order, empty when nothing went out) — the handler
   * needs that set to reconcile the tweet rows and report the failure truthfully.
   */
  publishThread?(
    input: {
      threadPlan: ThreadPlan;
      channelId: string;
      dedupeKey: string;
    },
    credentials: unknown
  ): Promise<Result<ThreadReceipt, ThreadPublishFailure>>;

  render(canonical: CanonicalPost): Result<RenderedContent, RenderError>;
}

/**
 * Resolves a channel's plaintext credentials. Implemented by the application
 * layer's `CredentialResolver`; injected so the handler can be exercised with
 * a fake in tests.
 */
export interface CredentialsLookup {
  resolve(channelId: string, accountId: string): Promise<Result<unknown, "AUTH">>;
}

/**
 * Redis pub/sub interface for saga event notifications.
 * Optional -- only used when saga orchestration is active.
 */
export interface SagaNotifier {
  publish: (channel: string, message: string) => Promise<number>;
}

/**
 * All dependencies injected into the PublishHandler.
 */
export interface PublishHandlerDeps {
  repo: PublishRepo;
  providerRegistry: Record<string, PublishProvider>;
  credentialResolver: CredentialsLookup;
  workerMetrics: WorkerMetrics;
  logger: pino.Logger;
  instrumentation: PublishInstrumentation;
  databaseInstrumentation: DatabaseInstrumentation;
  businessKPITracker: BusinessKPITracker;
  /** Makes what the provider did durable. It answers a Result and never throws. */
  outcomeRecorder: PublishOutcomeRecorder;
  /** Read before any provider call, to decide whether this channel is still open. */
  publicationRecord: PublicationRecordProbe;
  notifyRedis?: SagaNotifier;
}

/**
 * What the record write needs about the job that produced an outcome, carried as one
 * value so the two publish paths take the same argument and neither can be given a
 * tenant without the episode it belongs to.
 */
export interface PublicationAttemptContext {
  /** Tenant the record write binds to. */
  readonly accountId: string;
  /** The attempt episode the job was minted for, parsed from the job id. */
  readonly episode: number;
  /** Ordinal within the episode — stable across a redelivery of the same attempt. */
  readonly attemptNo: number;
  /** Fingerprint of the content sent, so a later read can tell what was published. */
  readonly contentHash: string;
}

/**
 * Job payload shape from BullMQ.
 *
 * - `provider` identifies which adapter to route to (defaults to "x")
 * - `sagaId` is set when the job is part of a saga batch
 * - `accountId` scopes every credential/channel lookup and every record write to
 *   the owning tenant. Required: a job that carries none was enqueued before the
 *   publication record existed, and the handler refuses it rather than guessing a
 *   tenant from the channel.
 *
 * This shape describes a WELL-FORMED job. The payload reaches the worker as queue
 * data, so the handler still validates it at runtime — the cast at the queue seam
 * is a claim about the producer, not a fact about the bytes.
 */
export interface PublishJobInput {
  payload: {
    postId: string;
    channelId: string;
    accountId: string;
    provider?: string;
    sagaId?: string;
  };
  /** The BullMQ job id: `publish-{postId}-{channelId}-e{episode}`. */
  dedupeKey?: string;
  /**
   * How many attempts BullMQ has already spent; the attempt ordinal is this plus
   * one. Required, and never defaulted: a silent zero would make every redelivery
   * look like the first attempt, and the record's replay guard is keyed on it.
   */
  attemptsMade: number;
}
