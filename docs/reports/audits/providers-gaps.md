# Provider Gap Analysis

> Generated: 2026-03-10 | Based on official API research

## Gap Summary

| Provider  | Gaps to Close                                                        | Priority |
| --------- | -------------------------------------------------------------------- | -------- |
| LinkedIn  | Documents, polls, webhook processor                                  | High     |
| Telegram  | Polls, documents, audio, edit/delete, pin, inline keyboards, webhook | High     |
| Snapchat  | Webhook processor (polling-based, no native webhooks)                | Medium   |
| Pinterest | Board creation, board sections, wire pin analytics                   | Medium   |
| X         | getComments, postReply, polls, quote tweets                          | High     |
| Instagram | getComments, postReply (extract to comments.ts)                      | High     |
| Facebook  | getComments, postReply, scheduled posts, link sharing                | High     |
| YouTube   | getComments, postReply, playlist management                          | High     |
| TikTok    | Photo carousel publishing                                            | Medium   |

## Per-Provider Gap Tables

### LinkedIn

| Capability           | Status                | API Support                                       | Notes                         |
| -------------------- | --------------------- | ------------------------------------------------- | ----------------------------- |
| Document posts (PDF) | **Missing**           | YES — `/rest/documents` + initializeUpload        | Max 100MB, 300 pages          |
| Polls                | **Missing**           | YES — poll object in `/rest/posts`                | 2-4 options, duration enum    |
| Webhook processor    | **Missing**           | YES — HMAC-SHA256, `X-LI-Signature` header        | Challenge/response validation |
| getComments          | Implemented           | YES                                               | Already in apiClient          |
| postReply            | Stub (NotImplemented) | YES — `w_member_social` / `w_organization_social` | Wire existing `postComment()` |

### Telegram

| Capability            | Status      | API Support                                    | Notes                             |
| --------------------- | ----------- | ---------------------------------------------- | --------------------------------- |
| sendPoll              | **Missing** | YES — 2-10 options, regular/quiz types         | open_period or close_date         |
| sendDocument          | **Missing** | YES — max 50MB                                 | PDF/ZIP by URL                    |
| sendAudio             | **Missing** | YES — audio/mpeg                               | performer, title fields           |
| editMessageText       | **Missing** | YES — bot's own messages only                  | InlineKeyboardMarkup only         |
| deleteMessage         | **Missing** | YES — 48h window, or anytime if admin          | bulk: deleteMessages              |
| pinChatMessage        | **Missing** | YES — needs can_pin_messages right             | silent pin option                 |
| getChatMemberCount    | **Missing** | YES — separate from getChat                    | Analytics proxy                   |
| Inline keyboards      | **Missing** | YES — callback_data, url, web_app              | Array of button rows              |
| Webhook processor     | **Missing** | YES — `X-Telegram-Bot-Api-Secret-Token` header | secret_token verification         |
| fetchAnalytics        | N/A         | NO — Bot API has no analytics                  | Use getChatMemberCount as proxy   |
| getComments/postReply | N/A         | NO — Not applicable to Telegram                | Telegram is messaging, not social |

### Snapchat

| Capability            | Status      | API Support             | Notes                                         |
| --------------------- | ----------- | ----------------------- | --------------------------------------------- |
| Webhook processor     | **Missing** | NO native webhooks      | Implement polling-based creative status check |
| getComments/postReply | N/A         | NO — No API access      | Platform limitation                           |
| Spotlight             | N/A         | Requires partner access | Not feasible                                  |

### Pinterest

| Capability            | Status      | API Support                             | Notes                            |
| --------------------- | ----------- | --------------------------------------- | -------------------------------- |
| Board creation        | **Missing** | YES — `POST /v5/boards`                 | name, description, privacy       |
| Board sections        | **Missing** | YES — `POST /v5/boards/{id}/sections`   | name only                        |
| Pin analytics (wired) | Partial     | YES — apiClient has `getPinAnalytics()` | Not called from fetchAnalytics() |
| Webhooks              | N/A         | NO — Pinterest has no webhook API       | Use polling if needed            |
| getComments/postReply | N/A         | NO — Not in Pinterest API v5            | Platform limitation              |

