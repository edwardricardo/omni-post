# Research: media storage providers and upload limits (2026-10-04)

- **Date**: 2026-10-04
- **Purpose**: the evidence behind the owner's storage decisions of 2026-10-04, recorded in
  [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md) and
  [ADR-0029](../technical/ADR-0029-media-upload-limits.md), and specified in
  [media-storage.md](../features/media-storage.md).
- **Method**: two read-only research passes for Edward. Report 1, on upload size limits, is
  reproduced **verbatim**; only markdown formatting was adjusted so prettier accepts the file, and
  no wording, figure or URL was changed. Report 2, on storage providers, existed only as a compact
  memory record (engram observation 1148, topic `storage/selectable-providers-health-upload-plan`);
  it is rendered here as prose with its facts intact.
- **Evidence labels**: Report 1 marks each figure **VERIFIED** (read by the worker in the official
  source) or **UNVERIFIED** (third party, the worker's own inference, or a search-engine excerpt of
  an official page that returned HTTP 403). Report 2 was taken from primary vendor documentation and
  from the SDK typings installed in the repository; it carries no per-claim labels.
- **This is research, not a vendor commitment.** Network limits change often: X, Bluesky and
  LinkedIn all moved in 2025 and 2026. Re-verify a figure against its source before relying on it.

## Contents

1. Upload size limits: competitors, the 11 networks' official API limits, recommended caps.
2. Storage providers: health signals, upload-size enforcement per provider, migration between
   platforms.

---

## Report 1: Upload size limits

Worker report `upload-size-limits.md`, reproduced verbatim.

## Upload size limits: competitors, network APIs, and recommended caps

I read every figure here on 2026-10-04.

- **VERIFIED** means I read the figure in the official source myself.
- **UNVERIFIED** means it comes from a third party, from my own inference, or from a search-engine excerpt of an official page I could not open. The pages I could not open returned HTTP 403: Sprout Social, Later, SocialBee, Sendible, Vista Social, Planable and Loomly.

### 1. Competitors' upload limits

