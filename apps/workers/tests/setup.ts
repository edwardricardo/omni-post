/**
 * @file setup.ts
 * @description Test utilities, data factories, and mock dependency factories
 *              for PublishHandler unit tests.
 * @layer infrastructure
 */
import client from "prom-client";
import pino from "pino";
import { ok, type Result } from "@shared/types";
import type {
  CanonicalPost,
  Thread,
  Tweet,
  ThreadPlan,
  ThreadReceipt,
  ThreadPublishFailure,
  RenderedContent,
  RenderedPost,
  RenderError,
  PublishError,
  TweetStatus,
} from "@shared/types";
import type { PublishReceipt } from "@ports/core";
import {
  ATTEMPT_CLASSIFICATIONS,
  CHANNEL_ATTEMPT_BUDGET,
  ContentFingerprint,
  ExclusionReason,
  FragmentReference,
  PUBLICATION_OUTCOME_KINDS,
  providedReference,
  type PublicationOutcome,
  type PublicationOutcomeKind,
} from "@core/domain/index.js";
import type { RecordChannelPublicationAttemptOutput } from "@core/posts";
import { WorkerMetrics } from "../src/metrics/workerMetrics.js";
import type {
  PublishOutcomeReceipt,
  PublishOutcomeRecorder,
  PublishOutcomeUnrecorded,
} from "../src/publishOutcomeRecorder.js";
import type { ChannelRecordState, PublicationRecordProbe } from "../src/publicationRecordProbe.js";
import type {
  PublishRepo,
  PublishProvider,
  PublishInstrumentation,
  DatabaseInstrumentation,
  BusinessKPITracker,
  PublicationAttemptContext,
  PublishHandlerDeps,
} from "../src/publishHandler.js";

// ---------- Data Factories ----------

const NOW = new Date("2026-03-02T12:00:00Z");

export function createTestPost(overrides?: Partial<CanonicalPost>): CanonicalPost {
  return {
    id: "post-001",
    projectId: "project-001",
    locale: "es",
    body: "Test post body",
    ...overrides,
  };
}

