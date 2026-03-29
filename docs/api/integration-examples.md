# API Integration Examples and Developer Guide

## Overview

This guide provides comprehensive examples and best practices for integrating with our Phase 2 social media CMS API. It covers authentication, CQRS patterns, saga workflows, and advanced features like caching and real-time updates.

## Authentication and Setup

### API Authentication

All API requests require authentication using JWT tokens:

```typescript
// Authentication setup
const API_BASE_URL = "https://api.your-domain.com";

class ApiClient {
  private token: string | null = null;
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  async authenticate(email: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${this.baseURL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.statusText}`);
    }

    const data = await response.json();
    this.token = data.token;

    return data;
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}

// Usage
const client = new ApiClient();

try {
  await client.authenticate("user@example.com", "password");
  console.log("Authenticated successfully");
} catch (error) {
  console.error("Authentication failed:", error);
}
```

### Environment Configuration

```typescript
// environment.ts
interface Environment {
  apiUrl: string;
  wsUrl: string;
  environment: "development" | "staging" | "production";
  features: {
    realTimeUpdates: boolean;
    advancedAnalytics: boolean;
    sagaOrchestration: boolean;
  };
}

export const environment: Environment = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3000",
  environment: (process.env.NODE_ENV as any) || "development",
  features: {
    realTimeUpdates: process.env.NEXT_PUBLIC_REAL_TIME_UPDATES === "true",
    advancedAnalytics: process.env.NEXT_PUBLIC_ADVANCED_ANALYTICS === "true",
    sagaOrchestration: process.env.NEXT_PUBLIC_SAGA_ORCHESTRATION === "true",
  },
};
```

## CQRS API Patterns

### Command Operations (Write)

Commands modify system state and return success/failure information:

```typescript
// Post creation command
interface CreatePostCommand {
  aggregateId: string;
  aggregateType: "Post";
  type: "post.create";
  data: {
    title: string;
    content: string;
    channelIds: string[];
    scheduledAt?: Date;
    tags?: string[];
    media?: MediaAttachment[];
  };
  metadata: {
    userId: string;
    correlationId: string;
    source: string;
  };
}

interface CommandResult {
  success: boolean;
  aggregateId: string;
  version: number;
  events?: number;
  error?: string;
}

