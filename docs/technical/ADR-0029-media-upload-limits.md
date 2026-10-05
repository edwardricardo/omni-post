# ADR-0029: Media upload limits — global caps, the strictest target network, verified after upload

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0028](ADR-0028-storage-configuration-and-media-access.md) (storage configuration
  and signed access)

## Context

Edward asked for upload limits that are "neither much more restrictive nor much more permissive than
the competition". The research ([research-2026-10-04-storage.md](../reports/research-2026-10-04-storage.md),
Report 1) read the limits of 13 competitors and the official publishing-API limits of the 11
networks OmniPost publishes to. The findings that shape this decision:

- **Competitors converge on the networks' own ceilings.** Images are mostly capped per network
  between 5 and 30 MB; GIFs at 15 MB (X's ceiling); video around 1 GB (Buffer, Planable, Loomly, most
  Publer and Agorapulse networks), with Later at 512 MB to 1.5 GB by plan and Vista Social at 2 GB;
  documents at LinkedIn's 100 MB and 300 pages.
- **The networks differ in format and duration as much as in size.** Instagram accepts JPEG only,
  8 MB, and Reels of 300 MB between 3 seconds and 15 minutes; TikTok photos must be JPEG or WebP;
  Threads takes JPEG or PNG; Telegram's Bot API caps photos at 10 MB and other uploads at 50 MB.
- **Limits move.** X, Bluesky and LinkedIn changed theirs in 2025–2026, which is why competitors' help
  pages are stale.
- **Azure cannot cap an upload in a signed permission.** S3 and Spaces can (`content-length-range` in
  a POST policy; Spaces needs a live test because the condition is undocumented there), and GCS can
  (a V4 POST policy, or `x-goog-content-length-range` on a signed PUT), but no Azure SAS limits size
  (Report 2).

The code measured on `main` at `bad953f2` disagrees with itself (Report 1's measurement, an uncut
search of 79 lines, spot-checked here):

- The S3 adapter caps uploads at 100 MB (`packages/adapters/storage-s3/src/index.ts:37`) and answers
  an oversize file with `INVALID_TYPE` (`:94-95`). The GCS and Azure adapters declare the same
  100 MB as `_MAX_FILE_SIZE` (`storage-gcs/src/index.ts:60`, `storage-azure/src/index.ts:33`) and
  never use it.
- The Instagram upload page allows 500 MB.
- Network limits live in three places that disagree: `packages/shared/src/providers/providerConfig.ts`
  (`maxVideoSize`), `packages/core/domain/src/value-objects/MediaAttachment.ts`, and the provider
  packages — TikTok 500 MB in its package against 4 GB in `providerConfig`; YouTube 256 GB against
  128 GB.
- Validators use 10 MB and 100 MB, and the client registry defaults images to 5 MB.

## Decision

1. **Global caps per media type, the same for every plan, adjustable in Admin**, with these
   defaults:

   | Media type | Default cap |
   | ---------- | ----------- |
   | Image      | 20 MB       |
   | GIF        | 15 MB       |
   | Video      | 1 GB        |
   | Document   | 100 MB      |

   Per-plan caps are deferred until the plans are defined.

2. **The effective cap of an upload is the smaller of the global cap and the strictest limit among
   the networks and placements the post targets.** It is checked **before any byte is uploaded**,
   together with **format and duration** (for example Instagram's JPEG-only images, or Reels between
   3 seconds and 15 minutes), and a rejection names the network ("Telegram accepts at most 50 MB").
   It is **checked again at publish**, because targets can change after the upload.
3. **One per-network limits table lives in the domain.** Every value carries its official source URL
   and the date it was verified. The disagreeing copies — `providerConfig.ts`, `MediaAttachment.ts`,
   the provider packages — and the scattered constants (the 100 MB storage cap, the 500 MB upload
   page, the 5 MB client default, the 10 and 100 MB validators) are deleted in its favour.
4. **Browsers keep uploading directly to the bucket with a temporary signed permission** (option A).
   The permission is an `UploadTicket`:
   `{ method: POST | PUT, url, fields, headers, key, maxBytes, sizeEnforcement: provider | post-upload, expiresAt }`.
   S3, Spaces and GCS also cap the size inside the signature; Azure cannot, and relies on point 5.
