# Provider System Architecture

## Overview

The Provider System implements a **Ports & Adapters** (Hexagonal) architecture pattern that enables seamless integration with multiple social media platforms. It provides a unified interface for content publishing, analytics collection, and platform-specific operations while maintaining complete isolation between business logic and external API implementations.

## Core Architecture

### Ports & Adapters Pattern

```typescript
interface ProviderAdapter {
  id: string;
  limits: PlatformLimits;
  capabilities: PlatformCapabilities;

  validateCredentials(creds: unknown): Promise<Result<void, AuthError>>;
  render(post: CanonicalPost): Result<RenderedContent, RenderError>;
  publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>>;
  getAnalytics?(input: AnalyticsInput): Promise<Result<Analytics[], AnalyticsError>>;
}
```

### Key Components

#### 1. Provider Registry

**Location**: `packages/ports/src/ProviderAdapter.ts`

The registry manages all available providers and their capabilities:

```typescript
class ProviderRegistry {
  private providers = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void;
  get(id: string): ProviderAdapter | undefined;
  list(): ProviderAdapter[];
  getCapabilities(id: string): PlatformCapabilities;
  validateContent(id: string, content: string): ValidationResult;
}
```

#### 2. Circuit Breaker Integration

**Location**: `packages/adapters/external-apis/src/circuitBreaker.ts`

All provider operations are protected by circuit breakers:

```typescript
interface CircuitBreakerConfig {
  timeout: number; // 5000ms default
  errorThresholdPercentage: number; // 50% default
  resetTimeout: number; // 60000ms default
  rollingCountTimeout: number; // 10000ms default
  volumeThreshold: number; // 10 requests default
}

class CircuitBreaker<T, R> {
  async execute(fn: () => Promise<R>): Promise<R>;
  getState(): "CLOSED" | "OPEN" | "HALF_OPEN";
  getStats(): CircuitBreakerStats;
}
```

#### 3. Fallback Strategies

**Location**: `packages/adapters/fallback-strategies/src/index.ts`

When providers fail, the system implements intelligent fallback mechanisms:

```typescript
interface FallbackStrategy {
  type: "RETRY" | "CACHED_RESPONSE" | "QUEUE_FOR_LATER" | "ALTERNATIVE_PROVIDER";
  execute<T>(operation: () => Promise<T>, context: FallbackContext): Promise<T>;
}

class FallbackStrategyManager {
  private strategies: Map<string, FallbackStrategy[]>;

  async executeWithFallback<T>(
    operation: () => Promise<T>,
    operationKey: string,
    context: FallbackContext
  ): Promise<T>;
}
```

## Current Provider: X/Twitter

### Implementation

**Location**: `packages/providers/x/src/index.ts`

#### Platform Limits & Capabilities

```typescript
export const XAdapter: ProviderAdapter = {
  id: "x",
  limits: {
    maxChars: 280,
    allowedMedia: ["image", "video", "gif"],
    aspectRatios: ["16:9", "1:1", "4:5", "9:16"],
    maxTweetsPerThread: 25,
    maxMediaPerTweet: 4,
    threadingSupported: true,
    rateLimitHints: { burst: 300, perSeconds: 10800 }, // 300 tweets per 3 hours
  },
  capabilities: {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: true,
  },
};
```

#### API Client Implementation

**Location**: `packages/providers/x/src/apiClient.ts`

```typescript
export class XApiClient {
  private credentials: XCredentials;
  private circuitBreaker: CircuitBreaker;

  constructor(credentials: XCredentials) {
    this.credentials = credentials;
    this.circuitBreaker = createCircuitBreaker("x-api", {
      timeout: 5000,
      errorThresholdPercentage: 50,
      resetTimeout: 60000,
    });
  }

  async validateCredentials(): Promise<void> {
    return this.circuitBreaker.execute(async () => {
      const response = await fetch("https://api.twitter.com/2/users/me", {
        headers: {
          Authorization: `Bearer ${this.credentials.bearerToken}`,
        },
      });

      if (!response.ok) {
        throw new XApiError(response.status, await response.text());
      }
    });
  }

  async publishTweet(content: TweetContent): Promise<PublishReceipt> {
    return this.circuitBreaker.execute(async () => {
      // Implementation with retry logic and error handling
    });
  }

  async getAnalytics(tweetId: string): Promise<TweetAnalytics> {
    return this.circuitBreaker.execute(async () => {
      // Analytics fetching with fallback caching
    });
  }
}
```

