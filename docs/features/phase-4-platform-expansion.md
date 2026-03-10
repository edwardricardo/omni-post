# Phase 4: Platform Expansion + Quick Wins

## Overview

Phase 4 expands OmniPost with 4 new social media providers (Snapchat, Telegram, Pinterest, LinkedIn) and 4 cross-cutting features: Slack/Teams webhook notifications, first comment scheduling, AI image generation, and recurring posts. This phase broadens platform reach while delivering high-value quick wins that leverage existing infrastructure.

## New Providers

### Snapchat Provider

**API:** Snapchat Public Profile API (Marketing API subset)
**Auth:** OAuth 2.0 with PKCE
**Content Types:** Stories, Spotlight videos
**Rate Limits:** 20 requests/second

**Key Implementation Details:**

- Media upload via pre-signed URL (similar to S3 flow)
- Stories expire after 24 hours — publish status auto-transitions to EXPIRED
- Spotlight supports vertical video (9:16 aspect ratio, max 60s)
- Webhook support for content moderation events

**Provider Adapter:** `packages/providers/snapchat/`

### Telegram Provider

**API:** Telegram Bot API (HTTP-based)
**Auth:** Bot token (no OAuth — token provisioned via BotFather)
**Content Types:** Channel posts, group messages
**Constraints:** 4096 character limit per message, 30 messages/second rate limit

**Key Implementation Details:**

- Bot must be admin of target channel/group
- Supports Markdown and HTML formatting
- Media groups (albums) via `sendMediaGroup` endpoint
- Silent messages via `disable_notification` parameter
- No webhook verification needed — bot token acts as auth

**Provider Adapter:** `packages/providers/telegram/`

### Pinterest Provider

**API:** Pinterest API v5
**Auth:** OAuth 2.0
**Content Types:** Pins (image/video), board management
**Rate Limits:** 100 calls/second/user

**Key Implementation Details:**

- Pins require a `board_id` — board selection in composer
- Image pins: JPEG/PNG, max 32MB
- Video pins: MP4, max 2GB, 4s–15min
- Rich metadata: link, alt text, note (description)
- Board sections supported for sub-categorization

**Provider Adapter:** `packages/providers/pinterest/`

### LinkedIn Provider

**API:** LinkedIn Posts API (REST, versioned)
**Auth:** OAuth 2.0 with `w_member_social` and `w_organization_social` scopes
**Content Types:** Text posts, articles, image posts, document (carousel) posts
**Rate Limits:** Versioned API headers required (`LinkedIn-Version: 202401`)

**Key Implementation Details:**

- 2-step media upload: (1) register upload via `POST /rest/images`, (2) upload binary to provided URL
- Personal posts (`urn:li:person:{id}`) vs organization posts (`urn:li:organization:{id}`)
- Document posts (PDF carousels) via `POST /rest/documents` register + upload
- Rich text supports mentions (`urn:li:person:{id}` annotations)
- 3000 character limit for post text
- API versioning via `LinkedIn-Version` header — pinned to stable version

**Provider Adapter:** `packages/providers/linkedin/`

## Slack/Teams Notifications

Webhook-based outbound notifications for post lifecycle events. Leverages the existing notification infrastructure (Phase 1) with new delivery channels.

**Architecture:**

- `SlackWebhookAdapter` and `TeamsWebhookAdapter` implement `NotificationDeliveryPort`
- Webhook URLs stored per-project in `NotificationChannel` model
- Events: PostPublished, PostFailed, ApprovalRequested, ApprovalCompleted, CrisisModeEntered
- Rich message formatting: Slack Block Kit, Teams Adaptive Cards
- Retry with exponential backoff on 429/5xx responses

**Configuration per project:**

- `slackWebhookUrl` — Slack incoming webhook URL
- `teamsWebhookUrl` — Microsoft Teams incoming webhook URL
- `notifyOn` — Array of event types to send

**API Endpoints (2):**

