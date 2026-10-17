# Provider Capabilities Reference

Last updated: 2026-03-27

## Supported Providers

OmniPost supports 11 social media providers. Each provider adapter implements the `ProviderAdapter` interface from `@ports/core`.

## Capabilities Matrix

| Capability       | X   | Instagram | Facebook | YouTube    | TikTok | LinkedIn | Telegram | Snapchat | Pinterest | Bluesky | Threads |
| ---------------- | --- | --------- | -------- | ---------- | ------ | -------- | -------- | -------- | --------- | ------- | ------- |
| **Publish**      | Yes | Yes       | Yes      | Yes        | Yes    | Yes      | Yes      | Yes      | Yes       | Yes     | Yes     |
| **Schedule**     | Yes | Yes       | Yes      | Yes        | No     | No       | No       | No       | No        | No      | No      |
| **Analytics**    | Yes | Yes       | Yes      | Yes        | Yes    | Yes      | No       | Yes      | Yes       | No      | Yes     |
| **Comments**     | Yes | Yes       | Yes      | Yes        | No     | Yes      | No       | No       | No        | Yes     | Yes     |
| **Replies**      | Yes | Yes       | Yes      | Yes        | No     | Yes      | No       | No       | No        | Yes     | Yes     |
| **Threading**    | Yes | Yes       | No       | No         | No     | No       | No       | No       | No        | Yes     | No      |
| **Images**       | Yes | Yes       | Yes      | Thumbnails | Yes    | Yes      | Yes      | Yes      | Yes       | Yes     | Yes     |
| **Videos**       | Yes | Yes       | Yes      | Yes        | Yes    | Yes      | Yes      | Yes      | Yes       | Yes     | Yes     |
| **GIFs**         | Yes | No        | Yes      | No         | No     | No       | Yes      | No       | Yes       | No      | No      |
| **Stories**      | No  | Yes       | Yes      | No         | No     | No       | No       | Yes      | No        | No      | No      |
| **Reels/Shorts** | No  | Yes       | Yes      | Yes        | N/A    | No       | No       | No       | No        | No      | No      |
| **Carousel**     | No  | Yes       | Yes      | No         | Yes    | Yes      | Yes      | No       | No        | No      | Yes     |
| **Hashtags**     | Yes | Yes       | Yes      | Yes        | Yes    | Yes      | Yes      | No       | Yes       | Yes     | Yes     |
| **Mentions**     | Yes | Yes       | Yes      | Yes        | Yes    | Yes      | Yes      | No       | No        | Yes     | No      |
| **Links**        | Yes | No        | Yes      | Yes        | No     | Yes      | Yes      | No       | Yes       | Yes     | Unknown |
| **Polls**        | Yes | No        | No       | No         | No     | Yes      | Yes      | No       | No        | No      | No      |

## Per-Provider Details

### X (Twitter)

- **Auth**: OAuth 2.0 PKCE (S256)
- **Max characters**: 280
- **Max images**: 4
- **Max video duration**: 140 seconds
- **Polls**: Up to 4 options, 5min–7day duration
- **Quote tweets**: Supported via `quote_tweet_id`
- **Thread publishing**: Multi-tweet threads with reply chaining
- **Rate limits**: ~50 tweets/15min (Basic tier)
- **Webhook events**: Tweet activity (likes, replies, quotes, retweets)

### Instagram

- **Auth**: Facebook Login / Instagram Graph API
- **Max characters**: 2,200
- **Max images**: 10 (carousel)
- **Max video duration**: 60 seconds (Reels up to 90s)
- **Content types**: Feed post, Story, Reel, Carousel
- **Comments**: Read via `GET /{media-id}/comments`, reply via `POST /{comment-id}/replies`
- **Thread publishing**: Carousel posts with multiple images
- **Webhook events**: Comments, mentions, story insights

### Facebook

