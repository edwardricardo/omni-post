/**
 * @file RepoPort.ts
 * @description Repository port (interface) for persistence operations across accounts, posts,
 *              channels, publish logs, threads, tweets, and analytics.
 * @layer domain
 */
import type {
  CanonicalPost,
  Result,
  Media,
  Account,
  CreateAccountInput,
  UpdateAccountInput,
  Thread,
  Tweet,
  ThreadStrategy,
  TweetStatus,
} from "@shared/types";
import type { ProviderId } from "./ProviderAdapter.js";

export type PublishLog = {
  id: string;
  postId: string | null;
  provider: ProviderId;
  channelId: string;
  status: "QUEUED" | "RUNNING" | "OK" | "ERR";
  payload: Record<string, unknown>;
  dedupeKey: string;
  createdAt: Date;
};

export type Channel = {
  id: string;
  projectId: string;
  provider: ProviderId;
  handle: string;
  credentials: Record<string, unknown>;
};

export type LogPublishInput = {
  postId: string;
  provider: ProviderId;
  channelId: string;
  status: "QUEUED" | "RUNNING" | "OK" | "ERR";
  payload: Record<string, unknown>;
  dedupeKey: string;
};

export type ListLogsQuery = {
  postId?: string;
  channelId?: string;
  provider?: ProviderId;
  status?: "QUEUED" | "RUNNING" | "OK" | "ERR";
  limit?: number;
  offset?: number;
};

export type CreatePostInput = {
  projectId: string;
  locale: "es" | "en";
  title?: string;
  summary?: string;
  body: string;
  tags?: string[];
  media?: Media[];
  scheduledAt?: Date;
};

