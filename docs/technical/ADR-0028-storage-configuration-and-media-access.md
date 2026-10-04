# ADR-0028: Media storage — configured once in Admin, private buckets, signed reads, degraded on outage

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0029](ADR-0029-media-upload-limits.md) (upload limits and post-upload
  verification), [ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md) (the same
  Admin-as-single-source step for gateways), [ADR-0007](ADR-0007-di-composition-root.md)
  (composition root)

## Context

On 2026-10-04 Edward decided that Google Cloud Storage and Azure Blob Storage join S3 and
DigitalOcean Spaces as selectable storage, chosen once at the initial deploy; that storage health
must come from each platform's own API; and that moving storage between platforms is a future
research item, not a feature now. The storage research
([research-2026-10-04-storage.md](../reports/research-2026-10-04-storage.md), Report 2) and the code
measured on `main` at `bad953f2` show how far the code is from that:

- **Only environment variables select storage, and GCS and Azure cannot be selected.**
  `apps/api/src/infrastructure/storage/createStorageAdapter.ts` reads `STORAGE_PROVIDER`, `S3_*` and
  `DO_SPACES_*`; the enum in `apps/api/src/config/env.ts:182` is `s3 | local | do-spaces`. The GCS
  and Azure adapters exist but no value reaches them (`docs/reports/UNUSED_CODE_INVENTORY.md`,
  FN-048).
- **Admin storage credentials are stored, tested, and never used (finding F15).** The STORAGE group
  (`provider`, `accessKeyId`, `secretAccessKey`, `bucketName`, `region`, `endpoint`, in
  `apps/admin/components/settings/constants.ts`) is accepted by `apps/api/src/settings/settingsSchemas.ts`
  and stored and tested by `SettingsService` (`executeConnectionTest`, case `"STORAGE"`). An uncut
  search finds only those three references. The Admin storage form has no effect. Recorded as
  SMELL-186 in [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md).
- **The Instagram provider runs its own S3 adapter (finding F3).** It builds one from the `AWS_*`
  variables (`packages/providers/instagram/src/apiClient.ts:470-479`), ignoring `STORAGE_PROVIDER`,
  calls `generateUploadSignature` on it (`mediaProcessor.ts:277`, `:397`, `:495`; `apiClient.ts:500`)
  and builds public URLs as `signature.url + fields.key`.
- **The design assumes public buckets.** `StoragePort` (`packages/ports/src/StoragePort.ts`) exposes
  only `generateUploadSignature` and `getMediaMetadata`: there is no way to read an object through
  a signed URL. The S3 upload signature sets no ACL, and Instagram hands the networks a public URL.
- **The database stores full provider URLs**: `PostMedia.url`, `processedMediaUrl`, `thumbnailUrl`,
  `VideoProcessingJob.originalUrl`, `VideoSegment.url`. Key layouts also differ: S3 writes
  `uploads/<uuid>-name`, GCS and Azure write `Date.now()-name`.
- **Storage health is wrong in both directions.** The system checker
  (`packages/monitoring/health-checks/src/checkers/storage.ts`) probes by presigning an upload, a
  probe that is always unhealthy (finding F4), and its latency thresholds are hard-coded at
  2000/5000 (`:63-66`) while the configuration holds 1000/5000. The tenant monitor's
  `TenantStorageAdapter` is `{}` (`tenantHealth.ts:114`) and its `getStorageHealth` is hard-coded
  healthy.
- **`packages/adapters/storage-cloudinary` is orphan code**: zero references outside its own package
  (uncut search), and no configuration activates it.

## Decision

1. **Selectable providers: S3, Google Cloud Storage, Azure Blob Storage and DigitalOcean Spaces.**
   The choice is made once. Platform-to-platform migration is not offered; whether it can be offered
   to the application's final owner is a backlog research item.
2. **Storage is configured in Admin during the initial setup and locked after the first stored
   object** (option B). The provider and its credentials are stored encrypted through
   `PlatformCredentialService`, like the gateway credentials. The lock is a **persisted fact**, set
   when the first object is stored, not a UI convention. **Admin is the single source**: the storage
   environment variables (`STORAGE_PROVIDER`, `S3_*`, `DO_SPACES_*`) leave, which closes F15 at its
   root. Admin shows the active provider and its health.