### X (Twitter)

| Capability   | Status      | API Support                                      | Notes                                     |
| ------------ | ----------- | ------------------------------------------------ | ----------------------------------------- |
| getComments  | **Missing** | YES — `conversation_id` search/recent            | Basic tier ($100/mo) for useful volume    |
| postReply    | **Missing** | YES — existing `postTweet()` with replyToTweetId | Already supported in apiClient            |
| Polls        | **Missing** | YES — `poll.options[]` + `duration_minutes`      | 2-4 options, 5-10080 min, all tiers       |
| Quote tweets | **Missing** | YES — `quote_tweet_id` parameter                 | Mutually exclusive with poll/media        |
| Webhooks     | Exists      | YES — Account Activity API v2                    | Pro tier ($5K/mo), already have processor |

### Instagram

| Capability         | Status      | API Support                        | Notes                                                  |
| ------------------ | ----------- | ---------------------------------- | ------------------------------------------------------ |
| getComments        | **Missing** | YES — `GET /{media-id}/comments`   | Cursor-based, max 50/page, replies via field expansion |
| postReply          | **Missing** | YES — `POST /{comment-id}/replies` | `instagram_manage_comments` scope                      |
| Comment moderation | **Missing** | YES — hide/delete/disable          | Low priority                                           |
| **File size risk** | CRITICAL    | N/A                                | Adapter at 709 lines — extract comments to comments.ts |

### Facebook

| Capability      | Status      | API Support                                        | Notes                            |
| --------------- | ----------- | -------------------------------------------------- | -------------------------------- |
| getComments     | **Missing** | YES — `GET /{post-id}/comments`                    | Cursor-based, 2-level threading  |
| postReply       | **Missing** | YES — `POST /{comment-id}/comments`                | `pages_manage_engagement` scope  |
| Scheduled posts | **Missing** | YES — `published=false` + `scheduled_publish_time` | Unix timestamp, 10min-6mo window |
| Link sharing    | **Missing** | YES — `link` parameter in feed post                | OG preview auto-generated        |

### YouTube

| Capability        | Status      | API Support                           | Notes                                       |
| ----------------- | ----------- | ------------------------------------- | ------------------------------------------- |
| getComments       | **Missing** | YES — `commentThreads.list`           | videoId param, 1-100 per page, 1 quota unit |
| postReply         | **Missing** | YES — `comments.insert` with parentId | 50 quota units per call                     |
| Playlist create   | **Missing** | YES — `playlists.insert`              | 50 quota units, title required              |
| Playlist add item | **Missing** | YES — `playlistItems.insert`          | 50 quota units, position optional           |
| Quota limit       | Concern     | 10,000 units/day default              | Writes are expensive (50 units each)        |

### TikTok

| Capability     | Status           | API Support                                   | Notes                               |
| -------------- | ---------------- | --------------------------------------------- | ----------------------------------- |
| Photo carousel | **Missing**      | YES — `media_type: "PHOTO"`, `photo_images[]` | Up to 35 images, title max 90 chars |
| getComments    | **Not feasible** | Research API only (academic access)           | Cannot implement for commercial use |
| postReply      | **Not feasible** | NO — No API endpoint exists                   | Platform limitation                 |

## Revised Plan Based on Research

### Changes from original plan:

1. **Snapchat webhooks**: No native webhook support — implement polling-based status checker instead
2. **TikTok comments**: Remove from scope — Research API only (academic), no write API exists
3. **Pinterest webhooks**: Confirmed N/A — no webhook API
4. **LinkedIn postReply**: Already has apiClient method — just wire it in adapter
5. **X webhooks**: Already have processor — Pro tier only, document requirement

### Implementation Order (unchanged):

1. LinkedIn → 2. Telegram → 3. Snapchat → 4. Pinterest → 5. X → 6. Instagram → 7. Facebook → 8. YouTube → 9. TikTok → 10. Registry → 11. Docs