export function createTestThread(overrides?: Partial<Thread>): Thread {
  return {
    id: "thread-001",
    postId: "post-001",
    strategy: "AUTO",
    tweets: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function createTestTweet(overrides?: Partial<Tweet>): Tweet {
  return {
    id: "tweet-001",
    threadId: "thread-001",
    sequenceNumber: 1,
    content: "Tweet content",
    status: "PENDING" as TweetStatus,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function createTestThreadPlan(overrides?: Partial<ThreadPlan>): ThreadPlan {
  return {
    strategy: "AUTO",
    tweets: [
      { sequence: 1, text: "Tweet 1", estimatedChars: 7 },
      { sequence: 2, text: "Tweet 2", estimatedChars: 7 },
    ],
    totalChars: 14,
    estimatedReach: 100,
    needsThreading: true,
    ...overrides,
  };
}

export function createTestRenderedPost(overrides?: Partial<RenderedPost>): RenderedPost {
  return {
    body: "Rendered post body",
    ...overrides,
  };
}

export function createTestPublishReceipt(overrides?: Partial<PublishReceipt>): PublishReceipt {
  return {
    providerPostId: "x-post-12345",
    url: "https://x.com/user/status/12345",
    publishedAt: NOW,
    ...overrides,
  };
}

export function createTestThreadReceipt(overrides?: Partial<ThreadReceipt>): ThreadReceipt {
  return {
    threadId: "thread-001",
    tweets: [
      {
        sequence: 1,
        providerTweetId: "x-tweet-001",
        url: "https://x.com/user/status/001",
        publishedAt: NOW,
      },
      {
        sequence: 2,
        providerTweetId: "x-tweet-002",
        url: "https://x.com/user/status/002",
        publishedAt: NOW,
      },
    ],
    totalTweets: 2,
    ...overrides,
  };
}

// ---------- Mock Factories ----------

export function createMockRepo(): PublishRepo {
  return {
    logPublish: async () => ({ ok: true, value: {} }) as Result<unknown, string>,
    getPostById: async () =>
      ({ ok: true, value: createTestPost() }) as Result<CanonicalPost, string>,
    createThread: async () => ({ ok: true, value: createTestThread() }) as Result<Thread, string>,
    getThreadByPostId: async () =>
      ({ ok: true, value: createTestThread() }) as Result<Thread | null, string>,
    getTweetsByThread: async () => ({ ok: true, value: [] }) as Result<Tweet[], string>,
    createTweet: async () => ({ ok: true, value: createTestTweet() }) as Result<Tweet, string>,
    updateTweet: async () => ({ ok: true, value: createTestTweet() }) as Result<Tweet, string>,
  };
}

export function createMockProvider(): PublishProvider {
  return {
    publish: async () =>
      ({
        ok: true,
        value: createTestPublishReceipt(),
      }) as Result<PublishReceipt, PublishError>,
    publishThread: async () =>
      ({
        ok: true,
        value: createTestThreadReceipt(),
      }) as Result<ThreadReceipt, ThreadPublishFailure>,
    render: () =>
      ({
        ok: true,
        value: {
          type: "single" as const,
          content: createTestRenderedPost(),
        },
      }) as Result<RenderedContent, RenderError>,
  };
}

export function createMockInstrumentation(): PublishInstrumentation {
  return {
    instrumentPublishing: async (
      _name: string,
      _provider: string,
      _channelId: string,
      _type: string,
      fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>,
      _metadata?: Record<string, string>
    ) => {
      return await fn({ setAttributes: () => {} });
    },
    instrumentProviderAPI: async (
      _provider: string,
      _operation: string,
      _method: string,
      fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>
    ) => {
      return await fn({ setAttributes: () => {} });
    },
  };
}

export function createMockDatabaseInstrumentation(): DatabaseInstrumentation {
  return {
    instrumentQuery: async (_operation: string, _table: string, fn: () => Promise<unknown>) => {
      return await fn();
    },
  };
}

export function createMockBusinessKPITracker(): BusinessKPITracker {
  return {
    trackContentPublication: () => {},
  };
}

export function createSilentLogger(): pino.Logger {
  return pino({ level: "silent" });
}

/**
 * Creates a fresh WorkerMetrics instance with an isolated registry.
 * Each test gets its own registry to avoid metric name collisions.
 */
export function createTestWorkerMetrics(): WorkerMetrics {
  const registry = new client.Registry();
  return new WorkerMetrics(registry);
}

/**
 * Creates a provider registry with the mock provider registered under "x".
 * Tests that need to override individual provider methods can do so via
 * `deps.providerRegistry.x`.
 */
export function createMockProviderRegistry(): Record<string, PublishProvider> {
  return {
    x: createMockProvider(),
  };
}

/** The content of `createTestPost()`, fingerprinted the way the handler fingerprints it. */
export const TEST_CONTENT_HASH = ContentFingerprint.ofContent({
  body: createTestPost().body,
  mediaIds: (createTestPost().media ?? []).map((item) => item.id),
}).value;

/** The job identity every attempt in these suites is recorded under. */
export const TEST_ATTEMPT: PublicationAttemptContext = {
  accountId: "account-test",
  episode: 1,
  attemptNo: 1,
  contentHash: TEST_CONTENT_HASH,
};

/**
 * @function outcomeOfKind
 * @description Builds a real `PublicationOutcome` of the requested kind. The handler
 *   decides whether to let the queue retry from this value, so a cast would let a
 *   shape the aggregate can never produce drive that decision.
 * @param kind - Which settled state the recorder should report.
 * @returns The outcome value.
 */
export function outcomeOfKind(kind: PublicationOutcomeKind): PublicationOutcome {
  if (kind === PUBLICATION_OUTCOME_KINDS.PUBLISHED) {
    const head = providedReference("x-post-12345");
    const fragment = FragmentReference.create({ index: 1, externalId: "x-post-12345" });
    if (!head.ok || !fragment.ok) {
      throw new Error("the published outcome fixture is not constructible");
    }
    return {
      kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
      head: head.value,
      fragments: [fragment.value],
      publishedAt: NOW,
      contentHash: ContentFingerprint.ofContent({ body: "Test post body", mediaIds: [] }),
    };
  }
  if (kind === PUBLICATION_OUTCOME_KINDS.EXCLUDED) {
    const reason = ExclusionReason.create({ code: "THREAD_INTERRUPTED" });
    if (!reason.ok) {
      throw new Error("the excluded outcome fixture is not constructible");
    }
    return {
      kind: PUBLICATION_OUTCOME_KINDS.EXCLUDED,
      reason: reason.value,
      excludedAt: NOW,
      retraction: { pending: false },
    };
  }
  return { kind: PUBLICATION_OUTCOME_KINDS.UNRESOLVED };
}

/**
 * @function settledKindOf
 * @description Which state `ChannelPublication.recordAttempt` reaches from one receipt
 *   on a channel whose episode was just opened. The branches are the aggregate's own,
 *   in its own order: live fragments strand before a named cause excludes, and BOTH a
 *   transient and an unclassifiable failure keep the channel unresolved while the
 *   ordinal is still inside the budget.
 *
 *   `outcomeDoubleContract.test.ts` pins every branch of this against the real
 *   aggregate, because a double that quietly disagrees with the thing it doubles makes
 *   a suite report green over a handler that behaves differently in production.
 * @param receipt - The receipt the handler would hand the recorder.
 * @returns The outcome kind the aggregate settles on.
 */
export function settledKindOf(receipt: PublishOutcomeReceipt): PublicationOutcomeKind {
  if (receipt.result.kind === "published") {
    return PUBLICATION_OUTCOME_KINDS.PUBLISHED;
  }
  if (receipt.result.publishedFragments.length > 0) {
    return PUBLICATION_OUTCOME_KINDS.EXCLUDED;
  }
  if (receipt.result.classification === ATTEMPT_CLASSIFICATIONS.NONTRANSIENT) {
    return PUBLICATION_OUTCOME_KINDS.EXCLUDED;
  }
  return receipt.attemptNo >= CHANNEL_ATTEMPT_BUDGET
    ? PUBLICATION_OUTCOME_KINDS.EXCLUDED
    : PUBLICATION_OUTCOME_KINDS.UNRESOLVED;
}

/** The post word that accompanies a single channel reaching each state. */
function statusOfKind(
  kind: PublicationOutcomeKind
): RecordChannelPublicationAttemptOutput["status"] {
  if (kind === PUBLICATION_OUTCOME_KINDS.PUBLISHED) return "PUBLISHED";
  return kind === PUBLICATION_OUTCOME_KINDS.EXCLUDED ? "FAILED" : "PUBLISHING";
}

/**
 * A recorder that keeps every receipt and answers whatever the scenario installed.
 *
 * It never throws, because the real one never does: a recorder that rejected would
 * reach the handler's outer catch, and a suite whose double could reject would keep
 * passing over a handler that re-sends live content.
 */
export class RecordingOutcomeRecorder implements PublishOutcomeRecorder {
  readonly receipts: PublishOutcomeReceipt[] = [];
  readonly durableJobs: Record<string, unknown>[] = [];

  /**
   * Replaced per scenario to answer a settled outcome or an unrecorded one. The
   * default is `settledKindOf`, which is pinned branch by branch against the real
   * aggregate, because the handler's retry decision reads this value and a double
   * that always settled would hide a handler that stopped retrying a rate limit.
   */
  answer: (
    receipt: PublishOutcomeReceipt
  ) => Result<RecordChannelPublicationAttemptOutput, PublishOutcomeUnrecorded> = (receipt) =>
    ok({
      postId: receipt.postId,
      projectId: "project-001",
      channelId: receipt.channelId,
      applied: true,
      outcome: outcomeOfKind(settledKindOf(receipt)),
      status: statusOfKind(settledKindOf(receipt)),
    });

  async record(receipt: PublishOutcomeReceipt) {
    this.receipts.push(receipt);
    return this.answer(receipt);
  }

  async applyDurableJob(payload: Record<string, unknown>): Promise<void> {
    this.durableJobs.push(payload);
  }

  async reportFailedJob(): Promise<void> {}
}

/** A probe that answers one state for every channel, or whatever the scenario installs. */
export class StubPublicationRecordProbe implements PublicationRecordProbe {
  readonly reads: Array<{ postId: string; channelId: string; accountId: string }> = [];

  answer: () => Result<ChannelRecordState | undefined, string> = () =>
    ok({ episode: TEST_ATTEMPT.episode, outcome: PUBLICATION_OUTCOME_KINDS.UNRESOLVED });

  async readChannel(input: { postId: string; channelId: string; accountId: string }) {
    this.reads.push(input);
    return this.answer();
  }
}

/**
 * Creates a complete set of mock dependencies for PublishHandler.
 */
export function createTestDeps(overrides?: Partial<PublishHandlerDeps>): PublishHandlerDeps {
  return {
    repo: createMockRepo(),
    providerRegistry: createMockProviderRegistry(),
    credentialResolver: {
      resolve: async () => ({ ok: true, value: { accessToken: "test-token" } }),
    },
    workerMetrics: createTestWorkerMetrics(),
    logger: createSilentLogger(),
    instrumentation: createMockInstrumentation(),
    databaseInstrumentation: createMockDatabaseInstrumentation(),
    businessKPITracker: createMockBusinessKPITracker(),
    outcomeRecorder: new RecordingOutcomeRecorder(),
    publicationRecord: new StubPublicationRecordProbe(),
    ...overrides,
  };
}