| Tool          | Image                                                                                                                | GIF                                            | Video                                                                                                                                                                                            | PDF / document                                          | Varies by plan?                                  | When limits are checked                                                                               | Status / source                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buffer        | Must be under 10 MB overall. Per network: FB and IG 8 MB, X 5 MB, LinkedIn 10 MB, TikTok 20 MB, Bluesky 1 MB         | 15 MB (X, Bluesky, Substack)                   | IG 300 MB; FB, X, LinkedIn, Pinterest, TikTok and Threads 1 GB; Bluesky 100 MB; YouTube Shorts 10 GB. The LinkedIn 1 GB is Buffer's own cap                                                      | LinkedIn 100 MB / 300 pages                             | Not stated                                       | Both. The composer catches some per-network errors before scheduling; the rest fail at publish        | VERIFIED: support.buffer.com/en-us/articles/sharing-videos-through-buffer-LOe2p2rnAI, …/ideal-image-sizes-and-formats-for-your-buffer-posts-JxHNGZFvf9, …/troubleshooting-video-uploads-in-buffer-LK0CldlFNB |
| Hootsuite     | Compresses images up to 20 MB automatically. Per network: IG, FB and Threads 8 MB; LinkedIn and X 5 MB; Bluesky 1 MB | X 5 MB, ≤350 frames; GIFs are never compressed | Only YouTube is stated (1 GB). Hootsuite processes and compresses video                                                                                                                          | unknown                                                 | unknown                                          | At upload (compression and processing)                                                                | VERIFIED: help.hootsuite.com/hc/en-us/articles/1260804249810, …/1260804250050                                                                                                                                |
| Sprout Social | About 5 MB recommended. FB and Threads 8 MB, LinkedIn 5 MB, Pinterest 10 MB, Bluesky 1 MB                            | 15 MB recommended                              | FB 3 GB, FB Reels 1 GB, IG Reels 1 GB, IG Stories 100 MB, X 512 MB, YouTube 3 GB, LinkedIn 5 GB                                                                                                  | LinkedIn 100 MB / 300 pages                             | unknown                                          | The compose guidance tells users to meet every selected network's limits                              | UNVERIFIED (excerpt): support.sproutsocial.com/hc/en-us/articles/115003659326                                                                                                                                |
| Later         | Free 5 MB, Starter 20 MB, Growth and above 100 MB                                                                    | unknown                                        | Free 25 MB; paid plans 512 MB. A second excerpt says Growth and above get 1.5 GB. Later compresses videos over 100 MB                                                                            | unknown                                                 | **Yes**                                          | Compresses at upload                                                                                  | UNVERIFIED (excerpt): help.later.com/hc/en-us/articles/360043361213                                                                                                                                          |
| Metricool     | FB 30 MB, Pinterest and TikTok 20 MB, IG and Threads 8 MB, X and LinkedIn 5 MB, Bluesky 1 MB                         | X 15 MB                                        | Mostly 500–512 MB; Threads 1 GB; Bluesky 50 MB. The mobile app imports up to 500 MB                                                                                                              | LinkedIn 100 MB                                         | Not stated                                       | **At save**: a red warning appears and the post cannot be saved. The network checks codecs at publish | VERIFIED: help.metricool.com/publishing-requirements-for-images-and-videos-from-metricool-vfc8n                                                                                                              |
| Agorapulse    | FB 30 MB, TikTok and Pinterest 20 MB, IG, LinkedIn and Threads 8 MB, X 5 MB, Bluesky 976.56 KB                       | X 15 MB                                        | FB 10 GB, IG Reels 1 GB, IG Stories and carousels 100 MB, LinkedIn 200 MB, X 512 MB, TikTok and Threads 1 GB, Pinterest 200 MB, YouTube 2 GB, Bluesky 100 MB                                     | unknown                                                 | unknown                                          | unknown                                                                                               | VERIFIED: support.agorapulse.com/en/articles/8773203                                                                                                                                                         |
| Publer        | IG and Threads 8 MB, X 5 MB, Telegram 10 MB; FB "any size"                                                           | FB 4 MB, X 15 MB, Telegram 50 MB               | FB, LinkedIn, Pinterest, YouTube and TikTok 2 GB; IG Reels and Threads 1 GB; X 512 MB; Bluesky 100 MB; Telegram 50 MB. Publer's API caps direct uploads at 200 MB per file (larger files by URL) | 100 MB (LinkedIn only)                                  | Not stated                                       | **At upload**: the API's upload response carries a per-network `validity` object                      | VERIFIED: publer.com/docs/posting/create-posts/media-handling, publer.com/help/en/article/what-post-types-are-supported-and-what-are-their-limitations-1687rte                                               |
| SocialBee     | IG 3 MB, X 3 MB, FB 4 MB, LinkedIn 8 MB, TikTok 20 MB, Bluesky 1 MB                                                  | LinkedIn 15 MB                                 | IG 300 MB, LinkedIn 200 MB, TikTok, X and FB 512 MB                                                                                                                                              | LinkedIn 100 MB / 300 pages (PDF, DOC, DOCX, PPT, PPTX) | unknown                                          | TikTok images over 20 MB fall back to a reminder at publish                                           | UNVERIFIED (excerpt): help.socialbee.com/hc/en-us/articles/29979206048535                                                                                                                                    |
| Sendible      | X 5 MB, FB 4 MB, IG and Threads 8 MB, LinkedIn 10 MB, Bluesky 1 MB                                                   | unknown                                        | 250 MB overall                                                                                                                                                                                   | unknown                                                 | unknown                                          | unknown                                                                                               | UNVERIFIED (excerpt): support.sendible.com/hc/en-us/articles/208776316, …/360001126446                                                                                                                       |
| Vista Social  | 2 GB per file, for every type                                                                                        | 2 GB                                           | 2 GB per file. Per network: FB 2 GB, IG Reels 300 MB, LinkedIn 200 MB                                                                                                                            | 2 GB                                                    | Legacy plans have a fair-use cap of 1 GB per day | unknown                                                                                               | UNVERIFIED (excerpt): support.vistasocial.com/hc/en-us/articles/4409607575963                                                                                                                                |
| Planable      | FB 8 MB                                                                                                              | unknown                                        | Most networks 1 GB; YouTube 2 GB; LinkedIn 5 GB                                                                                                                                                  | unknown                                                 | unknown                                          | unknown                                                                                               | UNVERIFIED (excerpt): help.planable.io/hc/en-us/articles/21715457579932                                                                                                                                      |
| Loomly        | 10 MB (IG and Threads 8 MB)                                                                                          | unknown                                        | Up to 1 GB supported (under 50 MB recommended); IG 100 MB; FB and YouTube 200 MB; TikTok 1 GB                                                                                                    | LinkedIn: 300 pages, no size given                      | unknown                                          | unknown                                                                                               | UNVERIFIED (excerpt): loomly.zendesk.com/hc/en-us/articles/39081702500507                                                                                                                                    |
| Iconosquare   | Media library 15 MB, but only files under 8 MB publish automatically                                                 | X 15 MB                                        | Media library 150 MB (under 100 MB to publish automatically). Its network page contradicts this: IG Reels and TikTok 1 GB, LinkedIn 500 MB, X 512 MB                                             | LinkedIn 100 MB                                         | unknown                                          | At upload (library)                                                                                   | VERIFIED: support.iconosquare.com/what-is-the-maximum-file-size-i-can-upload-in-the-media-library, …/what-photo-and-video-formats-does-iconosquare-accept-on-instagram-facebook-linkedin-and-tiktok          |

