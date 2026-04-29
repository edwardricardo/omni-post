/**
 * @file client.ts
 * @description Facade for the client app's API surface. Composes 9 per-domain
 *              clients (Health, Projects, Posts, Providers, Channels,
 *              Analytics, Publishing, Uploads, AI) and exposes a single
 *              `apiClient` instance that preserves the legacy flat method
 *              shape — callers continue to call `apiClient.getPosts()`
 *              without knowing the underlying split. All requests route
 *              through the Next.js proxy (`/api/backend`) so authentication
 *              is handled via httpOnly cookies — no tokens in browser storage.
 * @layer infrastructure
 */

import type {
  Analytics,
  ApiResponse,
  Channel,
  CreatePostRequest,
  CrossPlatformAnalyticsData,
  HealthResponse,
  PaginatedResponse,
  Post,
  Project,
  UpdatePostRequest,
} from "./types";

import { AccountsClient } from "./clients/accountsClient";
import { AiClient } from "./clients/aiClient";
import {
  type ContentAnalysis,
  type GenerateContentOptions,
  type GeneratedContent,
  type OptimizedContent,
} from "./clients/aiClient";
import {
  AnalyticsClient,
  type BestPostingTimesParams,
  type ChannelAnalyticsParams,
  type ContentPerformanceParams,
  type CrossPlatformAnalyticsParams,
  type PostAnalyticsParams,
} from "./clients/analyticsClient";
import {
  ChannelsClient,
  type CreateChannelInput,
  type UpdateChannelInput,
} from "./clients/channelsClient";
import { HealthClient } from "./clients/healthClient";
import {
  type AddPostMediaInput,
  PostsClient,
  type ListPostsParams,
  type ThreadingStrategy,
} from "./clients/postsClient";
import { ProjectsClient } from "./clients/projectsClient";
import {
  ProvidersClient,
  type ProviderEnvelope,
  type ProviderHealthEnvelope,
  type ProvidersHealthResponse,
  type ProvidersListResponse,
} from "./clients/providersClient";
import { PublishingClient, type PublishOptions } from "./clients/publishingClient";
import { PROXY_BASE } from "./clients/request";
import { UploadsClient, type UploadResult, type UploadType } from "./clients/uploadsClient";

/**
 * @class ApiClient
 * @description Facade that composes per-domain HTTP clients and re-exposes
 *              their methods as a flat surface. Stateless — each method
 *              builds a fresh `fetch` request through the proxy. Constructed
 *              once and exported as the `apiClient` singleton.
 */
class ApiClient {
  private readonly health: HealthClient;
  private readonly accounts: AccountsClient;
  private readonly projects: ProjectsClient;
  private readonly posts: PostsClient;
  private readonly providers: ProvidersClient;
  private readonly channels: ChannelsClient;
  private readonly analytics: AnalyticsClient;
  private readonly publishing: PublishingClient;
  private readonly uploads: UploadsClient;
  private readonly ai: AiClient;

  constructor(baseUrl: string = PROXY_BASE) {
    this.health = new HealthClient(baseUrl);
    this.accounts = new AccountsClient(baseUrl);
    this.projects = new ProjectsClient(baseUrl);
    this.posts = new PostsClient(baseUrl);
    this.providers = new ProvidersClient(baseUrl);
    this.channels = new ChannelsClient(baseUrl);
    this.analytics = new AnalyticsClient(baseUrl);
    this.publishing = new PublishingClient(baseUrl);
    this.uploads = new UploadsClient(baseUrl);
    this.ai = new AiClient(baseUrl);
  }

  // Health
  getHealth(): Promise<HealthResponse> {
    return this.health.getHealth();
  }

  // Accounts
  getAccountProjects(accountId: string): Promise<Project[]> {
    return this.accounts.getAccountProjects(accountId);
  }

  // Projects
  getProjects(): Promise<PaginatedResponse<Project>> {
    return this.projects.getProjects();
  }

  getProject(id: string): Promise<ApiResponse<Project>> {
    return this.projects.getProject(id);
  }

  createProject(data: { name: string; description?: string }): Promise<ApiResponse<Project>> {
    return this.projects.createProject(data);
  }

  // Posts
  getPosts(params?: ListPostsParams): Promise<PaginatedResponse<Post>> {
    return this.posts.getPosts(params);
  }

  getPost(id: string): Promise<ApiResponse<Post>> {
    return this.posts.getPost(id);
  }