| Method | Route                                     | Description                        |
| ------ | ----------------------------------------- | ---------------------------------- |
| PUT    | `/api/projects/:id/notification-channels` | Configure Slack/Teams webhook URLs |
| GET    | `/api/projects/:id/notification-channels` | Get notification channel config    |

## First Comment Scheduling

Auto-post a first comment immediately after a post is published. Commonly used for hashtag blocks, CTAs, or engagement prompts.

**Domain Model:**

- `FirstComment` value object on `PostAggregate` (optional content string + provider-specific metadata)
- Stored alongside post, published via a follow-up job after successful publish

**Workflow:**

1. User sets `firstComment` content when creating/scheduling a post
2. On `PostPublished` event, a delayed BullMQ job fires after 5-second delay
3. Job calls provider's `createComment(postExternalId, commentText)` method
4. Result stored as `FirstCommentResult` (success/failure + external comment ID)

**Provider Support:**

| Provider  | Supported | Notes                               |
| --------- | --------- | ----------------------------------- |
| X         | Yes       | Reply to own tweet                  |
| Instagram | Yes       | Comment on own media                |
| Facebook  | Yes       | Comment on own post                 |
| YouTube   | Yes       | Comment on own video                |
| TikTok    | No        | API does not support comments       |
| LinkedIn  | Yes       | Comment on own post                 |
| Pinterest | No        | Pins do not support comments        |
| Telegram  | No        | Bot reply (not a "comment" concept) |
| Snapchat  | No        | No comment API                      |

**API Endpoints (2):**

| Method | Route                          | Description                      |
| ------ | ------------------------------ | -------------------------------- |
| PUT    | `/api/posts/:id/first-comment` | Set/update first comment content |
| DELETE | `/api/posts/:id/first-comment` | Remove first comment             |

## AI Image Generation

Generate images from text prompts using DALL-E 3 via the existing `AIServicePort`. Generated images are stored in the database and available for use in posts.

**Domain Model:**

- `GeneratedImage` entity: id, prompt, revisedPrompt (DALL-E may revise), imageUrl, size, style, quality, createdAt
- Stored in `generated_images` table, linked to project

**Generation Options:**

- Sizes: 1024x1024, 1024x1792 (portrait), 1792x1024 (landscape)
- Styles: `natural`, `vivid`
- Quality: `standard`, `hd`

**Workflow:**

1. User submits prompt + options via API
2. `GenerateImageUseCase` delegates to `AIServicePort.generateImage()`
3. DALL-E 3 returns image URL (temporary)
4. Image downloaded and stored via `StoragePort` (S3/Cloudinary)
5. Permanent URL + metadata persisted in DB

**API Endpoints (3):**

| Method | Route                               | Description                |
| ------ | ----------------------------------- | -------------------------- |
| POST   | `/api/projects/:id/images/generate` | Generate image from prompt |
| GET    | `/api/projects/:id/images`          | List generated images      |
| DELETE | `/api/images/:id`                   | Delete generated image     |

## Recurring Posts

Template-based recurring posts using cron expressions and BullMQ repeatable jobs.

**Domain Model:**

- `RecurringPost` entity: id, projectId, templateContent, cronExpression, timezone, nextRunAt, status (ACTIVE/PAUSED/COMPLETED), maxOccurrences, occurrenceCount
- `RecurringPostExecution` join record: tracks each generated post instance

**Workflow:**

1. User creates recurring post with template content + cron expression + target channels
2. `CreateRecurringPostUseCase` registers a BullMQ repeatable job
3. On each trigger, `ProcessRecurringPostJob` worker:
   - Clones template into a new `Post` aggregate
   - Applies variable substitutions (e.g., `{{date}}`, `{{occurrence}}`)
   - Schedules for immediate publish
4. Tracks occurrence count, stops at `maxOccurrences` if set

**Cron Examples:**

- `0 9 * * 1` — Every Monday at 9:00 AM
- `0 12 * * *` — Daily at noon
- `0 10 1 * *` — First of each month at 10:00 AM