- **Auth**: Facebook Login / Pages API
- **Max characters**: 63,206
- **Max images**: 10
- **Max video duration**: 4 hours
- **Content types**: Post, Story, Reel, Link post
- **Scheduling**: Native via `scheduled_publish_time` parameter
- **Comments**: Read via `GET /{post-id}/comments`, reply via `POST /{comment-id}/comments`
- **Webhook events**: Feed updates, comments, reactions

### YouTube

- **Auth**: Google OAuth 2.0
- **Max characters**: 5,000 (description)
- **Max video duration**: 12 hours
- **Content types**: Video, Short, Live Stream
- **Comments**: Read via `commentThreads.list`, reply via `comments.insert`
- **Analytics**: Views, likes, comments, shares, watch time, subscribers gained
- **Quota**: 10,000 units/day (1 unit per read, 50 per write)
- **Webhook events**: Video status changes, new subscriptions

### TikTok

- **Auth**: TikTok Login Kit (OAuth 2.0)
- **Max characters**: 2,200
- **Max images**: 35 (photo carousel)
- **Max video duration**: 10 minutes
- **Content types**: Video, Photo carousel
- **Photo posts**: Up to 35 images via Content Publishing API
- **Hashtag strategy**: Automated via Research API (requires special approval)
- **Rate limits**: ~50 requests/hour
- **Webhook events**: Video status changes

### LinkedIn

- **Auth**: LinkedIn OAuth 2.0 (3-legged)
- **Max characters**: 3,000
- **Max images**: 20 (multi-image)
- **Max video duration**: 10 minutes
- **Content types**: Text post, Image post, Multi-image, Video, Document (PDF), Poll
- **Polls**: Up to 4 options, 1–14 day duration
- **Documents**: PDF carousel via document upload API
- **Comments**: Read via `GET /socialActions/{activityUrn}/comments`, reply with `parentComment`
- **Webhook events**: HMAC-SHA256 verification

### Telegram

- **Auth**: Bot API token
- **Max characters**: 4,096
- **Max images**: 10 (media group)
- **Max video duration**: Unlimited
- **Content types**: Text, Photo, Video, Document, Audio, Poll, Media group
- **Polls**: Quiz and regular polls via `sendPoll`
- **Message editing**: `editMessageText` (within 48 hours)
- **Message deletion**: `deleteMessage` (within 48 hours)
- **Inline keyboards**: `reply_markup` support on all send methods
- **Limitations**: No analytics API, no comments/replies concept
- **Webhook events**: Update objects with secret token verification

### Snapchat

- **Auth**: Snapchat Login Kit (OAuth 2.0)
- **Max characters**: 250
- **Max images**: 1
- **Max video duration**: 60 seconds
- **Content types**: Story (single image or video)
- **Limitations**: Very limited public API for organic content
  - No comments/replies API
  - No DMs API
  - No Spotlight (requires partner access)
  - No polls, scheduling, or carousels
- **Analytics**: Creative status and basic story metrics
- **Webhook events**: Creative status changes (approved/rejected/processing)

### Pinterest

- **Auth**: Pinterest OAuth 2.0
- **Max characters**: 500 (pin description)
- **Max images**: 1 per pin
- **Max video duration**: 15 minutes
- **Content types**: Pin (image or video)
- **Board management**: Create boards and board sections
- **Analytics**: Pin impressions, saves, clicks, outbound clicks
- **Limitations**: No webhooks API, no comments API, Idea Pins deprecated (2024)

### Bluesky

- **Auth**: AT Protocol (app password or OAuth)
- **Max characters**: 300 (graphemes)
- **Max images**: 4
- **Max video duration**: 60 seconds
- **Content types**: Post, Reply, Quote post, Thread
- **Threading**: Native thread support via reply chaining
- **Comments/Replies**: Full support via AT Protocol
- **Mentions**: Via `@handle.bsky.social` resolution to DID
- **Links**: Rich link cards with facets
- **Hashtags**: Supported via facets
- **Limitations**: No analytics API, no scheduling API, no polls, no stories
- **Webhook events**: Firehose subscription via Jetstream

