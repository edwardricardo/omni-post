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
  PublishError,
  Thread,
  Tweet,
  TweetStatus,
  Media,
} from "@shared/types";
import type { PublishReceipt } from "@ports/core";
import type { WorkerMetrics } from "./metrics/workerMetrics.js";
import type { ChannelAuthFailureRecorder } from "./services/ChannelAuthFailureRecorder.js";
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

  getLogByDedupeKey(
    dedupeKey: string
  ): Promise<Result<{ status: string; providerPostId?: string | null } | null, string>>;

  /**
   * Persist the provider's post id on the existing log row (keyed by dedupeKey)
   * right after a successful provider publish, before the OK log. A crash-then-
   * retry in the provider-success window then confirms the receipt instead of
   * re-publishing. Narrows the double-post window; does NOT make it exactly-once.
   */
  recordReceipt(dedupeKey: string, providerPostId: string): Promise<Result<unknown, string>>;

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

  publishThread?(
    input: {
      threadPlan: ThreadPlan;
      channelId: string;
      dedupeKey: string;
    },
    credentials: unknown
  ): Promise<Result<ThreadReceipt, PublishError>>;

  render(canonical: CanonicalPost): Result<RenderedContent, RenderError>;
}

/**
 * Resolves a channel's plaintext credentials. Implemented by the application
 * layer's `CredentialResolver`; injected so the handler can be exercised with
 * a fake in tests.
 */
export interface CredentialsLookup {
  resolve(channelId: string): Promise<Result<unknown, "AUTH">>;
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
  notifyRedis?: SagaNotifier;
  /**
   * Records a channel auth-failure (flips `Channel.needsReauth` + emits a
   * `ChannelAuthFailed` outbox event) when a publish fails with `AUTH`. Optional
   * for backward compatibility with unit tests that do not exercise the reauth
   * path; the workers composition root always injects it so production publishes
   * flag the channel for re-authentication. Same single-source primitive the
   * mention-ingest worker uses, routed through `handleProviderAuthError`.
   */
  authFailureRecorder?: ChannelAuthFailureRecorder;
}

/**
 * Job payload shape from BullMQ.
 *
 * - `provider` identifies which adapter to route to (defaults to "x")
 * - `sagaId` is set when the job is part of a saga batch
 */
export interface PublishJobInput {
  payload: {
    postId: string;
    channelId: string;
    provider?: string;
    sagaId?: string;
  };
  dedupeKey?: string;
}
