/**
 * Type definitions for the PublishHandler.
 *
 * Extracted into a separate file to keep publishHandler.ts under the 800-line limit.
 * All interfaces are re-exported from publishHandler.ts for backwards compatibility.
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
import type { ContentMetrics } from "./telemetry/initialization.js";

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

  getLogByDedupeKey(dedupeKey: string): Promise<Result<{ status: string } | null, string>>;

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
 * Provider interface for the publish handler.
 * Mirrors the subset of ProviderAdapter used by publish operations.
 */
export interface PublishProvider {
  publish(input: {
    channelId: string;
    post: RenderedPost;
    dedupeKey: string;
  }): Promise<Result<PublishReceipt, PublishError>>;

  publishThread?(input: {
    threadPlan: ThreadPlan;
    channelId: string;
    dedupeKey: string;
  }): Promise<Result<ThreadReceipt, PublishError>>;

  render(canonical: CanonicalPost): Result<RenderedContent, RenderError>;
}

/**
 * Instrumentation interface for OpenTelemetry spans.
 */
export interface PublishInstrumentation {
  instrumentPublishing(
    name: string,
    provider: string,
    channelId: string,
    type: string,
    fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>,
    metadata?: Record<string, string>
  ): Promise<unknown>;

  instrumentProviderAPI(
    provider: string,
    operation: string,
    method: string,
    fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>
  ): Promise<unknown>;
}

/**
 * Database instrumentation interface.
 */
export interface DatabaseInstrumentation {
  instrumentQuery(operation: string, table: string, fn: () => Promise<unknown>): Promise<unknown>;
}

/**
 * Business KPI tracker interface.
 */
export interface BusinessKPITracker {
  trackContentPublication(metrics: ContentMetrics): void;
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
  workerMetrics: WorkerMetrics;
  logger: pino.Logger;
  instrumentation: PublishInstrumentation;
  databaseInstrumentation: DatabaseInstrumentation;
  businessKPITracker: BusinessKPITracker;
  notifyRedis?: SagaNotifier;
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
