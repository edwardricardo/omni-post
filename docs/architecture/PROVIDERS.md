# Provider System

The Provider System implements **Ports & Adapters** architecture for social media platform integrations.

## Provider Adapter Interface

All providers implement this interface:

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

interface PlatformLimits {
  maxChars: number;
  allowedMedia: MediaType[];
  aspectRatios: string[];
  maxThreadLength?: number;
  maxMediaPerPost: number;
  threadingSupported: boolean;
  rateLimitHints: { burst: number; perSeconds: number };
}

interface PlatformCapabilities {
  publish: boolean;
  schedule: boolean;
  analytics: boolean;
  comments: boolean;
  replies: boolean;
  threading: boolean;
}
```

## Implemented Providers

### X/Twitter

**Location**: `packages/providers/x/`

**Limits**:

| Limit                 | Value                  |
| --------------------- | ---------------------- |
| Max characters        | 280                    |
| Max media per tweet   | 4                      |
| Max tweets per thread | 25                     |
| Rate limit            | 300 tweets per 3 hours |

**Capabilities**:

- Publish single tweets
- Publish threads
- Schedule posts
- Fetch analytics
- Reply to tweets

**API Client**:

```typescript
class XApiClient {
  async validateCredentials(): Promise<void>;
  async publishTweet(content: TweetContent): Promise<PublishReceipt>;
  async publishThread(tweets: TweetContent[]): Promise<ThreadReceipt>;
  async getAnalytics(tweetId: string): Promise<TweetAnalytics>;
}
```

### Instagram

**Location**: `packages/providers/instagram/`

**Limits**:

| Limit                  | Value     |
| ---------------------- | --------- |
| Max characters         | 2,200     |
| Max media per carousel | 10        |
| Supported formats      | JPEG, MP4 |

**Capabilities**:

- Feed posts
- Carousels
- Reels
- Stories
- Comments

### Facebook

**Location**: `packages/providers/facebook/`

**Limits**:

| Limit              | Value  |
| ------------------ | ------ |
| Max characters     | 63,206 |
| Max media per post | 10     |

**Capabilities**:

- Page posts
- Comments
- Engagement tracking
- Webhooks

### TikTok

**Location**: `packages/providers/tiktok/`

**Limits**:

| Limit             | Value      |
| ----------------- | ---------- |
| Max video length  | 10 minutes |
| Max file size     | 4GB        |
| Supported formats | MP4, WebM  |

**Capabilities**:

- Video uploads
- Scheduling (limited)
- Analytics

### YouTube

**Location**: `packages/providers/youtube/`

**Limits**:

| Limit                | Value    |
| -------------------- | -------- |
| Max video length     | 12 hours |
| Max file size        | 256GB    |
| Community post chars | 500      |

**Capabilities**:

- Community posts
- Shorts
- Video uploads
- Channel analytics

## Circuit Breaker Pattern

All provider operations are protected:

```typescript
const circuitBreakerConfig = {
  timeout: 5000, // 5 seconds
  errorThresholdPercentage: 50,
  resetTimeout: 60000, // 1 minute
  volumeThreshold: 10,
};
```

**States**:

- `CLOSED`: Normal operation
- `OPEN`: Failing, requests blocked
- `HALF_OPEN`: Testing recovery

## Rate Limiting

Per-provider rate limits:

```typescript
const X_RATE_LIMITS = {
  "tweets/publish": { windowMs: 3 * 60 * 60 * 1000, maxRequests: 300 },
  "tweets/read": { windowMs: 15 * 60 * 1000, maxRequests: 75 },
  "analytics/fetch": { windowMs: 15 * 60 * 1000, maxRequests: 75 },
};
```

## Error Handling

Provider error types:

| Error                 | Description              |
| --------------------- | ------------------------ |
| `AUTH_INVALID`        | Invalid credentials      |
| `AUTH_EXPIRED`        | Token expired            |
| `RATE_LIMITED`        | Rate limit exceeded      |
| `CONTENT_REJECTED`    | Content policy violation |
| `MEDIA_INVALID`       | Media format/size issues |
| `NETWORK_ERROR`       | Network connectivity     |
| `SERVICE_UNAVAILABLE` | Provider service down    |

## Retry Logic

Exponential backoff with jitter:

```typescript
const retryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2.0,
  jitterMs: 100,
};
```

## Dead Letter Queue

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
}
```

## Adding New Providers

1. Create provider package in `packages/providers/{provider}/`
2. Implement `ProviderAdapter` interface
3. Create API client with circuit breaker
4. Register with provider registry
5. Add tests

**Template**: `packages/providers/_template/`

```typescript
export const NewAdapter: ProviderAdapter = {
  id: "new-provider",
  limits: {
    maxChars: 1000,
    allowedMedia: ["image", "video"],
    aspectRatios: ["16:9", "1:1"],
    maxMediaPerPost: 10,
    threadingSupported: false,
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

  async validateCredentials(creds) {
    /* ... */
  },
  render(canonical) {
    /* ... */
  },
  async publish(input) {
    /* ... */
  },
  async getAnalytics(input) {
    /* ... */
  },
};
```

---

_Last updated: March 2026_