  createPost(data: CreatePostRequest): Promise<ApiResponse<Post>> {
    return this.posts.createPost(data);
  }

  updatePost(id: string, data: UpdatePostRequest): Promise<ApiResponse<Post>> {
    return this.posts.updatePost(id, data);
  }

  deletePost(id: string): Promise<ApiResponse<void>> {
    return this.posts.deletePost(id);
  }

  addPostMedia(postId: string, media: AddPostMediaInput): Promise<ApiResponse<unknown>> {
    return this.posts.addPostMedia(postId, media);
  }

  createPostThread(
    postId: string,
    strategy: ThreadingStrategy = "AUTO"
  ): Promise<ApiResponse<unknown>> {
    return this.posts.createPostThread(postId, strategy);
  }

  getPostThread(postId: string): Promise<ApiResponse<unknown>> {
    return this.posts.getPostThread(postId);
  }

  // Providers
  getProviders(): Promise<ProvidersListResponse> {
    return this.providers.getProviders();
  }

  getActiveProviders(): Promise<ProvidersListResponse> {
    return this.providers.getActiveProviders();
  }

  getProviderById(id: string): Promise<ProviderEnvelope> {
    return this.providers.getProviderById(id);
  }

  getProviderHealth(id: string): Promise<ProviderHealthEnvelope> {
    return this.providers.getProviderHealth(id);
  }

  getAllProvidersHealth(): Promise<ProvidersHealthResponse> {
    return this.providers.getAllProvidersHealth();
  }

  // Channels
  getChannels(providerId?: string): Promise<PaginatedResponse<Channel>> {
    return this.channels.getChannels(providerId);
  }

  getChannel(id: string): Promise<ApiResponse<Channel>> {
    return this.channels.getChannel(id);
  }

  createChannel(data: CreateChannelInput): Promise<ApiResponse<Channel>> {
    return this.channels.createChannel(data);
  }

  updateChannel(id: string, data: UpdateChannelInput): Promise<ApiResponse<Channel>> {
    return this.channels.updateChannel(id, data);
  }

  deleteChannel(id: string): Promise<ApiResponse<void>> {
    return this.channels.deleteChannel(id);
  }

  // Analytics
  getPostAnalytics(
    postId: string,
    params?: PostAnalyticsParams
  ): Promise<ApiResponse<Analytics[]>> {
    return this.analytics.getPostAnalytics(postId, params);
  }

  getChannelAnalytics(
    channelId: string,
    params?: ChannelAnalyticsParams
  ): Promise<ApiResponse<Analytics[]>> {
    return this.analytics.getChannelAnalytics(channelId, params);
  }

  getBestPostingTimes(params?: BestPostingTimesParams): Promise<ApiResponse<unknown>> {
    return this.analytics.getBestPostingTimes(params);
  }

  getContentPerformance(params?: ContentPerformanceParams): Promise<ApiResponse<unknown>> {
    return this.analytics.getContentPerformance(params);
  }

  getCrossPlatformAnalytics(
    params: CrossPlatformAnalyticsParams
  ): Promise<ApiResponse<CrossPlatformAnalyticsData>> {
    return this.analytics.getCrossPlatformAnalytics(params);
  }

  // Publishing
  publishPost(postId: string, options?: PublishOptions): Promise<ApiResponse<unknown>> {
    return this.publishing.publishPost(postId, options);
  }

  schedulePost(
    postId: string,
    scheduledAt: string,
    channelIds?: string[]
  ): Promise<ApiResponse<unknown>> {
    return this.publishing.schedulePost(postId, scheduledAt, channelIds);
  }

  cancelScheduledPost(postId: string): Promise<ApiResponse<unknown>> {
    return this.publishing.cancelScheduledPost(postId);
  }

  // Uploads
  uploadFile(file: File, type: UploadType = "image"): Promise<ApiResponse<UploadResult>> {
    return this.uploads.uploadFile(file, type);
  }

  // AI
  generateContent(
    prompt: string,
    options?: GenerateContentOptions
  ): Promise<ApiResponse<GeneratedContent>> {
    return this.ai.generateContent(prompt, options);
  }

  optimizeContent(content: string, platform?: string): Promise<ApiResponse<OptimizedContent>> {
    return this.ai.optimizeContent(content, platform);
  }

  analyzeContent(content: string): Promise<ApiResponse<ContentAnalysis>> {
    return this.ai.analyzeContent(content);
  }
}

export const apiClient = new ApiClient();