// Example: Create a new post
async function createPost(client: ApiClient, postData: CreatePostData): Promise<CommandResult> {
  const command: CreatePostCommand = {
    aggregateId: `post-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    aggregateType: "Post",
    type: "post.create",
    data: {
      title: postData.title,
      content: postData.content,
      channelIds: postData.channelIds,
      scheduledAt: postData.scheduledAt,
      tags: postData.tags,
      media: postData.media,
    },
    metadata: {
      userId: postData.userId,
      correlationId: `corr-${Date.now()}`,
      source: "WebApp",
    },
  };

  try {
    const result = await client.request<CommandResult>("/api/commands/posts", {
      method: "POST",
      body: JSON.stringify(command),
    });

    console.log("Post created successfully:", result);
    return result;
  } catch (error) {
    console.error("Failed to create post:", error);
    throw error;
  }
}

// Example: Update post status
async function updatePostStatus(
  client: ApiClient,
  postId: string,
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED"
): Promise<CommandResult> {
  const command = {
    aggregateId: postId,
    aggregateType: "Post",
    type: "post.updateStatus",
    data: { status },
    metadata: {
      userId: "current-user-id",
      correlationId: `corr-${Date.now()}`,
      source: "StatusUpdate",
    },
  };

  return client.request<CommandResult>("/api/commands/posts/status", {
    method: "PUT",
    body: JSON.stringify(command),
  });
}

// Example: Delete post
async function deletePost(client: ApiClient, postId: string): Promise<CommandResult> {
  const command = {
    aggregateId: postId,
    aggregateType: "Post",
    type: "post.delete",
    data: { reason: "user-requested" },
    metadata: {
      userId: "current-user-id",
      correlationId: `corr-${Date.now()}`,
      source: "UserAction",
    },
  };

  return client.request<CommandResult>(`/api/commands/posts/${postId}`, {
    method: "DELETE",
    body: JSON.stringify(command),
  });
}
```

### Query Operations (Read)

Queries retrieve data without modifying system state:

```typescript
interface QueryResult<T> {
  success: boolean;
  data: T;
  fromCache?: boolean;
  metadata?: {
    totalCount?: number;
    page?: number;
    limit?: number;
    cacheKey?: string;
  };
}

// Example: Get posts by project
interface GetPostsByProjectQuery {
  type: "posts.getByProject";
  projectId: string;
  filters?: {
    status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
    dateRange?: {
      from: Date;
      to: Date;
    };
    search?: string;
    tags?: string[];
  };
  pagination?: {
    page: number;
    limit: number;
  };
  sort?: {
    field: "createdAt" | "updatedAt" | "publishedAt" | "title";
    direction: "ASC" | "DESC";
  };
}

async function getProjectPosts(
  client: ApiClient,
  projectId: string,
  options: GetPostsOptions = {}
): Promise<QueryResult<PostSummary[]>> {
  const query = new URLSearchParams({
    projectId,
    ...(options.status && { status: options.status }),
    ...(options.search && { search: options.search }),
    ...(options.page && { page: options.page.toString() }),
    ...(options.limit && { limit: options.limit.toString() }),
    ...(options.sortField && { sortField: options.sortField }),
    ...(options.sortDirection && { sortDirection: options.sortDirection }),
  });

  if (options.tags?.length) {
    options.tags.forEach((tag) => query.append("tags", tag));
  }

  return client.request<QueryResult<PostSummary[]>>(
    `/api/queries/projects/${projectId}/posts?${query}`
  );
}

// Example: Get post details
async function getPostDetails(
  client: ApiClient,
  postId: string
): Promise<QueryResult<PostDetails>> {
  return client.request<QueryResult<PostDetails>>(`/api/queries/posts/${postId}`);
}

// Example: Get dashboard analytics
async function getDashboardAnalytics(
  client: ApiClient,
  projectId: string,
  timeRange: "7d" | "30d" | "90d" = "30d"
): Promise<QueryResult<DashboardAnalytics>> {
  return client.request<QueryResult<DashboardAnalytics>>(
    `/api/queries/projects/${projectId}/analytics?timeRange=${timeRange}`
  );
}
```

## Saga Workflow Integration

### Starting a Saga

Use sagas for complex, multi-step operations:

```typescript
interface SagaStartRequest {
  definitionId: string;
  context: {
    correlationId?: string;
    userId: string;
    metadata: Record<string, unknown>;
  };
  data?: unknown;
}

interface SagaStartResponse {
  sagaId: string;
  status: "PENDING" | "RUNNING";
  startedAt: Date;
}

// Example: Start post publishing saga
async function startPostPublishingSaga(
  client: ApiClient,
  postData: PostPublishingData
): Promise<SagaStartResponse> {
  const request: SagaStartRequest = {
    definitionId: "post-publishing-saga",
    context: {
      correlationId: `pub-${Date.now()}`,
      userId: postData.userId,
      metadata: {
        postData: {
          title: postData.title,
          content: postData.content,
          channelIds: postData.channelIds,
          scheduledAt: postData.scheduledAt,
        },
        priority: postData.priority || "NORMAL",
        source: "WebApp",
      },
    },
  };

  try {
    const response = await client.request<SagaStartResponse>("/api/sagas/start", {
      method: "POST",
      body: JSON.stringify(request),
    });

    console.log("Saga started:", response);
    return response;
  } catch (error) {
    console.error("Failed to start saga:", error);
    throw error;
  }
}

// Example: Monitor saga progress
async function monitorSaga(client: ApiClient, sagaId: string): Promise<SagaInstance> {
  return client.request<SagaInstance>(`/api/sagas/${sagaId}`);
}

// Complete workflow example
async function publishPostWithSaga(
  client: ApiClient,
  postData: PostPublishingData
): Promise<string> {
  // Start the publishing saga
  const sagaResponse = await startPostPublishingSaga(client, postData);

  // Monitor progress
  const checkProgress = async (): Promise<string> => {
    const saga = await monitorSaga(client, sagaResponse.sagaId);

    switch (saga.status) {
      case "COMPLETED":
        console.log("Post published successfully");
        return "SUCCESS";

      case "FAILED":
      case "COMPENSATED":
        console.error("Post publishing failed:", saga.error);
        throw new Error(`Publishing failed: ${saga.error}`);

      case "RUNNING":
      case "PENDING":
        // Still in progress, check again
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return checkProgress();

      default:
        throw new Error(`Unknown saga status: ${saga.status}`);
    }
  };

  return checkProgress();
}
```

## Real-Time Updates with WebSockets

### WebSocket Connection

```typescript
interface WebSocketMessage {
  type: string;
  data: unknown;
  timestamp: Date;
  correlationId?: string;
}

interface WebSocketSubscription {
  topics: string[];
  filters?: Record<string, unknown>;
}

class RealtimeClient {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, (data: unknown) => void>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(
    private wsUrl: string,
    private token: string
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${this.wsUrl}?token=${this.token}`);

        this.ws.onopen = () => {
          console.log("WebSocket connected");
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        };

        this.ws.onclose = () => {
          console.log("WebSocket disconnected");
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  subscribe(topic: string, callback: (data: unknown) => void): () => void {
    // Subscribe to topic
    this.subscriptions.set(topic, callback);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "subscribe",
          topics: [topic],
        })
      );
    }

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(topic);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "unsubscribe",
            topics: [topic],
          })
        );
      }
    };
  }

  private handleMessage(message: WebSocketMessage): void {
    console.log("Received message:", message);

    // Route message to appropriate subscribers
    this.subscriptions.forEach((callback, topic) => {
      if (message.type.startsWith(topic)) {
        callback(message.data);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    const delay = Math.pow(2, this.reconnectAttempts) * 1000;
    console.log(`Reconnecting in ${delay}ms...`);

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(console.error);
    }, delay);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
  }
}

