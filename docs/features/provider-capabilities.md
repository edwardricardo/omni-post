# Provider Capabilities Reference

Last updated: 2026-03-27

## Supported Providers

OmniPost supports 11 social media providers. Each provider adapter implements the `ProviderAdapter` interface from `@ports/core`.

## Capabilities Matrix

Read from each adapter on 2026-10-17: Publish, Schedule, Analytics, Comments, Replies, Threading and Mentions are its `capabilities` flags; Images, Videos and GIFs its `limits.allowedMedia`; Stories, Reels/Shorts, Carousel (more than one media item in one post), Hashtags, Links and Polls its publish path. Unknown means nothing in the provider's package decides the cell.

| Capability       | X       | Instagram | Facebook   | YouTube | TikTok  | LinkedIn | Telegram | Snapchat | Pinterest | Bluesky | Threads |
| ---------------- | ------- | --------- | ---------- | ------- | ------- | -------- | -------- | -------- | --------- | ------- | ------- |
| **Publish**      | Yes     | Yes       | Yes        | Yes     | Yes     | Yes      | Yes      | Yes      | Yes       | Yes     | Yes     |
| **Schedule**     | Yes     | No        | Yes        | Yes     | No      | Yes      | No       | No       | Yes       | No      | No      |
| **Analytics**    | Yes     | Yes       | Yes        | Yes     | Yes     | Yes      | Yes      | Yes      | Yes       | No      | Yes     |
| **Comments**     | Yes     | Yes       | Yes        | Yes     | No      | Yes      | No       | No       | No        | No      | Yes     |
| **Replies**      | Yes     | Yes       | Yes        | Yes     | No      | Yes      | No       | No       | No        | No      | Yes     |
| **Threading**    | Yes     | Yes       | No         | No      | No      | No       | No       | No       | No        | No      | No      |
| **Images**       | Yes     | Yes       | Yes        | No      | Yes     | Yes      | Yes      | Yes      | Yes       | Yes     | Yes     |
| **Videos**       | Yes     | Yes       | Yes        | Yes     | Yes     | Yes      | Yes      | Yes      | Yes       | No      | Yes     |
| **GIFs**         | Yes     | No        | No         | No      | No      | No       | No       | No       | No        | No      | No      |
| **Stories**      | No      | Yes       | Yes        | No      | No      | No       | No       | Yes      | No        | No      | No      |
| **Reels/Shorts** | No      | Yes       | Yes        | Yes     | No      | No       | No       | No       | No        | No      | No      |
| **Carousel**     | Yes     | Yes       | Yes        | No      | Yes     | Yes      | Yes      | No       | No        | Yes     | Yes     |
| **Hashtags**     | Unknown | Yes       | Yes        | Unknown | Yes     | Unknown  | Unknown  | Unknown  | Unknown   | Unknown | Yes     |
| **Mentions**     | Yes     | Yes       | Yes        | No      | No      | No       | No       | No       | No        | Yes     | No      |
| **Links**        | Unknown | Unknown   | Unknown    | Unknown | Unknown | Unknown  | Unknown  | Unknown  | Unknown   | Yes     | Unknown |
| **Polls**        | Yes     | No        | In stories | No      | No      | Yes      | Yes      | No       | No        | No      | No      |

## Per-Provider Details

### X (Twitter)

- **Auth**: OAuth 2.0 PKCE (S256)
- **Max characters**: 280
- **Max images**: 4
- **Max video duration**: Unknown (the adapter declares none)
- **Polls**: Up to 4 options, 5min–7day duration
- **Quote tweets**: Supported via `quote_tweet_id`
- **Thread publishing**: Multi-tweet threads with reply chaining
- **Rate limits**: 300 calls per 3 hours (`rateLimitHints`)
- **Webhook events**: tweets created and deleted, likes, replies, retweets, follows and direct messages (`xWebhookProcessor`)

### Instagram

- **Auth**: OAuth 2.0 through `api.instagram.com/oauth/authorize`; the adapter takes `accessToken` and `userId`
- **Max characters**: 2,200
- **Max images**: 20 (carousel; `maxMediaPerPost`)
- **Max video duration**: Unknown (the adapter declares none)
- **Content types**: Feed post, Story, Reel, Carousel
- **Comments**: Read via `GET /{media-id}/comments`, reply via `POST /{comment-id}/replies`
- **Thread publishing**: Carousel posts with multiple images
- **Webhook events**: Comments, mentions, story insights

### Facebook

- **Auth**: Facebook Login / Pages API
- **Max characters**: 63,206
- **Max images**: 10
- **Max video duration**: Unknown (the adapter declares none)
- **Content types**: Post, Story, Reel; the API client's `postWithLink` is not on the publish path
- **Scheduling**: Native via `scheduled_publish_time` parameter
- **Comments**: Read via `GET /{post-id}/comments`, reply via `POST /{comment-id}/comments`
- **Webhook events**: feed, comments, mentions, page updates and live videos (`facebookWebhookProcessor`)

### YouTube

- **Auth**: Google OAuth 2.0
- **Max characters**: 5,000 (description)
- **Max video duration**: Unknown; a 9:16 video of at most 60 seconds is published as a Short
- **Content types**: Video, Short, Live Stream
- **Comments**: Read via `commentThreads.list`, reply via `comments.insert`
- **Analytics**: Views, likes, comments, shares, watch time, subscribers gained
- **Quota**: Unknown; the adapter's `rateLimitHints` are 100 calls per hour
- **Webhook events**: videos published and updated, comments, channel and analytics updates (`youtubeWebhookProcessor`)