3. **Two credential modes** (option B):
   - **Keys**, stored encrypted through `PlatformCredentialService`;
   - **The cloud's own identity, with no stored secret**, when the installation runs inside AWS
     (instance role or the default credential chain), GCP (Application Default Credentials) or Azure
     (Managed Identity).

   DigitalOcean Spaces stays keys-only: it has no workload identity. There is **no environment
   fallback** in either mode, per the security canon. Signed reads without a key use the IAM
   `signBlob` permission on GCS (`iam.serviceAccounts.signBlob`) and a user-delegation SAS on Azure
   (`getUserDelegationKey`); the Azure adapter gains `DefaultAzureCredential`. The probe (point 6)
   validates the chosen mode.

4. **Customer media lives in private buckets and is read through short-lived signed URLs**
   (option B). Validity is short for previews in the portals, and long enough — hours — for each
   network to download the file at publish time, since Instagram, Facebook and TikTok fetch by URL,
   sometimes minutes later. The port gains a signed-read method, implemented per adapter: a presigned
   `GetObject` on S3 and Spaces, `getSignedUrl` with action `read` on GCS, a read SAS on Azure.
5. **The database stores object keys, not provider URLs.** The five URL columns are migrated to keys
   with a data migration, one key layout is used by every adapter, and URLs are derived when needed
   instead of persisted. This is also the prerequisite for any future migration between platforms.
6. **Health comes from a `probe()` on each adapter**:
   `probe({ timeoutMs })` → `Result<{ latencyMs, provider, target }, UNAUTHORIZED | NOT_FOUND | MISCONFIGURED | TIMEOUT | SERVICE_ERROR>`,
   one attempt, bypassing the circuit breaker. S3 and Spaces use `HeadBucketCommand`; GCS uses
   `bucket.getMetadata()` with `StorageOptions.timeout`, `retryOptions` and a `Promise.race`; Azure
   uses `containerClient.getProperties()`, never `exists()`. The checker takes its thresholds from
   `HealthCheckConfig`, and the tenant monitor reuses the same probe and reads usage from the
   database.
7. **A storage outage degrades the application and never takes it down** (option B). The storage
   health check is registered with `critical: false`: a failing probe reports **DEGRADED**, and the
   load balancer keeps routing. Login, analytics, text-only posts and the inbox keep working.
   Uploads and media publishes fail with a clear message; media publish jobs back off and retry on a
   storage error class instead of failing permanently. Admin gets **one alert per outage**, not one
   per request.
8. **The Cloudinary adapter is deleted** (option B): the package, its workspace and lockfile entries,
   its tsconfig references and any jscpd, knip or population entries, in one change. Fitness #42's
   manifest floor (90) must still hold. Cloudinary is a media-transformation platform priced by
   credits, not a plain object store, and OmniPost already processes its own media; transformations,
   if ever wanted, are evaluated as a separate service.
9. **The Instagram provider uses the configured storage port**, injected through the composition
   root, and its own `AWS_*` S3 adapter is removed (finding F3).

## Rationale

1. **One configuration source is the only one an operator can trust.** F15 is what two sources
   look like: the visible one does nothing.
2. **The lock protects data that cannot be moved.** With no migration path, changing provider after
   the first upload would orphan every stored object; making the lock a persisted fact means no UI
   path can bypass it.
3. **No stored secret is the safest secret.** Where the cloud provides an identity, OmniPost holds
   nothing that can leak.
4. **Private by default.** Customer media served from a public bucket is readable by anyone who
   guesses or keeps a URL; a signed URL expires.
5. **Keys survive a provider change; URLs do not.** Persisting keys removes provider coupling from
   every row and makes migration possible later.
6. **Storage is not needed for most of the product.** Taking the whole application out of rotation
   because uploads fail would turn a partial outage into a total one.

## Alternatives Considered

- **Configure storage in the deploy environment only** (option A). Not chosen: Edward chose Admin
  setup; either way one of the two sources had to go.