### 2. The 11 networks' official publishing-API limits

| Network (API)                                    | Image                                                                                        | GIF                          | Video                                                                                                                                                                                              | Document                                              | Status / source                                                                                                                                                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **X** (API v2 media upload)                      | ≤5 MB; JPG, PNG, GIF or WEBP                                                                 | ≤15 MB                       | Posts: 8 GB and 0.5 s–20 min. Premium accounts: 16 GB and 125 min. DMs: 512 MB / 140 s. The old 512 MB / 140 s figure many competitors still quote now applies only to DMs                         | —                                                     | VERIFIED: docs.x.com/x-api/media/quickstart/best-practices                                                                                                                                                                                                   |
| **Instagram** (Graph API, IG User Media)         | **JPEG only**; 8 MB; width 320–1440 px; aspect ratio 4:5 to 1.91:1                           | Not accepted (JPEG only)     | Reels: **300 MB**, 3 s–15 min, 23–60 fps. Story video: 100 MB, 3–60 s. Carousels hold up to 10 items                                                                                               | —                                                     | VERIFIED: developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media, …/content-publishing (media must sit on a public URL)                                                                                                 |
| **Facebook Pages** (Graph API)                   | `/page/photos`: 10 MB; jpeg, bmp, png, gif or tiff; PNG kept at or under 1 MB is recommended | As a photo: 10 MB            | Reels: 3–90 s, no size stated. Stories: ≤60 s. Page video file size: **not stated in the current docs**. Older v2.x docs: 1 GB / 20 min non-resumable, 1.5–1.75 GB / 45 min resumable              | —                                                     | Photos, Reels and Stories VERIFIED: developers.facebook.com/docs/graph-api/reference/page/photos/, …/video-api/guides/reels-publishing, …/page-stories-api/. Video size UNVERIFIED (legacy-docs excerpt)                                                     |
| **YouTube** (Data API `videos.insert`)           | —                                                                                            | —                            | 256 GB; MIME type `video/*`. Each upload costs 1 unit of the "Video Uploads" quota, limited to 100 calls/day                                                                                       | —                                                     | VERIFIED: developers.google.com/youtube/v3/docs/videos/insert                                                                                                                                                                                                |
| **TikTok** (Content Posting API)                 | **JPEG or WebP only**; 20 MB each; at most 1080p                                             | —                            | 4 GB; MP4, WebM or MOV; 360–4096 px; 23–60 fps; up to 10 min through the API (the creator's own limit can be lower). Chunks are 5–64 MB                                                            | —                                                     | VERIFIED: developers.tiktok.com/doc/content-posting-api-media-transfer-guide                                                                                                                                                                                 |
| **Snapchat** (Public Profile API)                | Not documented (Ayrshare says 20 MB, UNVERIFIED)                                             | —                            | Multipart upload up to 1 GB; files over 32 MB go in chunks; AES-256 encrypted. MP4: Story 5–60 s, Spotlight 6–60 s, at least 540×960. Media expires after 24 h                                     | —                                                     | VERIFIED: developers.snap.com/marketing-api/Public-Profile-API/ProfileAssetManagement                                                                                                                                                                        |
| **Telegram** (Bot API)                           | `sendPhoto` 10 MB; width + height ≤10000 px                                                  | `sendAnimation` 50 MB        | `sendVideo` 50 MB. Sent by URL: photos 5 MB, everything else 20 MB. A **self-hosted (local) Bot API server raises uploads to 2000 MB**                                                             | `sendDocument` 50 MB (2000 MB on a local server)      | VERIFIED: core.telegram.org/bots/api                                                                                                                                                                                                                         |
| **Pinterest** (API v5)                           | The API docs give no size. Pinterest Help: 20 MB on web                                      | Not in the listed formats    | The API docs list only .mp4, .mov and .m4v. Ad specs: up to 2 GB, 4 s–15 min. Organic Pin specs: 4 s–5 min                                                                                         | —                                                     | API formats VERIFIED: developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/. Sizes VERIFIED in Help only: help.pinterest.com/en/article/review-pin-specs, help.pinterest.com/en/business/article/pinterest-product-specs |
| **LinkedIn** (Images, Videos and Documents APIs) | No byte cap; under 36,152,320 pixels; JPG, GIF or PNG                                        | Up to 250 frames             | The spec section says 75 KB–500 MB, 3 s–30 min, MP4, but the `initializeUpload` field allows up to 5 GB                                                                                            | **100 MB and 300 pages**; PDF, PPT, PPTX, DOC or DOCX | VERIFIED: learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api, …/videos-api, …/documents-api                                                                                                                                 |
| **Bluesky** (atproto lexicons)                   | `image/*` up to **2,000,000 bytes**, 4 per post. Raised from 1 MB in April 2026              | Counts as `image/*`, so 2 MB | `video/mp4` up to **300,000,000 bytes**, raised from 100 MB on 2026-08-11. Daily quotas come from `app.bsky.video.getUploadLimits`. The 10-minute duration is from press reports only (UNVERIFIED) | —                                                     | VERIFIED: github.com/bluesky-social/atproto (lexicons/app/bsky/embed/images.json and video.json, plus their commit history)                                                                                                                                  |
| **Threads** (Threads API)                        | JPEG or PNG; 8 MB; width 320–1440 px                                                         | Not supported                | MOV or MP4; 1 GB; ≤300 s; ≤100 Mbps. Carousels hold 2–20 items                                                                                                                                     | —                                                     | VERIFIED: developers.facebook.com/docs/threads/overview                                                                                                                                                                                                      |

### Contradictions and gaps

- **Instagram Reels:** the API says 300 MB. Sprout, Agorapulse, Iconosquare and Publer quote 1 GB.
- **X:** the API now allows 8 GB / 20 min. Most competitors still quote 512 MB / 140 s.
- **Bluesky:** the API now allows 2 MB images and 300 MB video. Every competitor still quotes 1 MB / 100 MB.
- **LinkedIn video:** the docs disagree with themselves: 500 MB in the spec section, 5 GB in the upload field.
- **Facebook Page video:** no current official file-size figure.
- **Pinterest:** the API docs are silent on size, and the Help Center gives two durations (15 min for ads, 5 min for organic Pins).
- **Snapchat:** the image limit is undocumented.
- **Later:** two excerpts give different video limits by plan.
- **Iconosquare:** its library limit (150 MB) contradicts its own network table.
- **Hootsuite:** publishes a per-network video size only for YouTube.

### 3. Recommendation

The rule: a global cap for each media type that sits at the competitive norm. Then, before any byte is uploaded, the effective cap is the smaller of the global cap and the strictest limit among the networks and placements the post targets.

| Type     | Global cap | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image    | **20 MB**  | No network accepts more except LinkedIn, which has a pixel cap instead (TikTok 20 MB, Pinterest 20 MB web, Facebook and Telegram 10 MB). It also matches Hootsuite's 20 MB compression ceiling and Later's Starter plan. A higher cap only makes sense if OmniPost compresses images itself.                                                                                                                                                                  |
| GIF      | **15 MB**  | X's ceiling, and the figure Buffer, Sprout, Metricool, Agorapulse and SocialBee use. Instagram, Threads and TikTok reject GIFs anyway. Telegram's 50 MB animations are a niche case.                                                                                                                                                                                                                                                                          |
| Video    | **1 GB**   | The median of the competitors (Buffer, Planable, Loomly, most Publer and Agorapulse networks). It fully covers the Threads and Snapchat ceilings and is above Instagram's (300 MB), Bluesky's (300 MB) and LinkedIn's documented 500 MB. If more is wanted, a 2 GB option for higher plans has precedent (Later's Growth plan, Vista Social, Pinterest). YouTube's 256 GB or X's 8 GB as a global cap would be far more permissive than anyone in the market. |
| Document | **100 MB** | LinkedIn's API limit, and the figure every competitor uses. Telegram `sendDocument` is capped lower, at 50 MB.                                                                                                                                                                                                                                                                                                                                                |