### TikTok

- **Auth**: TikTok Login Kit (OAuth 2.0)
- **Max characters**: 2,200
- **Max images**: 35 (photo carousel)
- **Max video duration**: Unknown (the 180 seconds of `videoProcessorHelpers.ts` is not on the publish path)
- **Content types**: Video, Photo carousel
- **Photo posts**: Up to 35 images via Content Publishing API
- **Hashtag strategy**: Automated via Research API (requires special approval)
- **Rate limits**: ~50 requests/hour
- **Webhook events**: Video status changes

### LinkedIn

- **Auth**: LinkedIn OAuth 2.0 (3-legged)
- **Max characters**: 3,000
- **Max images**: 9 (multi-image; `maxMediaPerPost`)
- **Max video duration**: Unknown (the adapter declares none)
- **Content types**: Text post, Image post, Multi-image, Video, Document (PDF), Poll
- **Polls**: Up to 4 options, 1–14 day duration
- **Documents**: PDF carousel via document upload API
- **Comments**: Read via `GET /socialActions/{activityUrn}/comments`, reply with `parentComment`
- **Webhook events**: comments (created, edited, deleted, admin), likes, shares and share mentions (`linkedinWebhookProcessor`)

### Telegram

- **Auth**: Bot API token
- **Max characters**: 4,096
- **Max images**: 10 (media group)
- **Max video duration**: Unknown (the adapter declares none)
- **Content types**: Text, Photo, Video, Poll, Media group; documents and audio are not on the publish path
- **Polls**: Quiz and regular polls via `sendPoll`
- **Message editing**: `editMessageText` (within 48 hours)
- **Message deletion**: `deleteMessage` (within 48 hours)
- **Inline keyboards**: `reply_markup` support on all send methods
- **Limitations**: no comments or replies (`comments: false`, `replies: false`); analytics come through `fetchAnalytics`
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

- **Auth**: AT Protocol app password (`identifier`, `appPassword`); no OAuth
- **Max characters**: 300, checked as JavaScript string length
- **Max images**: 4
- **Max video duration**: no video (`allowedMedia: ["image"]`)
- **Content types**: Post, with up to 4 images
- **Threading**: No (`threading: false`, `maxPostsPerThread: 1`)
- **Comments/Replies**: No (`comments: false`, `replies: false`)
- **Mentions**: ingested through `searchMentions`; in a post, the facets `detectFacets` finds, minus any mention whose handle did not resolve (an empty DID, which the lexicon rejects), dropped before posting as the official app does
- **Links**: link facets from `detectFacets` (`linkCards: true`); no external card embed is built
- **Hashtags**: hashtag and cashtag tag facets from `detectFacets` are published (`#omnipost` as tag `omnipost`, `$aapl` as tag `$AAPL`), pinned by `packages/providers/bluesky/tests/BlueskyClient.sdk.test.ts`
- **Limitations**: No analytics API, no scheduling API, no polls, no stories
- **Webhook events**: none; there is no webhook processor and no firehose client

### Threads

- **Auth**: OAuth per the adapter's metadata (`accessToken` and `userId` credentials); the API's connect flow does not implement it
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

| Provider  | Auth Type                                           | Required Scopes                                                                              |
| --------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| X         | OAuth 2.0 PKCE                                      | `tweet.read`, `tweet.write`, `users.read`                                                    |
| Instagram | OAuth 2.0 (`api.instagram.com`)                     | `instagram_basic`, `instagram_content_publish`                                               |
| Facebook  | Facebook Login                                      | `pages_manage_posts`, `pages_read_engagement`                                                |
| YouTube   | Google OAuth 2.0                                    | `youtube.upload`, `youtube.readonly`                                                         |
| TikTok    | OAuth 2.0                                           | `video.upload`, `user.info.basic`                                                            |
| LinkedIn  | OAuth 2.0                                           | `w_member_social`, `w_organization_social`, `openid`, `profile`                              |
| Telegram  | Bot Token                                           | N/A (bot token is the auth)                                                                  |
| Snapchat  | OAuth 2.0                                           | `snapchat-marketing-api`, `snapchat-profile-api`                                             |
| Pinterest | OAuth 2.0                                           | `boards:read`, `boards:write`, `pins:read`, `pins:write`, `user_accounts:read`               |
| Bluesky   | AT Protocol                                         | N/A (`identifier` and `appPassword`)                                                         |
| Threads   | OAuth; the API's connect flow does not implement it | `threads_basic`, `threads_content_publish`, `threads_read_replies`, `threads_manage_replies` |

## Rate Limits

Burst and Window are each adapter's `rateLimitHints` (`burst` calls per `perSeconds`). The limits each provider enforces are not recorded in the packages, so every Notes cell reads Unknown.

| Provider  | Burst | Window   | Notes   |
| --------- | ----- | -------- | ------- |
| X         | 300   | 3 hours  | Unknown |
| Instagram | 25    | 24 hours | Unknown |
| Facebook  | 200   | 1 hour   | Unknown |
| YouTube   | 100   | 1 hour   | Unknown |
| TikTok    | 50    | 1 hour   | Unknown |
| LinkedIn  | 100   | 24 hours | Unknown |
| Telegram  | 30    | 1 second | Unknown |
| Snapchat  | 20    | 1 second | Unknown |
| Pinterest | 100   | 1 second | Unknown |
| Bluesky   | 100   | 1 hour   | Unknown |
| Threads   | 60    | 24 hours | Unknown |

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
| Bluesky   | N/A                         | No processor         |
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
