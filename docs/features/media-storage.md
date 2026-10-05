# Media storage: configuration, private access, health and upload limits

- **Status**: Decided 2026-10-04 — ready for implementation slices (§10)
- **Date**: 2026-10-04
- **Owner**: Edward / Platform engineering
- **Decisions**: [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md)
  (configuration, access, health) · [ADR-0029](../technical/ADR-0029-media-upload-limits.md) (upload
  limits and verification)
- **Research**: [research-2026-10-04-storage.md](../reports/research-2026-10-04-storage.md)
- **Findings this work closes**: F15 (SMELL-186) in
  [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md); F3 (the
  Instagram provider's own S3 adapter); F4 (the always-unhealthy storage probe)

---

## 1. Scope

**In scope**

- Choosing and configuring the storage provider once, in Admin, and locking it.
- Credential modes: keys, or the cloud's own identity.
- Private buckets, signed read URLs, and object keys instead of URLs in the database.
- A real health probe per provider, and degraded operation during an outage.
- Upload caps, per-network limits, direct uploads with a signed ticket, post-upload verification and
  the orphan sweeper.
- Deleting the Cloudinary adapter, and moving the Instagram provider onto the configured port.

**Out of scope**

- Moving stored media between platforms. It stays a backlog research item; this work only removes
  its obstacles (keys, one layout).
- Per-plan upload caps, deferred until the plans are defined.
- A self-hosted Telegram Bot API server for videos over 50 MB.
- Media transformations; if ever wanted, they are evaluated as a separate service.

## 2. Glossary

| Term                 | Meaning                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Storage setup        | The Admin configuration of provider and credentials, made once at the initial setup               |
| Lock                 | The persisted fact that the first object is stored; from then on the provider cannot change       |
| Credential mode      | `keys` (stored encrypted) or `identity` (the cloud's own workload identity, no stored secret)     |
| Object key           | The provider-independent name of a stored object. What the database stores instead of a URL       |
| Signed read URL      | A short-lived URL that grants read access to one private object                                   |
| Upload ticket        | The temporary signed permission a browser uses to upload one object directly to the bucket        |
| Verification         | The API's check of a finished upload: real size and real content type from magic bytes            |
| Effective cap        | The smaller of the global cap for the media type and the strictest limit among the post's targets |
| Network-limits table | The single domain table of each network's limits, each value with source URL and verified-on date |

## 3. Requirements

### 3.1 Configuration ([ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md))

- **R1** Providers: S3, Google Cloud Storage, Azure Blob Storage, DigitalOcean Spaces.
- **R2** The provider and its credentials are configured in Admin at the initial setup and stored
  encrypted through `PlatformCredentialService`. Admin is the only source; `STORAGE_PROVIDER`,
  `S3_*` and `DO_SPACES_*` are removed, with no environment fallback.
- **R3** The configuration locks when the first object is stored. The lock is persisted and enforced
  by the API.
- **R4** Credential modes: keys, or identity on AWS (instance role or default chain), GCP
  (Application Default Credentials) and Azure (Managed Identity). Spaces is keys-only.
- **R5** The probe validates the chosen mode before the configuration is saved.

### 3.2 Access

- **R6** Buckets are private. Media is read only through signed read URLs: short validity for portal
  previews, hours for a network fetching at publish time.
- **R7** The storage port gains a signed-read method, implemented by every adapter: presigned
  `GetObject` (S3, Spaces), `getSignedUrl` with action `read` (GCS), read SAS (Azure). Keyless signing
  uses `iam.serviceAccounts.signBlob` (GCS) and a user-delegation SAS (Azure).
- **R8** The database stores object keys. `PostMedia.url`, `processedMediaUrl`, `thumbnailUrl`,
  `VideoProcessingJob.originalUrl` and `VideoSegment.url` are migrated to keys, and one key layout is
  used by every adapter.
- **R9** The Instagram provider uses the configured storage port, injected by the composition root;
  its `AWS_*` adapter is removed.

### 3.3 Health ([ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md))

- **R10** Every adapter implements `probe({ timeoutMs })`, returning
  `Result<{ latencyMs, provider, target }, UNAUTHORIZED | NOT_FOUND | MISCONFIGURED | TIMEOUT | SERVICE_ERROR>`,
  with one attempt and no circuit breaker.
- **R11** The checker takes its thresholds from `HealthCheckConfig`; the tenant monitor reuses the
  probe and reads usage from the database.
- **R12** The storage check is registered with `critical: false`. A failing probe reports DEGRADED;
  the load balancer keeps routing.
- **R13** During an outage, uploads and media publishes fail with a clear message; media publish
  jobs back off and retry on a storage error class instead of failing permanently.
- **R14** Admin gets one alert per outage, not one per request.

### 3.4 Uploads ([ADR-0029](../technical/ADR-0029-media-upload-limits.md))

- **R15** Global caps, Admin-adjustable, the same for every plan: image 20 MB, GIF 15 MB, video
  1 GB, document 100 MB.
- **R16** The effective cap, format and duration are checked before upload; a rejection names the
  network.
- **R17** The same checks run again at publish.
- **R18** One network-limits table in the domain replaces `providerConfig.ts`, `MediaAttachment.ts`,
  the provider packages' limits and the scattered constants.
- **R19** Uploads go directly to the bucket with an `UploadTicket`; S3, Spaces and GCS also cap the
  size inside the signature.
- **R20** Every upload is verified by the API (real size, real content type from magic bytes) and
  deleted if it fails.
- **R21** A sweeper, registered through the `BackgroundTaskScheduler`, deletes uploads never
  confirmed.

### 3.5 Clean-up

- **R22** `packages/adapters/storage-cloudinary` is deleted with every reference to it; fitness #42's
  manifest floor (90) still holds.

## 4. Admin screens and fields

### 4.1 Storage setup (initial setup, editable until the lock)

| Field                    | S3            | Spaces    | GCS              | Azure         | Notes                                                                                            |
| ------------------------ | ------------- | --------- | ---------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| Provider                 | yes           | yes       | yes              | yes           | One choice                                                                                       |
| Credential mode          | keys/identity | keys only | keys/identity    | keys/identity | R4                                                                                               |
| Bucket / container       | bucket        | bucket    | bucket           | container     |                                                                                                  |
| Region                   | yes           | yes       | —                | —             |                                                                                                  |
| Endpoint                 | optional      | yes       | —                | —             | S3 endpoint covers S3-compatible stores such as MinIO and LocalStack                             |
| Storage account          | —             | —         | —                | yes           |                                                                                                  |
| Access key id and secret | keys mode     | yes       | —                | —             | Exists today in the STORAGE credential group                                                     |
| Service-account key      | —             | —         | keys mode (JSON) | —             |                                                                                                  |
| Account key              | —             | —         | —                | keys mode     |                                                                                                  |
| Signing identity         | —             | —         | identity mode    | identity mode | GCS service account with `signBlob`; Azure user-delegation key. Confirm field names in the slice |

**Test** runs `probe()` with the entered values. **Save** is allowed only after a passing test.

### 4.2 Storage status (always visible)

Active provider, credential mode, lock state and date, last probe result and latency, and the current
outage, if any. After the lock the setup fields are read-only and the screen says why: moving stored
media between platforms is not supported.

### 4.3 Upload limits

| Field        | Default | Notes                                  |
| ------------ | ------- | -------------------------------------- |
| Image cap    | 20 MB   | Global; the effective cap may be lower |
| GIF cap      | 15 MB   |                                        |
| Video cap    | 1 GB    |                                        |
| Document cap | 100 MB  |                                        |

## 5. Customer surfaces

- **Upload**: the client sends declared size, MIME type, duration (for video) and the post's targets
  before uploading. A refusal names the network and the limit ("Telegram accepts at most 50 MB").
- **Publish**: the same checks run against the current targets; a refusal names the network.
- **Outage**: uploads and media publishes show that storage is unavailable and will be retried;
  everything else works.

## 6. Data model sketch

Names are indicative; each slice fixes its own. A new model carrying `accountId` is enrolled in
`TENANT_SCOPED_MODELS` or the documented denylist (fitness #39) and follows
`docs/security/MULTI_TENANT_GUARDS.md`.

| Table / item           | Columns                                                                                                                                                                            | Notes                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `StorageConfiguration` | `provider`, `credentialMode`, `bucket`, `region?`, `endpoint?`, `accountName?`, `credentialGroup` (encrypted, in `PlatformCredential`), `configuredAt`, `lockedAt?`                | One row. `lockedAt` is the persisted lock          |
| `UploadLimitSettings`  | `imageMaxBytes`, `gifMaxBytes`, `videoMaxBytes`, `documentMaxBytes`                                                                                                                | One row, seeded with §4.3                          |
| `PendingUpload`        | `key` (PK), `accountId`, `mediaType`, `contentType`, `declaredBytes`, `maxBytes`, `sizeEnforcement`, `expiresAt`, `status`, `actualBytes?`, `detectedContentType?`, `confirmedAt?` | Tenant-scoped. Drives verification and the sweeper |
| `PostMedia`            | `url` → `key`; `processedMediaUrl` → `processedKey`; `thumbnailUrl` → `thumbnailKey`                                                                                               | Data migration                                     |
| `VideoProcessingJob`   | `originalUrl` → `originalKey`                                                                                                                                                      | Data migration                                     |
| `VideoSegment`         | `url` → `key`                                                                                                                                                                      | Data migration                                     |

**Port additions** (`packages/ports/src/StoragePort.ts`)

```typescript
interface UploadTicket {
  method: "POST" | "PUT";
  url: string;
  fields: Record<string, string>;
  headers: Record<string, string>;
  key: string;
  maxBytes: number;
  sizeEnforcement: "provider" | "post-upload";
  expiresAt: Date;
}

// probe({ timeoutMs }), issueUploadTicket(...), verifyUpload(key, { maxBytes, contentType }),
// getSignedReadUrl(key, { expiresInSeconds }) — exact signatures fixed in their slices.
```

**Network-limits table** (domain code, not a database table). Each entry: network, placement, media
type, `maxBytes?`, `maxPixels?`, accepted formats, `minDurationSeconds?`, `maxDurationSeconds?`,
`maxItems?`, `sourceUrl`, `verifiedOn`. Its seed is the research's official-API table (Report 1 §2),
read on 2026-10-04:

| Network   | Image                              | GIF                   | Video                                                            | Document                                     | Source                                                                                                                                                   |
| --------- | ---------------------------------- | --------------------- | ---------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X         | ≤5 MB; JPG, PNG, GIF, WEBP         | ≤15 MB                | 8 GB, 0.5 s–20 min                                               | —                                            | https://docs.x.com/x-api/media/quickstart/best-practices                                                                                                 |
| Instagram | JPEG only, 8 MB                    | not accepted          | Reels 300 MB, 3 s–15 min; Story 100 MB, 3–60 s                   | —                                            | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media                                                      |
| Facebook  | 10 MB; jpeg, bmp, png, gif, tiff   | 10 MB as a photo      | Reels 3–90 s; Stories ≤60 s; Page video size not in current docs | —                                            | https://developers.facebook.com/docs/graph-api/reference/page/photos/ (Reels and Stories: the video-api reels-publishing guide and the page-stories-api) |
| YouTube   | —                                  | —                     | 256 GB, `video/*`; 100 uploads/day quota                         | —                                            | https://developers.google.com/youtube/v3/docs/videos/insert                                                                                              |
| TikTok    | JPEG or WebP, 20 MB, ≤1080p        | —                     | 4 GB; MP4, WebM, MOV; ≤10 min                                    | —                                            | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide                                                                               |
| Snapchat  | not documented                     | —                     | ≤1 GB MP4; Story 5–60 s, Spotlight 6–60 s                        | —                                            | https://developers.snap.com/marketing-api/Public-Profile-API/ProfileAssetManagement                                                                      |
| Telegram  | 10 MB                              | 50 MB (animation)     | 50 MB                                                            | 50 MB                                        | https://core.telegram.org/bots/api                                                                                                                       |
| Pinterest | API silent; Help: 20 MB on web     | not in listed formats | .mp4, .mov, .m4v; sizes in Help only                             | —                                            | https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/                                                        |
| LinkedIn  | under 36,152,320 px; JPG, GIF, PNG | up to 250 frames      | 500 MB, 3 s–30 min, MP4 per spec (5 GB in `initializeUpload`)    | 100 MB, 300 pages; PDF, PPT, PPTX, DOC, DOCX | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api (also `videos-api`, `documents-api`)                         |
| Bluesky   | 2,000,000 bytes, 4 per post        | as `image/*`          | 300,000,000 bytes, `video/mp4`                                   | —                                            | https://github.com/bluesky-social/atproto                                                                                                                |
| Threads   | JPEG or PNG, 8 MB                  | not supported         | MOV or MP4, 1 GB, ≤300 s                                         | —                                            | https://developers.facebook.com/docs/threads/overview                                                                                                    |

Where the research flags a contradiction (LinkedIn video, Facebook Page video, Pinterest sizes,
Snapchat images), the slice records the source of each figure and Edward confirms the value used.

## 7. State machines

### 7.1 Storage configuration

| From           | Event                                              | To           |
| -------------- | -------------------------------------------------- | ------------ |
| `UNCONFIGURED` | Admin saves a configuration whose probe passes     | `CONFIGURED` |
| `CONFIGURED`   | Admin saves a new configuration whose probe passes | `CONFIGURED` |
| `CONFIGURED`   | The first object is stored                         | `LOCKED`     |

`LOCKED` has no exit: a provider change after the lock is refused by the API.

### 7.2 Upload

| From     | Event                                                             | To          | Side effects                               |
| -------- | ----------------------------------------------------------------- | ----------- | ------------------------------------------ |
| —        | Ticket issued after the effective-cap, format and duration checks | `ISSUED`    | `PendingUpload` row with `expiresAt`       |
| `ISSUED` | Client confirms; verification passes                              | `CONFIRMED` | The object may be attached to a post       |
| `ISSUED` | Client confirms; size or magic bytes fail                         | `REJECTED`  | Object deleted; the client gets the reason |
| `ISSUED` | Ticket expired and never confirmed; sweeper runs                  | `EXPIRED`   | Object, if any, deleted                    |

### 7.3 Storage health

| From       | Event             | To         | Side effects                     |
| ---------- | ----------------- | ---------- | -------------------------------- |
| `HEALTHY`  | Probe fails       | `DEGRADED` | One Admin alert for this outage  |
| `DEGRADED` | Probe fails again | `DEGRADED` | No new alert                     |
| `DEGRADED` | Probe passes      | `HEALTHY`  | Backed-off media publishes retry |

## 8. Notifications

| Trigger                                  | Audience | Channel               | Content                                        |
| ---------------------------------------- | -------- | --------------------- | ---------------------------------------------- |
| Upload refused before upload             | Customer | Inline message        | The network and the limit that refused it      |
| Upload rejected by verification          | Customer | Inline message        | Real size or real type did not match           |
| Media publish blocked by a network limit | Customer | Post status + message | The network and the limit                      |
| Storage outage starts                    | Admin    | Admin alert           | Provider, error class, time; once per outage   |
| Upload or media publish during an outage | Customer | Inline message        | Storage unavailable; publishes will be retried |

## 9. Flows (target)

**Upload**

1. The client asks the API for a ticket with declared size, MIME type, duration and targets.
2. The API computes the effective cap, checks format and duration, and issues an `UploadTicket`
   (size capped in the signature where the provider supports it).
3. The browser uploads directly to the bucket.
4. The client confirms; the API runs `verifyUpload` and keeps or deletes the object.
5. The sweeper deletes what expired unconfirmed.

**Read**

The API generates a signed read URL from the stored key when the media is needed: a short validity
for portal previews, hours for a network fetching at publish.

## 10. Implementation slices

Each slice is one pull request of about 400 authored changed lines (a planning heuristic, not a
cap), with its tests and documentation in the same change.

| ID      | Slice                                                                                                                                                                                                                                           | Depends on     | ADR                                                                     | Closes          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------- | --------------- |
| STOR-1  | Delete `packages/adapters/storage-cloudinary` with its workspace, lockfile, tsconfig, jscpd, knip and population entries. First, so every later port change has one implementer fewer                                                           | —              | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | —               |
| STOR-2  | `probe()` in the port and every adapter; the checker on the probe with thresholds from `HealthCheckConfig`; `healthRoutes` through the factory; `critical: false` and DEGRADED                                                                  | STOR-1         | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | F4              |
| STOR-3  | Storage setup in Admin as the single source: stored encrypted configuration, `createStorageAdapter` reading it, the persisted lock, the storage env variables removed, the secrets docs updated, and how development and CI get a configuration | STOR-2         | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | F15 / SMELL-186 |
| STOR-4  | Credential modes, and GCS and Azure selectable: identity mode on AWS, GCP and Azure (`DefaultAzureCredential`), keys everywhere                                                                                                                 | STOR-3         | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | —               |
| STOR-5  | Signed-read method in the port and every adapter, including keyless signing (GCS `signBlob`, Azure user-delegation SAS)                                                                                                                         | STOR-4         | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | —               |
| STOR-6  | The Instagram provider on the injected storage port, reading through signed URLs; its `AWS_*` adapter removed                                                                                                                                   | STOR-5         | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | F3              |
| STOR-7  | Keys, not URLs: schema and data migration of the five columns, one key layout, URLs derived at read time; from here on no code builds a public object URL and buckets are private                                                               | STOR-6         | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | —               |
| STOR-8  | The single network-limits table, seeded from §6; `providerConfig.ts`, `MediaAttachment.ts`, the provider packages' limits and the scattered constants deleted in its favour                                                                     | —              | [0029](../technical/ADR-0029-media-upload-limits.md)                    | —               |
| STOR-9  | `UploadTicket`, `verifyUpload` and the sweeper on S3 and Spaces, including the live test of `content-length-range` on Spaces                                                                                                                    | STOR-3         | [0029](../technical/ADR-0029-media-upload-limits.md)                    | —               |
| STOR-10 | `UploadTicket` and `verifyUpload` on GCS (V4 POST policy) and Azure (create-only SAS, post-upload enforcement)                                                                                                                                  | STOR-4, STOR-9 | [0029](../technical/ADR-0029-media-upload-limits.md)                    | —               |
| STOR-11 | Global caps in Admin; effective cap, format and duration checked before upload and again at publish, with messages naming the network                                                                                                           | STOR-8, STOR-9 | [0029](../technical/ADR-0029-media-upload-limits.md)                    | —               |
| STOR-12 | Outage handling: media publish jobs back off on the storage error class; one Admin alert per outage                                                                                                                                             | STOR-2         | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | —               |
| STOR-13 | Tenant storage monitor reuses the probe and reads usage from the database                                                                                                                                                                       | STOR-2         | [0028](../technical/ADR-0028-storage-configuration-and-media-access.md) | —               |

## 11. Open points

- **Development and CI configuration.** Today `STORAGE_PROVIDER=local` builds the S3 adapter against
  MinIO or LocalStack through `S3_ENDPOINT`. With no environment fallback, STOR-3 decides how a fresh
  development or CI database gets its storage configuration.
- **`packages/adapters/storage-do-spaces`** wraps `storage-s3` and the `do-spaces` branch bypasses it
  (`docs/reports/UNUSED_CODE_INVENTORY.md`). Whether it survives is decided in STOR-3.
- **Signed-URL validities.** The decision fixes "short" for previews and "hours" for network fetches;
  the exact values are set and tested in STOR-5.
- **When exactly the lock is set**: at the first stored object; STOR-3 picks the event that records
  it (for example the first upload confirmed by verification).
- **Contradictory network figures** in the research (§6) need Edward's confirmation in STOR-8.