#### Threading System

**Location**: `packages/core/threading/src/threadPlanner.ts`

X/Twitter's thread planning and publishing:

```typescript
interface ThreadPlan {
  needsThreading: boolean;
  tweets: TweetFragment[];
  estimatedReach: number;
  strategy: "SENTENCE" | "PARAGRAPH" | "MANUAL";
}

export function planThread(
  canonical: CanonicalPost,
  strategy: ThreadStrategy,
  options: ThreadOptions
): Result<ThreadPlan, ThreadError> {
  // Intelligent content splitting based on:
  // - Character limits (280 chars for X)
  // - Sentence boundaries
  // - Paragraph breaks
  // - Media distribution
  // - Hashtag placement
}
```

#### Content Rendering

```typescript
render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
  const threadPlan = planThread(canonical, "AUTO", {
    maxCharsPerTweet: this.limits.maxChars,
    maxTweetsPerThread: this.limits.maxTweetsPerThread,
    maxMediaPerTweet: this.limits.maxMediaPerTweet,
  });

  if (!threadPlan.ok) {
    return err(threadPlan.error);
  }

  if (threadPlan.value.needsThreading) {
    return ok({
      type: "thread",
      content: threadPlan.value,
      meta: { estimatedReach: threadPlan.value.estimatedReach },
    });
  } else {
    return ok({
      type: "single",
      content: threadPlan.value.tweets[0],
      meta: { platform: "x" },
    });
  }
}
```

## Rate Limiting & Compliance

### Rate Limit Management

**Location**: `apps/api/src/security/slidingWindowRateLimit.ts`

```typescript
interface RateLimitConfig {
  windowSizeMs: number; // Time window (e.g., 3600000 for 1 hour)
  maxRequests: number; // Max requests per window (e.g., 300 for X)
  keyGenerator: (req: Request) => string; // Tenant isolation
}

class SlidingWindowRateLimit {
  async checkLimit(key: string): Promise<RateLimitResult> {
    const current = await this.redis.get(key);
    const requests = JSON.parse(current || "[]");

    // Remove expired timestamps
    const now = Date.now();
    const validRequests = requests.filter(
      (timestamp: number) => now - timestamp < this.config.windowSizeMs
    );

    if (validRequests.length >= this.config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: validRequests[0] + this.config.windowSizeMs,
      };
    }

    // Add current request
    validRequests.push(now);
    await this.redis.setex(
      key,
      Math.ceil(this.config.windowSizeMs / 1000),
      JSON.stringify(validRequests)
    );

    return {
      allowed: true,
      remaining: this.config.maxRequests - validRequests.length,
      resetTime: now + this.config.windowSizeMs,
    };
  }
}
```

### X/Twitter Specific Limits

```typescript
const X_RATE_LIMITS = {
  "tweets/publish": { windowMs: 3 * 60 * 60 * 1000, maxRequests: 300 }, // 300 per 3 hours
  "tweets/read": { windowMs: 15 * 60 * 1000, maxRequests: 75 }, // 75 per 15 minutes
  "users/lookup": { windowMs: 15 * 60 * 1000, maxRequests: 300 }, // 300 per 15 minutes
  "analytics/fetch": { windowMs: 15 * 60 * 1000, maxRequests: 75 }, // 75 per 15 minutes
};
```

## Error Handling & Resilience

### Provider Error Types

```typescript
type ProviderError =
  | "AUTH_INVALID" // Invalid credentials
  | "AUTH_EXPIRED" // Token expired
  | "RATE_LIMITED" // Rate limit exceeded
  | "CONTENT_REJECTED" // Content policy violation
  | "MEDIA_INVALID" // Media format/size issues
  | "NETWORK_ERROR" // Network connectivity
  | "SERVICE_UNAVAILABLE" // Provider service down
  | "QUOTA_EXCEEDED"; // Account quota reached
```

