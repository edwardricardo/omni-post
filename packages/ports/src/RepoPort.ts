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
  createAccount(
    input: CreateAccountInput
  ): Promise<Result<Account, "EMAIL_TAKEN" | "DATABASE_ERROR">>;
  getAccountById(id: string): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">>;
  getAccountByEmail(email: string): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">>;
  updateAccount(
    id: string,
    input: UpdateAccountInput
  ): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">>;
  deleteAccount(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">>;
  listAccounts(): Promise<Result<Account[], "DATABASE_ERROR">>;

  // Project management methods (now account-aware)
  createProject(
    accountId: string,
    input: Omit<CreatePostInput, "projectId"> & { name: string }
  ): Promise<
    Result<
      { id: string; name: string; accountId: string },
      "QUOTA_EXCEEDED" | "NAME_TAKEN" | "ACCOUNT_NOT_FOUND" | "DATABASE_ERROR"
    >
  >;
  getProjectsByAccount(
    accountId: string
  ): Promise<
    Result<
      Array<{ id: string; name: string; accountId: string; createdAt: Date }>,
      "DATABASE_ERROR"
    >
  >;
  deleteProject(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">>;

  getPostById(id: string): Promise<Result<CanonicalPost, "NOT_FOUND" | "DATABASE_ERROR">>;
  getChannelsByIds(ids: string[]): Promise<Result<Channel[], "DATABASE_ERROR">>;
  logPublish(input: LogPublishInput): Promise<Result<PublishLog, "DATABASE_ERROR">>;
  getLogByDedupeKey(dedupeKey: string): Promise<Result<PublishLog | null, "DATABASE_ERROR">>;
  listLogs(query: ListLogsQuery): Promise<Result<PublishLog[], "DATABASE_ERROR">>;

  // Post management methods
  createPost(input: CreatePostInput): Promise<Result<CanonicalPost, "DATABASE_ERROR">>;
  listPosts(query: ListPostsQuery): Promise<Result<PostsPage, "DATABASE_ERROR">>;
  addMediaToPost(
    postId: string,
    media: Media
  ): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">>;

  // Analytics methods
  listAnalytics(query: AnalyticsQuery): Promise<Result<Analytics[], "DATABASE_ERROR">>;
  addAnalytics(input: AnalyticsInput): Promise<Result<Analytics, "DATABASE_ERROR">>;

  // Thread management methods
  createThread(
    input: CreateThreadInput
  ): Promise<Result<Thread, "POST_NOT_FOUND" | "THREAD_EXISTS" | "DATABASE_ERROR">>;
  getThreadByPostId(postId: string): Promise<Result<Thread | null, "DATABASE_ERROR">>;
  getThreadById(threadId: string): Promise<Result<Thread, "NOT_FOUND" | "DATABASE_ERROR">>;
  deleteThread(threadId: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">>;

  // Tweet management methods
  createTweet(
    input: CreateTweetInput
  ): Promise<Result<Tweet, "THREAD_NOT_FOUND" | "SEQUENCE_EXISTS" | "DATABASE_ERROR">>;
  updateTweet(
    tweetId: string,
    input: UpdateTweetInput
  ): Promise<Result<Tweet, "NOT_FOUND" | "DATABASE_ERROR">>;
  getTweetsByThread(threadId: string): Promise<Result<Tweet[], "DATABASE_ERROR">>;
  getTweetById(tweetId: string): Promise<Result<Tweet, "NOT_FOUND" | "DATABASE_ERROR">>;
}