- **Keep both the environment and Admin.** Rejected: that is F15.
- **Public buckets with persisted public URLs** (today's implicit design). Rejected for private
  buckets and signed reads.
- **Keys only.** Rejected: it forces a stored secret where the platform offers an identity.
- **Storage as a critical health check** (option A). Rejected: an upload outage would take login and
  analytics down with it.
- **Keep Cloudinary as a storage option.** Rejected: it is a transformation service, unused, and not
  a plain object store.
- **Offer migration between platforms now.** Deferred to research; this ADR only removes the
  obstacles (keys, one layout).

## Consequences

**Positive**

- What Admin shows is what runs, and the provider cannot change under stored data.
- GCS and Azure become real options; AWS, GCP and Azure installs can run with no storage secret.
- Media is private, and a stored row no longer names a provider.
- Health tells the truth, and a storage outage stays a storage outage.

**Negative / costs**

- **A data migration** rewrites five URL columns into keys, and every reader of those columns
  changes with it.
- **Every media read goes through a signed URL**, generated per request, with validity chosen per
  use (preview or network fetch).
- **The storage secrets documentation changes**: `docs/security/SECRETS.md`,
  `docs/deployment/ENVIRONMENT_VARIABLES.md` and `docs/architecture/secrets-and-env.md` lose the
  storage variables in the slice that removes them.
- **Local development and CI need a configuration source** that is not an environment fallback: the
  `local` value of today's enum builds the S3 adapter against MinIO or LocalStack through
  `S3_ENDPOINT`. The Admin S3 option has an `endpoint` field, so the same backends stay usable, but
  how a fresh development database gets its storage configuration is decided in the slice.
- **DigitalOcean Spaces is S3-compatible**; `packages/adapters/storage-do-spaces` only wraps
  `storage-s3` and the `do-spaces` branch bypasses it (`docs/reports/UNUSED_CODE_INVENTORY.md`).
  Whether that wrapper survives is an implementation detail of the setup slice, not a product
  choice.

## Revisit if

- Moving storage between platforms is wanted: the research item reopens the lock.
- A provider gains or loses a workload-identity option, or a way to cap upload size in a signed
  permission.
- A network stops fetching media by URL, which changes the signed-read validity it needs.

## Risks and Mitigations

| Risk                                                       | Mitigation                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| An operator changes provider after objects exist           | The lock is persisted at the first stored object and enforced by the API, not only hidden in the UI                           |
| A signed URL expires before a network fetches the media    | Publish-time URLs use an hours-long validity, separate from the short preview validity                                        |
| A keyless install cannot sign reads                        | GCS needs `iam.serviceAccounts.signBlob`, Azure a user-delegation key; the probe validates the chosen mode before it is saved |
| The URL-to-key migration misreads a URL                    | The migration is tested against each provider's URL shape, including path-style addressing and Spaces                         |
| A storage outage leaves media publishes failed for good    | Media publish jobs back off and retry on the storage error class; one Admin alert per outage                                  |
| Instagram keeps a public-URL path after buckets go private | Instagram moves onto the configured port and signed reads before any bucket is made private                                   |

## References

- Research: [research-2026-10-04-storage.md](../reports/research-2026-10-04-storage.md) — Report 2
  (health per provider, upload-size enforcement, migration tools and prerequisites, and where its
  open questions were answered).
- Specification: [media-storage.md](../features/media-storage.md).
- Backlog: SMELL-186 (F15) in [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md).
- Code: `apps/api/src/infrastructure/storage/createStorageAdapter.ts`; `apps/api/src/config/env.ts:182`;
  `packages/ports/src/StoragePort.ts`; `packages/providers/instagram/src/apiClient.ts:470-479`, `:500`;
  `packages/providers/instagram/src/mediaProcessor.ts:277`, `:397`, `:495`;
  `packages/monitoring/health-checks/src/checkers/storage.ts`;
  `packages/monitoring/health-checks/src/tenantHealth.ts`; `packages/adapters/storage-cloudinary/`;
  `apps/admin/components/settings/constants.ts`; `apps/api/src/settings/settingsSchemas.ts`;
  `packages/core/settings/src/SettingsService.ts`.
- Canon: `docs/security/SECURITY_CANON.md` §Secrets and Environment (no fallbacks);
  `docs/architecture/ARCHITECTURE_CANON.md` §Dependency Injection; `CLAUDE.md` fitness #42.
