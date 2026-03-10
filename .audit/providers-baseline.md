# Provider Audit Baseline

> Generated: 2026-03-10 | Branch: Genesis

## Provider Overview

| Provider  | Adapter Lines | API Client Lines | Total src | Webhook | Tests    |
| --------- | ------------- | ---------------- | --------- | ------- | -------- |
| X         | 362           | 299              | 685       | Yes     | 4 files  |
| Instagram | 709           | 559              | 2,975     | Yes     | 11 files |
| Facebook  | 464           | 563              | 1,189     | Yes     | 1 file   |
| YouTube   | 471           | 574              | 4,860     | Yes     | 5 files  |
| TikTok    | 432           | 467              | 4,850     | Yes     | 3 files  |
| LinkedIn  | 370           | 387              | 1,054     | **No**  | 1 file   |
| Telegram  | 399           | 380              | 797       | **No**  | 1 file   |
| Snapchat  | 314           | 344              | 962       | **No**  | 1 file   |
| Pinterest | 386           | 353              | 778       | **No**  | 1 file   |

## Method Implementation Matrix

| Method         | X        | IG       | FB       | YT       | TT       | LI   | TG  | SC  | PI  |
| -------------- | -------- | -------- | -------- | -------- | -------- | ---- | --- | --- | --- |
| render         | Y        | Y        | Y        | Y        | Y        | Y    | Y   | Y   | Y   |
| publish        | Y        | Y        | Y        | Y        | Y        | Y    | Y   | Y   | Y   |
| planThread     | Y        | Y        | N        | N        | N        | err  | err | err | err |
| publishThread  | Y        | Y        | N        | N        | N        | err  | err | err | err |
| fetchAnalytics | Y        | Y        | Y        | Y        | Y        | Y    | N   | Y   | Y   |
| getComments    | N        | N        | N        | N        | N        | Y    | N   | N   | N   |
| postReply      | N        | N        | N        | N        | N        | stub | N   | N   | N   |
| handleWebhook  | via proc | via proc | via proc | via proc | via proc | N    | N   | N   | N   |

Legend: Y = implemented, N = not implemented, err = returns error, stub = returns NotImplemented, via proc = separate webhook processor

## Capabilities Declared per Adapter

| Capability | X   | IG  | FB  | YT  | TT  | LI  | TG  | SC  | PI  |
| ---------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| publish    | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   |
| schedule   | Y   | Y   | Y   | Y   | N   | Y   | N   | N   | Y   |
| analytics  | Y   | Y   | Y   | Y   | Y   | Y   | N   | Y   | Y   |
| comments   | Y   | Y   | Y   | Y   | N   | Y   | N   | N   | N   |
| replies    | Y   | N   | N   | N   | N   | Y   | N   | N   | N   |
| threading  | Y   | Y   | N   | N   | N   | N   | N   | N   | N   |
| media      | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   |
| images     | Y   | Y   | Y   | N   | N   | Y   | Y   | Y   | Y   |
| videos     | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   | Y   |

## API Client Methods per Provider

### X (XApiClient)

- validateCredentials, postTweet, uploadMedia, getTweetAnalytics, deleteTweet
- Circuit breaker management (status, clearCache, forceOpen/Close)

### Instagram (InstagramApiClient)

- validateCredentials, createStoriesContainer, createMediaContainer, createReelsContainer
- createCarouselContainer, publishMedia, getContainerStatus, getMediaDetails
- getUserMedia, getMediaInsights, getUserInsights, uploadMediaToHost
- Circuit breaker management

### Facebook (FacebookApiClient)

- validateCredentials, getPageInfo, getBusinessAccount, validateLongLivedToken
- exchangeForLongLivedToken, getAppAccessToken, uploadMedia, uploadUnpublishedMedia
- batchUploadMedia, postToPage, getPageInsights, getRateLimitStatus
- Circuit breaker management

### YouTube (YouTubeApiClient)

- validateCredentials, uploadVideo, getChannelAnalytics, deleteVideo
- getVideoDetails, searchVideos, updateVideo, uploadThumbnail, getChannelStats
- refreshToken, nested services (analytics, liveStreaming, community, shorts, playlists)
- Circuit breaker management

### TikTok (TikTokApiClient)

- validateCredentials, uploadVideo, getUserInfo, getUserVideos, refreshToken
- Lazy-loaded clients (marketing, research, analytics, auth, videoProcessor, hashtagManager)
- Circuit breaker management

### LinkedIn (LinkedInApiClient)

- getProfile, createPost, initializeImageUpload, initializeVideoUpload
- uploadMediaBinary, getComments, postComment, getPostAnalytics
- Circuit breaker management

### Telegram (TelegramApiClient)

- validateCredentials, getChatMember, sendMessage, sendPhoto, sendVideo, sendMediaGroup
- Circuit breaker management

### Snapchat (SnapchatApiClient)

- validateCredentials, uploadMedia, createStory, getStoryAnalytics, refreshAccessToken
- Circuit breaker management

### Pinterest (PinterestApiClient)

- createPin, getPin, getPinAnalytics, getUserAccount, getBoards
- Circuit breaker management

## Limits per Provider

| Limit     | X     | IG    | FB     | YT    | TT    | LI    | TG    | SC  | PI  |
| --------- | ----- | ----- | ------ | ----- | ----- | ----- | ----- | --- | --- |
| maxChars  | 280   | 2,200 | 63,206 | 5,000 | 2,200 | 3,000 | 4,096 | 250 | 500 |
| maxMedia  | 4     | 10    | 10     | 1     | 1     | 9     | 10    | 1   | 1   |
| threading | Y(25) | Y     | N      | N     | N     | N     | N     | N   | N   |
| rateBurst | 300   | 200   | 200    | 100   | 50    | 100   | 30    | 20  | 100 |

## Domain Registry Coverage

### PROVIDERS constant (Provider.ts) — 5/9

Registered: X, INSTAGRAM, FACEBOOK, YOUTUBE, TIKTOK
Missing: LINKEDIN, TELEGRAM, SNAPCHAT, PINTEREST

### PROVIDER_CAPABILITIES (Provider.ts) — 5/9

Same coverage as above.

### Webhook Processors (webhookHandlerCore.ts) — 5/9

Registered: X, Instagram, Facebook, YouTube, TikTok
Missing: LinkedIn, Telegram, Snapchat, Pinterest (N/A)

## Risks

- Instagram adapter at 709 lines — near 800-line limit
- LinkedIn postReply returns NotImplemented despite API support
- Telegram has no analytics capability (Bot API limitation)
- Snapchat organic API is inherently limited
- Pinterest API v5 has no webhook support