How the per-network check should work:

1. **Before upload:** the client sends the declared size, MIME type and the post's targets to the server that issues the upload URL. The server rejects with a message naming the network, for example "Telegram accepts at most 50 MB".
2. **Also check format and duration, not just size.** These decide acceptance too:
   - Instagram takes JPEG only.
   - TikTok photos must be JPEG or WebP.
   - Threads takes JPEG or PNG.
   - Durations: Instagram Reels 3 s–15 min, Stories ≤60 s, Facebook Reels 3–90 s, Threads ≤5 min, TikTok ≤10 min, X ≤20 min, Snapchat 5–60 s.
3. **Re-check at publish.** Targets can change after the upload, and networks change their limits: X, Bluesky and LinkedIn all moved in 2025–26, which is exactly why competitor help pages are stale.
4. **One table of network limits.** Keep a single per-network table with a source URL and a verified-on date for each value, replacing the three tables that disagree today.
5. **Telegram is the tightest video limit.** Telegram is the one case where large-video support depends on running a self-hosted (local) Bot API server, which raises its limit from 50 MB to 2000 MB. That is a separate decision, not part of the caps above.

## Key Learnings

1. X API v2 now documents 8 GB and 20 minutes for post videos on default accounts; 512 MB and 140 seconds now apply only to DM videos.
2. Bluesky's lexicons raised the image blob maxSize to 2,000,000 bytes in April 2026 and the video blob maxSize to 300,000,000 bytes on 2026-08-11, so competitor help pages quoting 1 MB / 100 MB are stale.
3. The Instagram Graph API documents Reels at 300 MB maximum and accepts JPEG only for images, while several competitors claim 1 GB for Reels.
4. The Telegram Bot API caps photos at 10 MB and other uploads at 50 MB, and a self-hosted local Bot API server raises uploads to 2000 MB.
5. The LinkedIn Documents API caps documents at 100 MB and 300 pages (PDF, PPT, PPTX, DOC, DOCX), and its Videos API contradicts itself: 500 MB in the spec section versus 5 GB in initializeUpload.