// Usage example
const realtimeClient = new RealtimeClient(environment.wsUrl, token);

await realtimeClient.connect();

// Subscribe to post updates
const unsubscribeFromPosts = realtimeClient.subscribe("posts.updated", (data) => {
  console.log("Post updated:", data);
  // Update UI with new data
});

// Subscribe to saga progress
const unsubscribeFromSagas = realtimeClient.subscribe("saga.progress", (data) => {
  console.log("Saga progress:", data);
  // Update progress indicators
});

// Clean up when done
// unsubscribeFromPosts();
// unsubscribeFromSagas();
// realtimeClient.disconnect();
```

## Advanced Integration Patterns

### Optimistic Updates

```typescript
interface OptimisticUpdate<T> {
  id: string;
  type: "CREATE" | "UPDATE" | "DELETE";
  data: T;
  timestamp: Date;
  pending: boolean;
  error?: string;
}

class OptimisticUpdateManager<T> {
  private updates = new Map<string, OptimisticUpdate<T>>();
  private callbacks = new Set<(updates: OptimisticUpdate<T>[]) => void>();

  constructor(private apiClient: ApiClient) {}

  async performOptimisticUpdate(
    id: string,
    type: OptimisticUpdate<T>["type"],
    data: T,
    apiCall: () => Promise<any>
  ): Promise<void> {
    // Apply optimistic update immediately
    const update: OptimisticUpdate<T> = {
      id,
      type,
      data,
      timestamp: new Date(),
      pending: true,
    };

    this.updates.set(id, update);
    this.notifyCallbacks();

    try {
      // Perform actual API call
      await apiCall();

      // Remove optimistic update on success
      this.updates.delete(id);
      this.notifyCallbacks();
    } catch (error) {
      // Mark as failed
      update.pending = false;
      update.error = error instanceof Error ? error.message : "Unknown error";
      this.notifyCallbacks();

      // Clean up failed update after delay
      setTimeout(() => {
        this.updates.delete(id);
        this.notifyCallbacks();
      }, 5000);

      throw error;
    }
  }