5. **Every upload, on all four providers, is confirmed by a post-upload verification in the API**:
   `verifyUpload(key, { maxBytes, contentType })` reads the object's **real size** and **real content
   type from its magic bytes**, and deletes the object if either fails. A periodic sweeper deletes
   uploads that were never confirmed. The sweeper is registered through the
   `BackgroundTaskScheduler`, never a raw `setInterval` (fitness #11).
6. **Large Telegram video is deferred.** Telegram videos over 50 MB need a self-hosted Bot API server,
   which raises the limit to 2000 MB. Running one is a separate decision.

## Rationale

1. **The caps sit at the market's norm.** 20 MB images match TikTok, Pinterest on web, Hootsuite's
   compression ceiling and Later's Starter plan; 15 MB GIFs are X's ceiling and what most competitors
   use; 1 GB video is the competitors' median and covers Threads and Snapchat; 100 MB documents are
   LinkedIn's limit (Report 1 §3).
2. **The strictest network decides, because a post that one target rejects fails at publish.**
   Checking before upload turns a late failure into an immediate, named one.
3. **Format and duration reject as many files as size does.** A size-only check would still let a PNG
   reach Instagram.
4. **One table cannot disagree with itself.** Three copies already do, and a dated source per value
   makes a stale limit visible.
5. **Verification is the only control that works on every provider.** Signature caps are a first
   line on three providers; the post-upload check is what makes Azure as safe as the others, and it
   also catches a file whose bytes do not match its declared type.

## Alternatives Considered

- **Upload through the API for Azure.** Rejected: proxying large videos costs bandwidth and CPU on
  the API.
- **Per-plan caps now.** Deferred until the plans exist. A 2 GB video option for higher plans has
  precedent (Later's Growth plan, Vista Social, Pinterest) if it is wanted then.
- **A network's maximum as the global cap** (YouTube's 256 GB, X's 8 GB). Rejected: far more
  permissive than anyone in the market.
- **Check at publish only.** Rejected: the customer uploads, schedules, and learns days later that a
  network refuses the file.
- **Keep per-package limits.** Rejected: that is the disagreement this decision removes.
- **Trust the client's declared size and type.** Rejected: the post-upload verification exists
  because a browser can declare anything.

## Consequences

**Positive**

- The customer learns at upload time, by network name, why a file is refused.
- One table to update when a network changes its limits, with a date that shows its age.
- Unconfirmed or mistyped objects do not accumulate in the bucket.

**Negative / costs**

- **The upload flow gains a confirmation step**: an object counts only after `verifyUpload` accepts
  it.
- **A sweeper runs in the background**, and its deletions need an audit trail clear enough to explain
  a missing file.
- **Duration checks need media metadata before upload**, read in the browser or from the declared
  values, and re-checked by the verification where the format allows.
- **The table needs re-verification** as networks change; a verified-on date that ages is a prompt,
  not a guarantee.
- **The `INVALID_TYPE` answer to an oversize file goes away** with the old adapter cap: the new
  contract names the cause.

## Revisit if

- Plans are defined and a plan needs a different cap.
- A network raises or lowers a limit (the table, not this ADR, changes for that).
- OmniPost starts compressing images itself, which would justify a higher image cap (Report 1 §3).
- The self-hosted Telegram Bot API server is adopted.

## Risks and Mitigations

| Risk                                                            | Mitigation                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| An oversize file lands on Azure, which cannot cap the signature | `verifyUpload` reads the real size and deletes the object; the sweeper removes anything never confirmed     |
| A file's declared content type is false                         | The verification reads magic bytes, not the declared type                                                   |
| A network limit in the table goes stale                         | Every value carries its source URL and verified-on date; the publish-time re-check surfaces a refusal early |
| Spaces ignores `content-length-range`                           | Live-tested before relying on it; the post-upload verification covers it either way                         |
| The sweeper deletes an upload that is still being confirmed     | Only uploads past their ticket's expiry and never confirmed are swept                                       |

## References

- Research: [research-2026-10-04-storage.md](../reports/research-2026-10-04-storage.md) — Report 1
  (§1 competitors, §2 the 11 networks' official API limits, §3 recommendation), Report 2
  (upload-size enforcement per provider and the `UploadTicket` contract).
- Specification: [media-storage.md](../features/media-storage.md).
- Code: `packages/adapters/storage-s3/src/index.ts:37`, `:94-95`, `:110`;
  `packages/adapters/storage-gcs/src/index.ts:60`; `packages/adapters/storage-azure/src/index.ts:33`;
  `packages/shared/src/providers/providerConfig.ts`;
  `packages/core/domain/src/value-objects/MediaAttachment.ts`.
- Canon: `docs/observability/LOGGING_CANON.md` §Background Tasks; `CLAUDE.md` fitness #11.