export type ListPostsQuery = {
  projectId?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

export type PostsPage = {
  posts: CanonicalPost[];
  total: number;
  limit: number;
  offset: number;
};

export type Analytics = {
  id: string;
  postId: string | null;
  channelId: string;
  provider: ProviderId;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  capturedAt: Date;
};

export type AnalyticsQuery = {
  postId?: string;
  channelId?: string;
  provider?: ProviderId;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
};

export type AnalyticsInput = {
  postId?: string;
  channelId: string;
  provider: ProviderId;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};

// Threading types
export type CreateThreadInput = {
  postId: string;
  strategy: ThreadStrategy;
};

export type CreateTweetInput = {
  threadId: string;
  sequenceNumber: number;
  content: string;
  media?: Media[];
};

export type UpdateTweetInput = {
  tweetId?: string; // X's tweet ID after publishing
  parentTweetId?: string; // X's parent tweet ID for threading
  status: TweetStatus;
  publishedAt?: Date;
};

export interface RepoPort {
  // Account management methods
  /** Persist a new account. Returns `EMAIL_TAKEN` when the email is already in use. */
  createAccount(
    input: CreateAccountInput
  ): Promise<Result<Account, "EMAIL_TAKEN" | "DATABASE_ERROR">>;
  /** Load an account by primary key. `NOT_FOUND` if absent. */
  getAccountById(id: string): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">>;
  /** Load an account by unique email. `NOT_FOUND` if no match. */
  getAccountByEmail(email: string): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">>;
  /** Patch mutable fields on an account. `NOT_FOUND` if the id is unknown. */
  updateAccount(
    id: string,
    input: UpdateAccountInput
  ): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">>;
  /** Delete an account by id. Cascades to projects per the schema. */
  deleteAccount(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">>;
  /** Return every account. Admin-only use; production callers should paginate via a query port. */
  listAccounts(): Promise<Result<Account[], "DATABASE_ERROR">>;

  // Project management methods (now account-aware)
  /**
   * Create a project under an account. Enforces per-plan quotas
   * (`QUOTA_EXCEEDED`) and unique project name per account (`NAME_TAKEN`).
   */
  createProject(
    accountId: string,
    input: Omit<CreatePostInput, "projectId"> & { name: string }
  ): Promise<
    Result<
      { id: string; name: string; accountId: string },
      "QUOTA_EXCEEDED" | "NAME_TAKEN" | "ACCOUNT_NOT_FOUND" | "DATABASE_ERROR"
    >
  >;
  /** List every project owned by an account, ordered by creation time. */
  getProjectsByAccount(
    accountId: string
  ): Promise<
    Result<
      Array<{ id: string; name: string; accountId: string; createdAt: Date }>,
      "DATABASE_ERROR"
    >
  >;
  /** Delete a project by id. Cascades to posts, channels, and analytics. */
  deleteProject(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">>;

  /** Load a single canonical post by id. */
  getPostById(id: string): Promise<Result<CanonicalPost, "NOT_FOUND" | "DATABASE_ERROR">>;
  /**
   * Batch-fetch channels by id, scoped to the owning tenant. Missing ids and
   * channels owned by a different `accountId` are silently dropped from the
   * result — the explicit `accountId` predicate is the worker's active tenant
   * isolation layer (D9), independent of RLS.
   */
  getChannelsByIds(ids: string[], accountId: string): Promise<Result<Channel[], "DATABASE_ERROR">>;
  /**
   * Owner lookup for the deploy-compat publish fallback: returns the channel's
   * `accountId` column ONLY, never decrypting credentials, and `ok(null)` when
   * the channel does not exist. Remove together with the D2 legacy-payload
   * fallback once every enqueued publish job carries its `accountId`.
   */
  getChannelOwnerAccountId(channelId: string): Promise<Result<string | null, "DATABASE_ERROR">>;
  /**
   * Append a publish-log entry. `dedupeKey` MUST be deterministic so the
   * outbox + saga can rely on idempotent retries.
   */
  logPublish(input: LogPublishInput): Promise<Result<PublishLog, "DATABASE_ERROR">>;
  /**
   * Look up an existing log entry by its dedupe key. Returns ok(null) when
   * no entry exists yet — callers use this to short-circuit duplicate
   * publishes before enqueueing.
   */
  getLogByDedupeKey(dedupeKey: string): Promise<Result<PublishLog | null, "DATABASE_ERROR">>;
  /** Query publish logs by post/channel/provider/status with pagination. */
  listLogs(query: ListLogsQuery): Promise<Result<PublishLog[], "DATABASE_ERROR">>;

  // Post management methods
  /** Persist a new canonical post. */
  createPost(input: CreatePostInput): Promise<Result<CanonicalPost, "DATABASE_ERROR">>;
  /** Paginated post listing scoped to a project. */
  listPosts(query: ListPostsQuery): Promise<Result<PostsPage, "DATABASE_ERROR">>;
  /** Attach a media object to a post. `NOT_FOUND` if the post id is unknown. */
  addMediaToPost(
    postId: string,
    media: Media
  ): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">>;

  // Analytics methods
  /** Paginated analytics records filtered by post/channel/provider/time window. */
  listAnalytics(query: AnalyticsQuery): Promise<Result<Analytics[], "DATABASE_ERROR">>;
  /** Append a new analytics snapshot. Idempotency is the caller's responsibility. */
  addAnalytics(input: AnalyticsInput): Promise<Result<Analytics, "DATABASE_ERROR">>;

  // Thread management methods
  /**
   * Create a Twitter/X thread for a post. `THREAD_EXISTS` when a thread is
   * already attached to the post (1:1 relation).
   */
  createThread(
    input: CreateThreadInput
  ): Promise<Result<Thread, "POST_NOT_FOUND" | "THREAD_EXISTS" | "DATABASE_ERROR">>;
  /** Look up the thread attached to a post; ok(null) if none exists. */
  getThreadByPostId(postId: string): Promise<Result<Thread | null, "DATABASE_ERROR">>;
  /** Load a thread by id. */
  getThreadById(threadId: string): Promise<Result<Thread, "NOT_FOUND" | "DATABASE_ERROR">>;
  /** Delete a thread and its tweets. */
  deleteThread(threadId: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">>;

  // Tweet management methods
  /**
   * Add a tweet to a thread at `sequenceNumber`. `SEQUENCE_EXISTS` when a
   * tweet already occupies that position (sequence is unique per thread).
   */
  createTweet(
    input: CreateTweetInput
  ): Promise<Result<Tweet, "THREAD_NOT_FOUND" | "SEQUENCE_EXISTS" | "DATABASE_ERROR">>;
  /** Patch a tweet's status, provider id, or parent linkage after publishing. */
  updateTweet(
    tweetId: string,
    input: UpdateTweetInput
  ): Promise<Result<Tweet, "NOT_FOUND" | "DATABASE_ERROR">>;
  /** Return every tweet in a thread, ordered by `sequenceNumber`. */
  getTweetsByThread(threadId: string): Promise<Result<Tweet[], "DATABASE_ERROR">>;
  /** Load a single tweet by id. */
  getTweetById(tweetId: string): Promise<Result<Tweet, "NOT_FOUND" | "DATABASE_ERROR">>;
}