  subscribe(callback: (updates: OptimisticUpdate<T>[]) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  getUpdates(): OptimisticUpdate<T>[] {
    return Array.from(this.updates.values());
  }

  private notifyCallbacks(): void {
    const updates = this.getUpdates();
    this.callbacks.forEach((callback) => callback(updates));
  }
}

// Usage example
const optimisticManager = new OptimisticUpdateManager<PostSummary>(client);

// Subscribe to optimistic updates
optimisticManager.subscribe((updates) => {
  console.log("Optimistic updates:", updates);
  // Update UI with pending changes
});

// Perform optimistic post creation
async function createPostOptimistically(postData: CreatePostData) {
  const tempId = `temp-${Date.now()}`;
  const optimisticPost: PostSummary = {
    id: tempId,
    title: postData.title,
    status: "DRAFT",
    createdAt: new Date(),
    // ... other fields
  };

  await optimisticManager.performOptimisticUpdate(tempId, "CREATE", optimisticPost, () =>
    createPost(client, postData)
  );
}
```

### Batch Operations

```typescript
interface BatchRequest<T> {
  operations: T[];
  batchId?: string;
  transactional?: boolean;
}

interface BatchResponse<T> {
  batchId: string;
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    success: boolean;
    result?: T;
    error?: string;
  }>;
}

// Batch command operations
async function batchCommands(
  client: ApiClient,
  commands: Command[]
): Promise<BatchResponse<CommandResult>> {
  const batchRequest: BatchRequest<Command> = {
    operations: commands,
    batchId: `batch-${Date.now()}`,
    transactional: true,
  };

  return client.request<BatchResponse<CommandResult>>("/api/commands/batch", {
    method: "POST",
    body: JSON.stringify(batchRequest),
  });
}

// Example: Batch post operations
async function batchUpdatePostStatuses(
  client: ApiClient,
  updates: Array<{ postId: string; status: string }>
): Promise<BatchResponse<CommandResult>> {
  const commands: Command[] = updates.map((update) => ({
    aggregateId: update.postId,
    aggregateType: "Post",
    type: "post.updateStatus",
    data: { status: update.status },
    metadata: {
      userId: "current-user-id",
      correlationId: `batch-${Date.now()}`,
      source: "BatchUpdate",
    },
  }));

  return batchCommands(client, commands);
}
```

### Error Handling and Retry Logic

```typescript
interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  exponentialBackoff: boolean;
  retryCondition?: (error: Error) => boolean;
}