### Retry Logic

**Location**: `packages/adapters/external-apis/src/circuitBreaker.ts`

```typescript
interface RetryConfig {
  maxAttempts: number; // 3 default
  baseDelayMs: number; // 1000ms default
  maxDelayMs: number; // 30000ms default
  backoffMultiplier: number; // 2.0 default
  jitterMs: number; // 100ms default
}

class ExponentialBackoffRetry {
  async execute<T>(operation: () => Promise<T>, config: RetryConfig): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === config.maxAttempts) {
          throw lastError;
        }

        const delay =
          Math.min(
            config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
            config.maxDelayMs
          ) +
          Math.random() * config.jitterMs;

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }
}
```

### Dead Letter Queue

**Location**: `packages/adapters/dead-letter-queue/src/index.ts`

Failed operations are queued for later retry:

```typescript
interface DeadLetterItem {
  id: string;
  operation: string;
  payload: unknown;
  originalError: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: Date;
  createdAt: Date;
}

class DeadLetterQueue {
  async add(item: DeadLetterItem): Promise<void>;
  async retry(id: string): Promise<void>;
  async getItems(status: "pending" | "exhausted"): Promise<DeadLetterItem[]>;
  async processRetries(): Promise<void>;
}
```

## Monitoring & Observability

### Health Checks

**Location**: `packages/monitoring/health-checks/src/index.ts`

```typescript
interface ProviderHealthCheck {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  latency: number;
  lastChecked: Date;
  errorRate: number;
  circuitBreakerState: "CLOSED" | "OPEN" | "HALF_OPEN";
}

class ProviderHealthMonitor {
  async checkProvider(id: string): Promise<ProviderHealthCheck> {
    const adapter = this.registry.get(id);
    const startTime = Date.now();

    try {
      await adapter.validateCredentials(this.getCredentials(id));
      const latency = Date.now() - startTime;

      return {
        id,
        name: adapter.name,
        status: latency < 1000 ? "healthy" : "degraded",
        latency,
        lastChecked: new Date(),
        errorRate: this.getErrorRate(id),
        circuitBreakerState: this.getCircuitBreakerState(id),
      };
    } catch (error) {
      return {
        id,
        name: adapter.name,
        status: "unhealthy",
        latency: Date.now() - startTime,
        lastChecked: new Date(),
        errorRate: this.getErrorRate(id),
        circuitBreakerState: "OPEN",
      };
    }
  }
}
```

### Metrics Collection

**Location**: `apps/api/src/metrics/apiMetrics.ts`

```typescript
class ProviderMetrics {
  private requestDuration = new promClient.Histogram({
    name: "provider_request_duration_seconds",
    help: "Duration of provider requests",
    labelNames: ["provider", "operation", "status"],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  });

  private errorRate = new promClient.Counter({
    name: "provider_errors_total",
    help: "Total provider errors",
    labelNames: ["provider", "operation", "error_type"],
  });

  recordRequest(provider: string, operation: string, duration: number, status: string): void {
    this.requestDuration.labels(provider, operation, status).observe(duration);
  }

  recordError(provider: string, operation: string, errorType: string): void {
    this.errorRate.labels(provider, operation, errorType).inc();
  }
}
```

## Adding New Providers

### Provider Template

**Location**: `packages/providers/_template/src/index.ts`

```typescript
export const TemplateAdapter: ProviderAdapter = {
  id: "template",
  limits: {
    maxChars: 1000,
    allowedMedia: ["image", "video"],
    aspectRatios: ["16:9", "1:1"],
    maxThreadLength: 10,
    maxMediaPerPost: 10,
    threadingSupported: true,
    rateLimitHints: { burst: 100, perSeconds: 3600 },
  },
  capabilities: {
    publish: true,
    schedule: true,
    analytics: true,
    comments: false,
    replies: true,
    threading: false,
  },

  async validateCredentials(creds: unknown): Promise<Result<void, AuthError>> {
    // Implement credential validation
  },

  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // Implement content rendering
  },

  async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    // Implement publishing logic
  },

  async getAnalytics(input: AnalyticsInput): Promise<Result<Analytics[], AnalyticsError>> {
    // Implement analytics fetching
  },
};
```