**API Endpoints (5):**

| Method | Route                               | Description                        |
| ------ | ----------------------------------- | ---------------------------------- |
| POST   | `/api/projects/:id/recurring-posts` | Create recurring post              |
| GET    | `/api/projects/:id/recurring-posts` | List recurring posts               |
| GET    | `/api/recurring-posts/:id`          | Get recurring post details         |
| PATCH  | `/api/recurring-posts/:id`          | Update recurring post (or pause)   |
| DELETE | `/api/recurring-posts/:id`          | Delete recurring post + cancel job |

## Schema Changes

### New Provider Enum Values

```prisma
enum Provider {
  // existing...
  SNAPCHAT
  TELEGRAM
  PINTEREST
  LINKEDIN
}
```

### New Models

| Model                    | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `GeneratedImage`         | AI-generated images with prompt and storage URL      |
| `RecurringPost`          | Recurring post template with cron schedule           |
| `RecurringPostExecution` | Tracks each instance generated from a recurring post |
| `NotificationChannel`    | Slack/Teams webhook config per project               |

## API Endpoints Summary

| #   | Method | Route                                     | Feature             |
| --- | ------ | ----------------------------------------- | ------------------- |
| 1   | PUT    | `/api/projects/:id/notification-channels` | Slack/Teams config  |
| 2   | GET    | `/api/projects/:id/notification-channels` | Slack/Teams config  |
| 3   | PUT    | `/api/posts/:id/first-comment`            | First comment       |
| 4   | DELETE | `/api/posts/:id/first-comment`            | First comment       |
| 5   | POST   | `/api/projects/:id/images/generate`       | AI image generation |
| 6   | GET    | `/api/projects/:id/images`                | AI image generation |
| 7   | DELETE | `/api/images/:id`                         | AI image generation |
| 8   | POST   | `/api/projects/:id/recurring-posts`       | Recurring posts     |
| 9   | GET    | `/api/projects/:id/recurring-posts`       | Recurring posts     |
| 10  | GET    | `/api/recurring-posts/:id`                | Recurring posts     |
| 11  | PATCH  | `/api/recurring-posts/:id`                | Recurring posts     |
| 12  | DELETE | `/api/recurring-posts/:id`                | Recurring posts     |
| 13  | POST   | `/api/channels` (with new provider types) | New providers       |
| 14  | POST   | `/api/channels/:id/oauth/callback`        | New provider OAuth  |

## DI Tokens Added (~22)

| Group            | Tokens                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers (4)    | `SNAPCHAT_PROVIDER`, `TELEGRAM_PROVIDER`, `PINTEREST_PROVIDER`, `LINKEDIN_PROVIDER`                                                                                                                                                                                                                                                 |
| Repositories (4) | `GENERATED_IMAGE_REPOSITORY`, `RECURRING_POST_REPOSITORY`, `NOTIFICATION_CHANNEL_REPOSITORY`, `RECURRING_POST_EXECUTION_REPOSITORY`                                                                                                                                                                                                 |
| Use Cases (10)   | `GENERATE_IMAGE_USE_CASE`, `LIST_GENERATED_IMAGES_USE_CASE`, `DELETE_GENERATED_IMAGE_USE_CASE`, `CREATE_RECURRING_POST_USE_CASE`, `LIST_RECURRING_POSTS_USE_CASE`, `GET_RECURRING_POST_USE_CASE`, `UPDATE_RECURRING_POST_USE_CASE`, `DELETE_RECURRING_POST_USE_CASE`, `SET_FIRST_COMMENT_USE_CASE`, `REMOVE_FIRST_COMMENT_USE_CASE` |
| Adapters (2)     | `SLACK_WEBHOOK_ADAPTER`, `TEAMS_WEBHOOK_ADAPTER`                                                                                                                                                                                                                                                                                    |
| Services (2)     | `NOTIFICATION_CHANNEL_SERVICE`, `RECURRING_POST_SCHEDULER`                                                                                                                                                                                                                                                                          |