class ApiClientWithRetry extends ApiClient {
  async requestWithRetry<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOptions: Partial<RetryOptions> = {}
  ): Promise<T> {
    const defaultOptions: RetryOptions = {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      exponentialBackoff: true,
      retryCondition: (error) => {
        // Retry on network errors and 5xx responses
        return (
          error.message.includes("fetch") ||
          error.message.includes("5") ||
          error.message.includes("timeout")
        );
      },
    };

    const finalOptions = { ...defaultOptions, ...retryOptions };
    let lastError: Error;

    for (let attempt = 1; attempt <= finalOptions.maxAttempts; attempt++) {
      try {
        return await this.request<T>(endpoint, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on last attempt
        if (attempt === finalOptions.maxAttempts) {
          break;
        }

        // Check if error should be retried
        if (!finalOptions.retryCondition?.(lastError)) {
          break;
        }

        // Calculate delay
        let delay = finalOptions.initialDelay;
        if (finalOptions.exponentialBackoff) {
          delay = Math.min(
            finalOptions.initialDelay * Math.pow(2, attempt - 1),
            finalOptions.maxDelay
          );
        }

        console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}

// Usage
const retryClient = new ApiClientWithRetry();

try {
  const result = await retryClient.requestWithRetry<QueryResult<PostSummary[]>>(
    "/api/queries/posts",
    { method: "GET" },
    {
      maxAttempts: 5,
      initialDelay: 2000,
      retryCondition: (error) => error.message.includes("timeout"),
    }
  );
} catch (error) {
  console.error("Request failed after all retries:", error);
}
```

## Rate Limiting and Circuit Breaker

```typescript
interface RateLimiter {
  checkLimit(key: string): Promise<{ allowed: boolean; resetTime: number }>;
}

interface CircuitBreakerState {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  lastFailure: Date | null;
  nextAttempt: Date | null;
}

class CircuitBreaker {
  private state: CircuitBreakerState = {
    state: "CLOSED",
    failureCount: 0,
    lastFailure: null,
    nextAttempt: null,
  };

  constructor(
    private failureThreshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.state === "OPEN") {
      if (Date.now() < this.state.nextAttempt!.getTime()) {
        throw new Error("Circuit breaker is OPEN");
      }
      this.state.state = "HALF_OPEN";
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.state.failureCount = 0;
    this.state.state = "CLOSED";
    this.state.lastFailure = null;
    this.state.nextAttempt = null;
  }

  private onFailure(): void {
    this.state.failureCount++;
    this.state.lastFailure = new Date();

    if (this.state.failureCount >= this.failureThreshold) {
      this.state.state = "OPEN";
      this.state.nextAttempt = new Date(Date.now() + this.timeout);
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }
}

// Usage with API client
class ResilientApiClient extends ApiClient {
  private circuitBreaker = new CircuitBreaker();

  async resilientRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.circuitBreaker.execute(() => this.request<T>(endpoint, options));
  }
}
```

## Testing Integration

```typescript
// Mock API client for testing
class MockApiClient extends ApiClient {
  private mockResponses = new Map<string, any>();
  private delays = new Map<string, number>();

  setMockResponse(endpoint: string, response: any, delay: number = 0): void {
    this.mockResponses.set(endpoint, response);
    this.delays.set(endpoint, delay);
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const mockResponse = this.mockResponses.get(endpoint);
    if (mockResponse) {
      const delay = this.delays.get(endpoint) || 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (mockResponse instanceof Error) {
        throw mockResponse;
      }

      return mockResponse;
    }

    // Fallback to actual request in development
    if (process.env.NODE_ENV === "development") {
      return super.request<T>(endpoint, options);
    }

    throw new Error(`No mock response configured for ${endpoint}`);
  }
}

// Test example
describe("Post API Integration", () => {
  let mockClient: MockApiClient;

  beforeEach(() => {
    mockClient = new MockApiClient();
  });

  it("should create a post successfully", async () => {
    const mockResult: CommandResult = {
      success: true,
      aggregateId: "post-123",
      version: 1,
      events: 1,
    };

    mockClient.setMockResponse("/api/commands/posts", mockResult);

    const result = await createPost(mockClient, {
      title: "Test Post",
      content: "Test content",
      channelIds: ["channel-1"],
      userId: "user-123",
    });

    expect(result.success).toBe(true);
    expect(result.aggregateId).toBe("post-123");
  });

  it("should handle API errors gracefully", async () => {
    mockClient.setMockResponse("/api/commands/posts", new Error("Validation failed"));

    await expect(
      createPost(mockClient, {
        title: "",
        content: "Test content",
        channelIds: [],
        userId: "user-123",
      })
    ).rejects.toThrow("Validation failed");
  });
});
```

## Best Practices

### 1. Error Handling

- Always wrap API calls in try-catch blocks
- Provide meaningful error messages to users
- Log errors with sufficient context for debugging
- Implement retry logic for transient failures

### 2. Performance Optimization

- Use caching for frequently accessed data
- Implement pagination for large datasets
- Use optimistic updates for better UX
- Batch operations when possible

### 3. Security

- Always use HTTPS in production
- Include CSRF protection for state-changing operations
- Validate and sanitize all user inputs
- Implement proper authentication and authorization

### 4. Monitoring

- Track API response times and error rates
- Monitor business metrics (post creation rates, engagement)
- Set up alerts for critical failures
- Use correlation IDs for request tracing

### 5. Integration Testing

- Test against real API endpoints in staging
- Mock external dependencies reliably
- Test error scenarios and edge cases
- Validate data consistency across operations

This comprehensive guide provides everything needed to successfully integrate with our Phase 2 API, following best practices for reliability, performance, and maintainability.