### Threads

- **Auth**: OAuth (`accessToken` and `userId` credentials)
- **Max characters**: 500
- **Max media per post**: 10 images or videos; more than one is published as a carousel
- **Aspect ratios**: 1:1, 4:5, 9:16, 16:9
- **Max hashtags**: 30
- **Content types**: Text, image, video, carousel
- **Threading**: No (`threadingSupported: false`)
- **Comments/Replies**: `getComments` and `postReply`
- **Analytics**: `fetchAnalytics`
- **Limitations**: no scheduling (`schedule: false`), no mention ingestion (`mentions: false`), no webhook processor

## Authentication Requirements

| Provider  | Auth Type        | Required Scopes                                                                              |
| --------- | ---------------- | -------------------------------------------------------------------------------------------- |
| X         | OAuth 2.0 PKCE   | `tweet.read`, `tweet.write`, `users.read`                                                    |
| Instagram | Facebook Login   | `instagram_basic`, `instagram_content_publish`                                               |
| Facebook  | Facebook Login   | `pages_manage_posts`, `pages_read_engagement`                                                |
| YouTube   | Google OAuth 2.0 | `youtube.upload`, `youtube.readonly`                                                         |
| TikTok    | OAuth 2.0        | `video.upload`, `user.info.basic`                                                            |
| LinkedIn  | OAuth 2.0        | `w_member_social`, `r_liteprofile`                                                           |
| Telegram  | Bot Token        | N/A (bot token is the auth)                                                                  |
| Snapchat  | OAuth 2.0        | `snapchat-marketing-api`                                                                     |
| Pinterest | OAuth 2.0        | `boards:read`, `pins:read`, `pins:write`                                                     |
| Bluesky   | AT Protocol      | N/A (app password or OAuth session)                                                          |
| Threads   | OAuth            | `threads_basic`, `threads_content_publish`, `threads_read_replies`, `threads_manage_replies` |

## Rate Limits

| Provider  | Burst        | Window     | Notes                          |
| --------- | ------------ | ---------- | ------------------------------ |
| X         | 50 tweets    | 15 minutes | Basic tier ($100/mo for polls) |
| Instagram | 25 posts     | 24 hours   | Per account                    |
| Facebook  | 200 calls    | 1 hour     | Per user token                 |
| YouTube   | 10,000 units | 24 hours   | 1 unit read, 50 units write    |
| TikTok    | 50 requests  | 1 hour     | Content Publishing API         |
| LinkedIn  | 100 calls    | 24 hours   | Per member                     |
| Telegram  | 30 messages  | 1 second   | Per bot                        |
| Snapchat  | 100 calls    | 1 hour     | Marketing API                  |
| Pinterest | 1,000 calls  | 1 hour     | Per app                        |
| Bluesky   | 3,000 calls  | 5 minutes  | AT Protocol rate limits        |
| Threads   | 60 calls     | 24 hours   | The adapter's `rateLimitHints` |

## Webhook Processors

| Provider  | Processor                   | Verification         |
| --------- | --------------------------- | -------------------- |
| X         | `xWebhookProcessor`         | CRC token validation |
| Instagram | `instagramWebhookProcessor` | SHA-1 HMAC           |
| Facebook  | `facebookWebhookProcessor`  | SHA-1 HMAC           |
| YouTube   | `youtubeWebhookProcessor`   | PubSubHubbub         |
| TikTok    | `tiktokWebhookProcessor`    | HMAC-SHA256          |
| LinkedIn  | `linkedinWebhookProcessor`  | HMAC-SHA256          |
| Telegram  | `telegramWebhookProcessor`  | Secret token header  |
| Snapchat  | `snapchatWebhookProcessor`  | HMAC-SHA256          |
| Pinterest | N/A                         | No webhook API       |
| Bluesky   | `blueskyWebhookProcessor`   | Firehose/Jetstream   |
| Threads   | N/A                         | No processor         |

## The adapter interface