---

## Report 2: Storage providers, health signals, upload-size enforcement and migration

A read-only explorer wrote this on 2026-10-04, from primary vendor documentation and the SDK
typings installed in the repository. It ran after Edward decided three things: all four storage
providers are selectable, once, at the initial deploy; storage health comes from each platform's own
API; and moving storage between platforms is a future research item. The original is a compact
memory record. The prose below keeps its facts; the answers that later decisions of the same day
gave to its open questions are listed separately at the end, so the research itself reads as it was
found.

### A correction to an earlier claim

`generateUploadSignature` **is** called. An earlier statement that nothing calls it came from a
truncated search, and the body of pull request #387 was corrected. The Instagram provider calls it in
four places:

- `packages/providers/instagram/src/mediaProcessor.ts:277`, for story segments;
- `mediaProcessor.ts:397`, for Reels, live through the publish worker;
- `mediaProcessor.ts:495`, for thumbnails;
- `packages/providers/instagram/src/apiClient.ts:500`.

It calls it on an S3 adapter that it builds itself from the `AWS_*` environment variables, ignoring
`STORAGE_PROVIDER`, and it builds public URLs as `signature.url + fields.key`.

### Health: one probe per provider

Each platform has a cheap call that proves the credentials reach the bucket or container:

- **S3 and DigitalOcean Spaces**: `HeadBucketCommand`. It needs the `s3:ListBucket` permission, and
  the timeout is applied through the command's `abortSignal`.
- **Google Cloud Storage**: `bucket.getMetadata()`. It needs `storage.buckets.get`. The v7 SDK has
  no per-call abort signal, so the timeout is built from `StorageOptions.timeout`, `retryOptions`
  and a `Promise.race`.
- **Azure Blob Storage**: `containerClient.getProperties()`, not `exists()`, which hides a 404.

The providers' own "service health" APIs are not worth it; AWS Health, for example, needs a
Business Support plan.

The proposed port method is `probe({ timeoutMs })`, returning
`Result<{ latencyMs, provider, target }, UNAUTHORIZED | NOT_FOUND | MISCONFIGURED | TIMEOUT | SERVICE_ERROR>`.
It makes one attempt and bypasses the circuit breaker. The storage checker should take its
thresholds from `HealthCheckConfig`: today they are hard-coded at 2000/5000, while the configuration
holds 1000/5000. The tenant monitor's `TenantStorageAdapter` is `{}` and its `getStorageHealth` is
hard-coded healthy; it should reuse the system probe and read usage from the database.