### Registration Process

```typescript
// In provider module
import { providerRegistry } from "@ports/core";
import { TemplateAdapter } from "./TemplateAdapter";

providerRegistry.register(TemplateAdapter);
```

### API Client Template

**Location**: `packages/providers/_template/src/apiClient.ts`

```typescript
export class TemplateApiClient {
  private credentials: TemplateCredentials;
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;

  constructor(credentials: TemplateCredentials) {
    this.credentials = credentials;
    this.circuitBreaker = createCircuitBreaker(`${providerId}-api`);
    this.rateLimiter = createRateLimiter(TEMPLATE_RATE_LIMITS);
  }

  async request<T>(endpoint: string, options: RequestOptions): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      await this.rateLimiter.checkLimit(`${this.credentials.userId}:${endpoint}`);

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.credentials.accessToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new TemplateApiError(response.status, await response.text());
      }

      return response.json();
    });
  }
}
```

## Future Provider Roadmap

### Phase 5: Instagram (Next)

- **Instagram Graph API**: Business account integration
- **Content Types**: Feed posts, Stories, Reels, IGTV
- **Carousel Support**: Multiple images/videos per post
- **Shopping Integration**: Product tagging capabilities
- **Stories Sequence**: Time-based story planning

### Phase 6: Facebook

- **Facebook Pages API**: Business page management
- **Event Management**: Event creation and promotion
- **Marketplace**: Product listings
- **Cross-posting**: Instagram integration
- **Advanced Analytics**: Business insights

### Phase 7: YouTube

- **YouTube Data API v3**: Video upload and management
- **YouTube Shorts**: Short-form video content
- **Community Posts**: Text and image posts
- **Live Streaming**: Stream management
- **Video SEO**: Thumbnail and metadata optimization

### Phase 8: TikTok

- **TikTok Business API**: Commercial content management
- **Video Upload**: MP4 video publishing
- **Trend Analysis**: Hashtag and sound trending
- **Music Integration**: Licensed music library
- **Advertising Integration**: Promoted content

### Future Platforms

- **LinkedIn**: Professional networking content
- **Pinterest**: Visual content and boards
- **Reddit**: Community-based content
- **Discord**: Server and channel management
- **Snapchat**: Snap and story content
- **Twitch**: Stream management and clips

## Testing Strategy

### Provider Contract Tests

```typescript
describe("Provider Contract Tests", () => {
  const providers = [XAdapter, InstagramAdapter, FacebookAdapter];

  providers.forEach((provider) => {
    describe(`${provider.id} Provider`, () => {
      test("should implement all required methods", () => {
        expect(provider.validateCredentials).toBeDefined();
        expect(provider.render).toBeDefined();
        expect(provider.publish).toBeDefined();
      });

      test("should have valid limits configuration", () => {
        expect(provider.limits.maxChars).toBeGreaterThan(0);
        expect(provider.limits.allowedMedia).toContain("image");
      });

      test("should handle authentication errors", async () => {
        const result = await provider.validateCredentials({});
        expect(result.ok).toBe(false);
        expect(["AUTH_INVALID", "AUTH_EXPIRED"]).toContain(result.error);
      });
    });
  });
});
```

### Integration Tests

```typescript
describe("Provider Integration Tests", () => {
  test("should publish content through adapter", async () => {
    const adapter = new XAdapter();
    const mockPost: CanonicalPost = createMockPost();

    const renderResult = adapter.render(mockPost);
    expect(renderResult.ok).toBe(true);

    if (renderResult.ok) {
      const publishResult = await adapter.publish({
        content: renderResult.value,
        credentials: mockCredentials,
      });

      expect(publishResult.ok).toBe(true);
    }
  });
});
```

---

**Version**: 1.0
**Last Updated**: January 23, 2025
**Current Providers**: X/Twitter
**Planned Providers**: Instagram, Facebook, YouTube, TikTok