Read from the code on 2026-10-17. This section and the next two replace the provider system page, [`docs/architecture/PROVIDERS.md`](https://github.com/edwardricardo/omni-post/blob/9fddf03d1ed40e5bda6ea1ccf7de6f25bc39fc9b/docs/architecture/PROVIDERS.md), which was removed from the repository that day (git history keeps it; the link is its last version).

Each of the 11 adapters is a class in `packages/providers/<name>/src/<Name>Adapter.ts` that implements `ProviderAdapter` from `@ports/core` (`packages/ports/src/ProviderAdapter.ts`), built by a `create<Name>Adapter` factory. The port holds `id`, `limits` (`ProviderLimits`: `maxChars`, `maxMediaPerPost` and `allowedMedia` required, the rest optional) and `capabilities` (`publish`, `schedule`, `analytics`, `comments`, `replies`, `threading`, `mentions`), and three required methods:

- `validateCredentials(credentials)`, which fails with `AUTH_INVALID` or `AUTH_EXPIRED`;
- `render(canonical)`, a pure transformation with no I/O;
- `publish(input, credentials)`, which fails with a `PublishError` (`packages/shared/src/types.ts`): `RATE_LIMIT`, `NETWORK`, `AUTH`, `VALIDATION`, `THREAD_INTERRUPTED` or `PARENT_TWEET_FAILED`.

The optional methods are `planThread` and `publishThread`, `fetchAnalytics`, `handleWebhook`, `getComments`, `postReply`, `searchMentions` and `fetchMentionById`. An adapter never fetches credentials: the caller passes them to every call that needs them, and `handleWebhook` takes none, because a webhook is signed with the subscription's HMAC secret. Adapters compose the stateless helpers of `packages/providers/shared/src/helpers.ts` (credential checks, media upload with retry, HTTP status to `PublishError`) instead of inheriting from a base class. A second interface of the same name, `apps/api/src/providers/providerAdapter.interface.ts`, is used by the API's capability manager, constraint validator and content synchronizer; no adapter implements it.

## Circuit breaker

Nine of the 11 packages, all but Bluesky and Threads, call their provider through `ExternalApiCircuitBreaker` (`packages/adapters/external-apis/src/circuitBreaker.ts`). Its defaults, `DEFAULT_EXTERNAL_API_OPTIONS`, are a 10-second timeout, opening at 50% errors, a 30-second reset, and 3 retries with exponential backoff from 1 to 30 seconds with jitter; its states are `CLOSED`, `OPEN` and `HALF_OPEN`. It has no fallback by default: a failed write surfaces its error instead of a synthetic receipt, which fitness #25 holds. A read that may degrade opts in with `ANALYTICS_CB_OPTIONS` or `METADATA_CB_OPTIONS`, which serve the last cached response (30 minutes and 1 hour) and fail when there is none.

## Adding a provider

1. Add its value to the `Provider` enum of `infra/prisma/schema.prisma`, with a migration.
2. Add its metadata to `PROVIDER_CONFIGS` (`packages/shared/src/providers/providerConfig.ts`); `registerAdapter` refuses a provider that is not there.
3. Create `packages/providers/<name>/` with the adapter class and its factory. `packages/providers/_template/` holds an `apiClient.ts`, an `index.ts` and a sandbox test example, and no vitest config.
4. Route the provider's HTTP calls through `ExternalApiCircuitBreaker`.
5. Register the adapter where adapters are built: `registerBuiltInAdapters()` in `apps/api/src/providers/providerRegistry.ts` and the maps of `apps/workers/src/publishWorker.ts` (all 11 today) and `apps/workers/src/mentionIngestWorker.ts` (10, without Threads).
6. Give the package a `vitest.config.ts` and a `test` script, as `docs/development/TESTING_INFRASTRUCTURE.md` "How to extend" says; a contract test follows its section 6.
7. Classify the new OAuth scopes: `pnpm check:legal` (fitness #45) reads the provider adapters and fails on an unclassified scope.