### Enforcing the upload size on each provider

- **S3**: the `content-length-range` condition of a POST policy, which is what the adapter does
  today.
- **DigitalOcean Spaces**: PostObject is supported, but `content-length-range` is not documented, so
  it needs a live test.
- **Google Cloud Storage**: `generateSignedPostPolicyV4` with `['content-length-range', 0, N]`
  (SDK 7.19.0), or the `x-goog-content-length-range` header on a signed PUT.
- **Azure Blob Storage**: no SAS can cap the size (the Valet Key pattern). Enforcement there is a
  create-only SAS, a post-upload verify-and-delete, and an orphan sweeper.

The proposed contract is an `UploadTicket` —
`{ method: POST | PUT, url, fields, headers, key, maxBytes, sizeEnforcement: provider | post-upload, expiresAt }`
— plus `verifyUpload(key, { maxBytes, contentType })`. Cloudinary would implement the port as well.

### Moving storage between platforms

The tools: AWS DataSync, where one end must be AWS; Google Storage Transfer Service, where the sink
must be GCS; AzCopy, from S3 or GCS to Azure; and rclone, from any provider to any other.

Before any of them can be used, OmniPost itself needs three things:

1. **One key layout.** S3 writes `uploads/<uuid>-name`; GCS and Azure write `Date.now()-name`.
2. **Object keys stored, not provider URLs.** `PostMedia.url`, `processedMediaUrl`, `thumbnailUrl`,
   `VideoProcessingJob.originalUrl` and `VideoSegment.url` hold full URLs today.
3. **The public URL derived from a configured base**, not persisted.

### Proposed slices

1. `probe()` in the port and every adapter, the checker, and `healthRoutes` through the factory.
2. `gcs` and `azure` in the environment enum and the factory.
3. `UploadTicket` with S3 and Spaces, and the Instagram callers migrated: inject the configured port
   and drop `AWS_*`.
4. The GCS POST policy, the Azure ticket, and `verifyUpload`.
5. The tenant monitor reuses the probe.
6. Keys, not URLs: the prerequisite for migration.

### Questions it left for the owner

- What is the maximum upload size per media type? Today it is a 100 MB constant.
- Azure: verify-and-delete, or upload through the API?
- Should Cloudinary be a `STORAGE_PROVIDER` value?
- Credentials: keys or a JSON key file, or managed identity?
- Should the storage health check be `critical: true`?
- Public buckets, or signed GET URLs for Instagram?
- Migrate the database from URLs to keys?

### Also seen

- The S3 adapter returns `INVALID_TYPE` for an oversize file.
- `getMediaMetadata` treats the whole URL path as the object key, which is suspect under path-style
  addressing and on Spaces.

### Added note: where the open questions were answered

This subsection is not part of the research. It records which decision of 2026-10-04 answered each
question, so a reader does not take a superseded proposal for the plan.

| Question or proposal                       | Answer                                                                                                | Recorded in                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Maximum upload size per media type         | Image 20 MB, GIF 15 MB, video 1 GB, document 100 MB; Admin-adjustable; the same for every plan        | [ADR-0029](../technical/ADR-0029-media-upload-limits.md)                    |
| Azure: verify-and-delete or upload via API | Post-upload verification on all four providers plus a sweeper; upload through the API rejected        | [ADR-0029](../technical/ADR-0029-media-upload-limits.md)                    |
| Cloudinary as a storage provider           | No: the orphan adapter is deleted, so it no longer implements the port either                         | [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md) |
| Keys or managed identity                   | Both: keys, or the cloud's own identity with no stored secret on AWS, GCP and Azure; Spaces keys only | [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md) |
| `critical: true`                           | No: a storage outage degrades the app and never takes it down                                         | [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md) |
| Public buckets or signed GET               | Private buckets and short-lived signed read URLs                                                      | [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md) |
| URLs to keys                               | Yes, with a data migration                                                                            | [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md) |
| Slice 2: `gcs` and `azure` in the env enum | Superseded: storage is configured in Admin at the initial setup and the storage env variables leave   | [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md) |
| Prerequisite 3: URL from a configured base | Superseded: media is read through signed URLs generated per request, not from a public base           | [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md) |
