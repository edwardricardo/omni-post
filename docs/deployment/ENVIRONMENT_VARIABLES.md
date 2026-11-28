# Environment Variables Reference

Reference for the environment variables of the API, the workers and the two portals. Organized by category with defaults and required status.

The four schemas are the source: [`apps/api/src/config/env.ts`](../../apps/api/src/config/env.ts) (the API), [`apps/workers/src/config/env.ts`](../../apps/workers/src/config/env.ts) (the workers), [`apps/admin/lib/env.ts`](../../apps/admin/lib/env.ts) and [`apps/client/lib/env.ts`](../../apps/client/lib/env.ts) (the portals). A variable is **required** when its schema entry has neither `.optional()` nor a default: the process refuses to boot without it, naming each variable that is missing or malformed. Where this page and a schema disagree, the schema wins. A variable marked **read outside the schemas** is read from `process.env` by the code its row names and is not validated at boot.

`apps/api/tests/unit/scripts/environmentVariablesPage.test.ts` fails when this page does not name a key the API's or the workers' schema requires, or a key a portal's schema declares.

What an operator configures for a deployment, and the evidence for each requirement, is [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md). For development, `pnpm start:platform` writes every required variable into the root `.env` of a checkout that has none ([getting-started.md](../development/getting-started.md#quick-start)).

---

## Quick Reference: Required Variables

The API refuses to boot without these fifteen, and the workers without three of them. The portals require none. `pnpm start:platform` generates all fifteen in a checkout with no `.env`, each secret random and each address on the loopback, on the port the run starts that app on: the API's on the `PORT` the run gives it, the client portal's on the port its `dev` script fixes. A run with `--services-only` starts neither app and writes their default ports, 3000 and 3200 (`scripts/start/lib/start-environment.mjs`).

| Variable                        | Deployables                   | Example                                                   |
| ------------------------------- | ----------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                  | api, workers                  | `postgresql://user:pass@host:5432/omnipostdb`             |
| `SHADOW_DATABASE_URL`           | api                           | `postgresql://user:pass@host:5432/omnipostdb_shadow`      |
| `REDIS_URL`                     | api, workers                  | `redis://host:6379`                                       |
| `JWT_ACCESS_SECRET`             | api                           | 32 characters or more                                     |
| `JWT_REFRESH_SECRET`            | api                           | 32 characters or more                                     |
| `CUSTOMER_JWT_SECRET`           | api                           | 32 characters or more                                     |
| `ADMIN_JWT_ACCESS_SECRET`       | api                           | 32 characters or more                                     |
| `ADMIN_JWT_REFRESH_SECRET`      | api                           | 32 characters or more                                     |
| `COOKIE_SECRET`                 | api                           | 32 characters or more                                     |
| `PLATFORM_ENCRYPTION_KEY`       | api, workers, the same values | 32 characters or more                                     |
| `OAUTH_ENCRYPTION_KEY`          | api                           | 32 characters or more; no code reads it (DEF-44)          |
| `DELETION_NAME_DIGEST_KEY_RING` | api                           | `{"1":"<64 lowercase hex characters>"}`                   |
| `CLIENT_URL`                    | api                           | An `http` or `https` origin: `https://app.yourdomain.com` |
| `API_BASE_URL`                  | api                           | An `http` or `https` origin: `https://api.yourdomain.com` |
| `APP_BASE_URL`                  | api                           | An `http` or `https` origin: `https://api.yourdomain.com` |

`NODE_ENV` and `PORT` are not required: unset, they are `development` and `3000`. The three public addresses have no default: the links, redirects and callback URLs the API builds toward the client portal, a webhook sender and an identity provider start with one of them ([Core Application](#core-application)).

---

## Core Application

| Variable       | Required | Default       | Description                                                                                                                                                                                                                           |
| -------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | No       | `development` | `development`, `production`, `test` or `staging` for the API and the workers; `development`, `production` or `test` for the portals                                                                                                   |
| `PORT`         | No       | `3000`        | API server listening port                                                                                                                                                                                                             |
| `CLIENT_URL`   | Yes      | --            | The client portal's public origin, `http` or `https` and nothing more: password reset, referral and e-mail links, the payment gateway's return URLs and the redirect that ends a provider connection                                  |
| `API_BASE_URL` | Yes      | --            | The API's public origin, `http` or `https` and nothing more, as a webhook subscription names it: `<API_BASE_URL>/webhooks/<provider>`                                                                                                 |
| `APP_BASE_URL` | Yes      | --            | The API's public origin, `http` or `https` and nothing more, as single sign-on names it: the OIDC `redirect_uri` (`<APP_BASE_URL>/auth/oidc/<account>/callback`) and the SAML ACS URL (`<APP_BASE_URL>/auth/saml/<account>/callback`) |

The three public addresses have no default, and no reader falls back to another host: the API refuses to boot without each of them, naming it and never its value. Each is an `http` or `https` origin written as the origin serializes ([URL Standard](https://url.spec.whatwg.org/#concept-url-origin), [RFC 6454 §6.2](https://www.rfc-editor.org/rfc/rfc6454#section-6.2)): the scheme, the host, and a port only when it is not the scheme's default, in lowercase, with no credentials, path, query, fragment or trailing slash, since every reader appends a path that starts with `/`. `https://app.example.com` and `http://127.0.0.1:3200` are origins; `https://app.example.com/`, `https://app.example.com:443`, `https://user@app.example.com`, `HTTPS://APP.EXAMPLE.COM` and `localhost:3200` refuse the boot. `API_BASE_URL` and `APP_BASE_URL` both name the API, so they hold the same origin when one host serves it.

---

## Database

| Variable               | Required | Default        | Description                                                                                                                                                                                  |
| ---------------------- | -------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Yes      | --             | The application's PostgreSQL connection, for the API and the workers; SSL in production                                                                                                      |
| `SHADOW_DATABASE_URL`  | Yes      | --             | A separate, empty database. Only `prisma migrate dev` uses it (`infra/prisma/prisma.config.ts`), and the API requires it at boot all the same (CRED-1 makes it optional)                     |
| `MIGRATE_DATABASE_URL` | No       | `DATABASE_URL` | The owner channel the migrations connect over; `infra/prisma/prisma.config.ts` uses `DATABASE_URL` when it is absent or empty ([ADR-0022](../technical/ADR-0022-rls-enforcement-posture.md)) |

### Connection String Format

```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
```

| Cloud          | Typical Port | SSL Required | Notes                        |
| -------------- | ------------ | ------------ | ---------------------------- |
| Local          | 5432         | No           | `?sslmode=disable` or omit   |
| AWS RDS        | 5432         | Yes          | `?sslmode=require`           |
| Azure Flexible | 5432         | Yes          | `?sslmode=require`           |
| GCP Cloud SQL  | 5432         | Yes          | Private IP via VPC connector |
| DigitalOcean   | 25060        | Yes          | Use private network URI      |

---

## Redis

| Variable         | Required | Default | Description                                                                                                                                                                                               |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`      | Yes      | --      | Redis connection string, for the API and the workers                                                                                                                                                      |
| `REDIS_HOST`     | No       | --      | Kept for compatibility. `getRedisUrl` (`apps/api/src/lib/redis.ts`) builds a URL from these three, with `localhost` and `6379` when unset, only when `REDIS_URL` is empty, which the API's schema refuses |
| `REDIS_PORT`     | No       | --      | As `REDIS_HOST`                                                                                                                                                                                           |
| `REDIS_PASSWORD` | No       | --      | As `REDIS_HOST`                                                                                                                                                                                           |

### Connection String Format

```
redis://HOST:PORT                    # No auth
redis://:PASSWORD@HOST:PORT          # With auth
rediss://:PASSWORD@HOST:PORT         # TLS (managed services)
```

| Cloud           | Typical Port | TLS | Notes                    |
| --------------- | ------------ | --- | ------------------------ |
| Local           | 6379         | No  | `redis://localhost:6379` |
| AWS ElastiCache | 6379         | Yes | `rediss://` prefix       |
| Azure Cache     | 6380         | Yes | `rediss://` prefix       |
| GCP Memorystore | 6379         | No  | Private IP, no auth      |
| DigitalOcean    | 25061        | Yes | `rediss://` prefix       |

---

## Authentication and Security

| Variable                              | Required | Default | Description                                                                                                                                                           |
| ------------------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`                   | Yes      | --      | Access token signing secret; 32 characters or more                                                                                                                    |
| `JWT_REFRESH_SECRET`                  | Yes      | --      | Refresh token signing secret; 32 characters or more                                                                                                                   |
| `ADMIN_JWT_ACCESS_SECRET`             | Yes      | --      | Admin panel access token secret; 32 characters or more                                                                                                                |
| `ADMIN_JWT_REFRESH_SECRET`            | Yes      | --      | Admin panel refresh token secret; 32 characters or more                                                                                                               |
| `CUSTOMER_JWT_SECRET`                 | Yes      | --      | Customer-facing JWT secret; 32 characters or more                                                                                                                     |
| `COOKIE_SECRET`                       | Yes      | --      | Cookie signing secret; 32 characters or more                                                                                                                          |
| `JWT_SECRET`                          | No       | --      | Declared by the schema and read by no code; CRED-1 removes it                                                                                                         |
| `PLATFORM_ENCRYPTION_KEY`             | Yes      | --      | Encrypts channel and platform credentials; 32 characters or more. The API and the workers hold the same value                                                         |
| `PLATFORM_ENCRYPTION_KEY_VERSION`     | No       | `1`     | The key version the API stamps and the workers resolve                                                                                                                |
| `PLATFORM_ENCRYPTION_KEY_V1`          | No       | --      | With `PLATFORM_ENCRYPTION_KEY_V2` and `PLATFORM_ENCRYPTION_KEY_V3`, the prior-version keys of a rotation window (`packages/shared/src/platformEncryptionKeyEnv.ts`)   |
| `OAUTH_ENCRYPTION_KEY`                | Yes      | --      | Required at boot, 32 characters or more, and read by no code (DEF-44; DC-3 deletes it)                                                                                |
| `DELETION_NAME_DIGEST_KEY_RING`       | Yes      | --      | The HMAC key ring that turns a tombstone's plaintext name into a keyed digest when its retention closes: JSON, one 64-lowercase-hex entry per generation, append-only |
| `DELETION_NAME_DIGEST_ACTIVE_VERSION` | No       | `1`     | The ring generation new digests are computed under; it must name an entry of the ring                                                                                 |

### Generating Secrets

```bash
# The six signing secrets and OAUTH_ENCRYPTION_KEY (32 characters or more each)
openssl rand -hex 32

# PLATFORM_ENCRYPTION_KEY
openssl rand -base64 32

# DELETION_NAME_DIGEST_KEY_RING, with its first generation
printf '{"1":"%s"}\n' "$(openssl rand -hex 32)"
```

**No fallback**: no required secret has a default in any environment. A missing value, or one shorter than 32 characters, stops the API at boot with the name of each offending variable.

---

## Storage

The `STORAGE_PROVIDER` variable selects the storage backend. Each provider requires its own set of configuration variables.

| Variable           | Required | Default | Description                                   |
| ------------------ | -------- | ------- | --------------------------------------------- |
| `STORAGE_PROVIDER` | No       | `local` | Storage backend: `s3`, `local` or `do-spaces` |

### S3 (AWS or S3-compatible)

Used when `STORAGE_PROVIDER=s3`, and by `local` (the default), which builds the same adapter and takes the bucket and region below when they are unset (`apps/api/src/infrastructure/storage/createStorageAdapter.ts`).

| Variable               | Required  | Default                        | Description                                                                                              |
| ---------------------- | --------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `S3_BUCKET`            | With `s3` | `omni-post-media` with `local` | S3 bucket name                                                                                           |
| `S3_REGION`            | With `s3` | `us-east-1` with `local`       | AWS region                                                                                               |
| `S3_ACCESS_KEY_ID`     | No        | --                             | IAM access key. Both keys or neither: with neither, the AWS SDK's default credential chain resolves them |
| `S3_SECRET_ACCESS_KEY` | No        | --                             | IAM secret key. Both keys or neither                                                                     |
| `S3_ENDPOINT`          | No        | AWS default                    | Custom endpoint (MinIO, etc.); it switches the adapter to path-style addressing                          |

For local development with MinIO, which `pnpm start:platform` does not start (`docker compose up -d minio minio-init` starts it and creates the `omni-post-media` bucket), with the MinIO root credentials of `.env`:

```env
STORAGE_PROVIDER=local
S3_ACCESS_KEY_ID=<MINIO_ROOT_USER>
S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
S3_ENDPOINT=http://localhost:9000
```

### DigitalOcean Spaces

Used when `STORAGE_PROVIDER=do-spaces`. Reuses the S3 adapter internally with a custom endpoint.

| Variable             | Required | Description                                           |
| -------------------- | -------- | ----------------------------------------------------- |
| `DO_SPACES_BUCKET`   | Yes      | Spaces bucket name                                    |
| `DO_SPACES_REGION`   | Yes      | Spaces region (`nyc3`, `sfo3`, `ams3`, etc.)          |
| `DO_SPACES_KEY`      | Yes      | Spaces access key                                     |
| `DO_SPACES_SECRET`   | Yes      | Spaces secret key                                     |
| `DO_SPACES_ENDPOINT` | Yes      | Spaces endpoint (e.g., `nyc3.digitaloceanspaces.com`) |

```env
STORAGE_PROVIDER=do-spaces
DO_SPACES_BUCKET=omnipost-media
DO_SPACES_REGION=nyc3
DO_SPACES_KEY=DO00XXXXXXXXXXXX
DO_SPACES_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
```

### Azure Blob Storage and Google Cloud Storage

Not selectable. `packages/adapters/storage-azure` and `packages/adapters/storage-gcs` hold adapters, but no app declares them, `createStorageAdapter` builds only the S3 and DigitalOcean Spaces adapters, and the API's schema accepts only `s3`, `local` and `do-spaces`: `STORAGE_PROVIDER=azure` or `gcs` stops the API at boot.

### Instagram Provider (AWS S3)

The Instagram provider uses separate S3 variables for media processing, read outside the schemas (`packages/providers/instagram/src/mediaProcessor.ts`):

| Variable        | Required           | Description                   |
| --------------- | ------------------ | ----------------------------- |
| `AWS_REGION`    | For Instagram only | AWS region for media bucket   |
| `AWS_S3_BUCKET` | For Instagram only | S3 bucket for Instagram media |

---

## Email

| Variable              | Required   | Default                | Description                  |
| --------------------- | ---------- | ---------------------- | ---------------------------- |
| `RESEND_API_KEY`      | Production | --                     | Resend API key for email     |
| `RESEND_FROM_ADDRESS` | No         | `reports@omnipost.app` | Default sender email address |

If `RESEND_API_KEY` is not set, the email adapter logs a warning and skips delivery (useful for development). No code sends over SMTP.

---

## AI Providers

All AI keys are optional. The AI orchestrator auto-detects available providers based on which keys are set. At least one provider should be configured for AI features to work.

| Variable             | Required | Default                             | Description           |
| -------------------- | -------- | ----------------------------------- | --------------------- |
| `OPENAI_API_KEY`     | No       | --                                  | OpenAI API key        |
| `OPENAI_MODEL`       | No       | `gpt-4`                             | OpenAI model name     |
| `GEMINI_API_KEY`     | No       | --                                  | Google Gemini API key |
| `GEMINI_MODEL`       | No       | `gemini-1.5-flash`                  | Gemini model name     |
| `PERPLEXITY_API_KEY` | No       | --                                  | Perplexity API key    |
| `PERPLEXITY_MODEL`   | No       | `llama-3.1-sonar-small-128k-online` | Perplexity model name |

The three model defaults are the orchestrator's fallbacks (`apps/api/src/ai/orchestrator.ts`), not defaults of the schema. Provider priority order: OpenAI > Perplexity > Gemini (first available is used as primary).

---

## Payment Processing

| Variable           | Required | Default | Description                                   |
| ------------------ | -------- | ------- | --------------------------------------------- |
| `PAYMENT_PROVIDER` | No       | `none`  | Payment backend: `stripe`, `paddle` or `none` |

### Stripe

Used when `PAYMENT_PROVIDER=stripe`.

| Variable                | Required     | Description                   |
| ----------------------- | ------------ | ----------------------------- |
| `STRIPE_SECRET_KEY`     | For payments | Stripe secret API key         |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Stripe webhook signing secret |

### Paddle

Used when `PAYMENT_PROVIDER=paddle`.

| Variable                | Required     | Description                   |
| ----------------------- | ------------ | ----------------------------- |
| `PADDLE_API_KEY`        | For payments | Paddle API key                |
| `PADDLE_WEBHOOK_SECRET` | For webhooks | Paddle webhook signing secret |
| `PADDLE_SANDBOX`        | No           | `true` for sandbox mode       |

---

## Observability and Logging

| Variable                      | Required | Default                 | Description                                                                                                       |
| ----------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TRACING_ENABLED`             | No       | `false`                 | Enable OpenTelemetry tracing, in the API and the workers                                                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No       | `http://localhost:4318` | OTLP HTTP endpoint (Jaeger, etc.); read outside the schemas (`packages/observability/opentelemetry/src/index.ts`) |
| `OTEL_SERVICE_NAME`           | No       | `omnipost-api`          | Service name in traces; read outside the schemas. Unset, the workers report as `omnipost-worker`                  |
| `LOG_LEVEL`                   | No       | `info`                  | Pino log level, in the API and the workers: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`        |

Set `TRACING_ENABLED=true` to activate OpenTelemetry SDK initialization. The tracing SDK must initialize before any other imports (handled by the API entry point).

---

## Workers

The workers validate their variables through their own schema, [`apps/workers/src/config/env.ts`](../../apps/workers/src/config/env.ts). Their `dev` script names the root `.env` on Node's command line, as the API's does, so the file is loaded before any module runs. The schema module then loads the root `.env`, or `.env.test` when `NODE_ENV` is `test`, when that file is present, and a variable already set keeps its value: under `NODE_ENV=test`, `dev` reads `.env`, and `.env.test` sets only what `.env` leaves unset.

| Variable                  | Required | Default       | Description                                                                                                                                                                                   |
| ------------------------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Yes      | --            | The API's database                                                                                                                                                                            |
| `REDIS_URL`               | Yes      | --            | The API's Redis: the queues the workers consume                                                                                                                                               |
| `PLATFORM_ENCRYPTION_KEY` | Yes      | --            | The API's value, with `PLATFORM_ENCRYPTION_KEY_VERSION` and `PLATFORM_ENCRYPTION_KEY_V1` to `PLATFORM_ENCRYPTION_KEY_V3` as in the API, so the workers resolve the key version the API stamps |
| `METRICS_PORT`            | No       | `3300`        | The port of the workers' `/metrics` and health routes (`apps/workers/src/bootstrap.ts`)                                                                                                       |
| `TRACING_ENABLED`         | No       | `false`       | As in the API                                                                                                                                                                                 |
| `LOG_LEVEL`               | No       | `info`        | As in the API                                                                                                                                                                                 |
| `NODE_ENV`                | No       | `development` | As in the API; it also chooses the environment file the workers load                                                                                                                          |

---

## Portals (Next.js)

The administration portal ([`apps/admin/lib/env.ts`](../../apps/admin/lib/env.ts)) and the client portal ([`apps/client/lib/env.ts`](../../apps/client/lib/env.ts)) validate their variables through `@t3-oss/env-nextjs`, and neither requires any: each variable has a default or is optional. A `NEXT_PUBLIC_` variable is exposed to the browser bundle.

| Variable                 | Portals       | Required | Default                 | Description                                                                                                                                                                                                                               |
| ------------------------ | ------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_URL`                | admin, client | No       | `http://localhost:3000` | The API the portal's server-side code calls (its backend proxy and its server actions). `pnpm start:platform` passes `http://127.0.0.1:<the API's port>` unless the calling shell sets one                                                |
| `SENTRY_DSN`             | admin, client | No       | --                      | Server-side Sentry DSN ([Sentry, end to end](DEPLOYMENT_CHECKLIST.md#sentry-end-to-end))                                                                                                                                                  |
| `NEXT_PUBLIC_API_URL`    | admin, client | No       | `http://localhost:3000` | The API URL exposed to the browser bundle                                                                                                                                                                                                 |
| `NEXT_PUBLIC_URL`        | admin         | No       | `http://localhost:3100` | The administration portal's public origin, used for self-redirects and link generation                                                                                                                                                    |
| `NEXT_PUBLIC_SENTRY_DSN` | admin, client | No       | --                      | Browser Sentry DSN                                                                                                                                                                                                                        |
| `API_BASE_URL`           | client        | No       | `http://localhost:3000` | Declared beside `API_URL` with the same default; no module of the portal reads it (plan row CLIENT-API-BASE-URL-UNREAD, `docs/product/plan/cross-cutting.md`). It is not the API's `API_BASE_URL` ([Core Application](#core-application)) |
| `NODE_ENV`               | admin, client | No       | `development`           | `development`, `production` or `test`                                                                                                                                                                                                     |

---

## Video Processing

| Variable             | Required | Default                  | Description                       |
| -------------------- | -------- | ------------------------ | --------------------------------- |
| `FFMPEG_PATH`        | No       | `ffmpeg`                 | Path to ffmpeg binary             |
| `FFPROBE_PATH`       | No       | `ffprobe`                | Path to ffprobe binary            |
| `VIDEO_TEMP_DIR`     | No       | `/tmp/claude/video`      | Temp dir for video processing     |
| `THUMBNAIL_TEMP_DIR` | No       | `/tmp/claude/thumbnails` | Temp dir for thumbnail generation |

Ensure ffmpeg is installed on the host or in the Docker image for video features.

---

## CRM Integrations (Optional)

| Variable                  | Required | Description                   |
| ------------------------- | -------- | ----------------------------- |
| `HUBSPOT_CLIENT_ID`       | No       | HubSpot OAuth client ID       |
| `HUBSPOT_REDIRECT_URI`    | No       | HubSpot OAuth redirect URI    |
| `SALESFORCE_CLIENT_ID`    | No       | Salesforce OAuth client ID    |
| `SALESFORCE_REDIRECT_URI` | No       | Salesforce OAuth redirect URI |
| `SALESFORCE_SANDBOX`      | No       | `true` for Salesforce sandbox |

---

## Analytics (Optional)

| Variable             | Required | Description                             |
| -------------------- | -------- | --------------------------------------- |
| `GA4_MEASUREMENT_ID` | No       | Google Analytics 4 measurement ID       |
| `GA4_API_SECRET`     | No       | GA4 Measurement Protocol API secret     |
| `GA4_ENDPOINT`       | No       | GA4 endpoint (default: Google's MP URL) |

---

## Security (Optional)

| Variable              | Required | Default | Description                                                                                                                          |
| --------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ALLOWED_MEDIA_HOSTS` | No       | --      | Comma-separated list of allowed media host domains                                                                                   |
| `API_DOCS_ENABLED`    | No       | `false` | Serves the OpenAPI document at `/docs/json` and `/docs/openapi.yaml`; the document maps every route, so leave it unset in production |

---

## Storage Provider by Cloud

Quick reference for which `STORAGE_PROVIDER` and related vars to use per cloud:

| Cloud         | STORAGE_PROVIDER    | Key Variables                                                                                          |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| Local (MinIO) | `local`             | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`                                              |
| AWS           | `s3`                | `S3_BUCKET`, `S3_REGION`, and `S3_ACCESS_KEY_ID` with `S3_SECRET_ACCESS_KEY` or the host's credentials |
| Azure         | -- (not selectable) | --                                                                                                     |
| GCP           | -- (not selectable) | --                                                                                                     |
| DigitalOcean  | `do-spaces`         | `DO_SPACES_BUCKET`, `DO_SPACES_REGION`, `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_ENDPOINT`      |

---

## Frontend Build (Next.js)

Governs how Turbopack/Next resolves modules when building/serving `apps/admin` and
`apps/client`. See [ADR-0017 §4](../technical/ADR-0017-production-build-bundler.md).

| Variable              | Required | Default             | Description                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | -------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_TURBOPACK_ROOT` | No       | the repository root | Overrides `turbopack.root` and `outputFileTracingRoot` of `apps/admin/next.config.mjs` and `apps/client/next.config.mjs`; read outside the schemas. Unset, both are the repository root (`path.resolve(import.meta.dirname, "../..")`). The Dockerfiles set it to `/app`, the container's workspace root (`apps/admin/Dockerfile:69`, `apps/client/Dockerfile:69`) |

---

## Sample .env Files

### Minimal Local Development

`pnpm start:platform` writes it. In a checkout with no `.env`, the command generates one with these variables, every secret random, adding `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT` (and their ports in the URLs) when the calling shell sets them, and it never rewrites an existing file (`scripts/start/lib/start-environment.mjs`). Docker Compose requires the Grafana and MinIO variables whatever services it starts; the API requires the fifteen after them.

```env
POSTGRES_USER=omnipost
POSTGRES_PASSWORD=<random>
POSTGRES_DB=omnipostdb
GF_SECURITY_ADMIN_USER=admin
GF_SECURITY_ADMIN_PASSWORD=<random>
MINIO_ROOT_USER=omnipost
MINIO_ROOT_PASSWORD=<random>
DATABASE_URL=postgresql://omnipost:<POSTGRES_PASSWORD>@127.0.0.1:5432/omnipostdb
SHADOW_DATABASE_URL=postgresql://omnipost:<POSTGRES_PASSWORD>@127.0.0.1:5432/omnipostdb_shadow
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=<random>
JWT_REFRESH_SECRET=<random>
CUSTOMER_JWT_SECRET=<random>
ADMIN_JWT_ACCESS_SECRET=<random>
ADMIN_JWT_REFRESH_SECRET=<random>
COOKIE_SECRET=<random>
PLATFORM_ENCRYPTION_KEY=<random>
OAUTH_ENCRYPTION_KEY=<random>
DELETION_NAME_DIGEST_KEY_RING='{"1":"<random>"}'
CLIENT_URL=http://127.0.0.1:3200
API_BASE_URL=http://127.0.0.1:3000
APP_BASE_URL=http://127.0.0.1:3000
```

### Production (Generic)

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:STRONG_PASSWORD@db-host:5432/omnipostdb?sslmode=require
SHADOW_DATABASE_URL=postgresql://user:STRONG_PASSWORD@db-host:5432/omnipostdb_shadow?sslmode=require
REDIS_URL=rediss://:REDIS_PASSWORD@redis-host:6379
API_BASE_URL=https://api.yourdomain.com
CLIENT_URL=https://app.yourdomain.com
APP_BASE_URL=https://api.yourdomain.com
JWT_ACCESS_SECRET=<openssl rand -hex 64>
JWT_REFRESH_SECRET=<openssl rand -hex 64>
ADMIN_JWT_ACCESS_SECRET=<openssl rand -hex 64>
ADMIN_JWT_REFRESH_SECRET=<openssl rand -hex 64>
CUSTOMER_JWT_SECRET=<openssl rand -hex 64>
COOKIE_SECRET=<openssl rand -hex 64>
PLATFORM_ENCRYPTION_KEY=<openssl rand -base64 32>
OAUTH_ENCRYPTION_KEY=<openssl rand -hex 32>
DELETION_NAME_DIGEST_KEY_RING='{"1":"<openssl rand -hex 32>"}'
STORAGE_PROVIDER=s3
S3_BUCKET=your-media-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
S3_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_ADDRESS=notifications@yourdomain.com
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_<YOUR_STRIPE_LIVE_KEY>
STRIPE_WEBHOOK_SECRET=whsec_<YOUR_WEBHOOK_SECRET>
LOG_LEVEL=info
TRACING_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otel-collector:4318
OTEL_SERVICE_NAME=omnipost-api
```

---

## Security Best Practices

1. **Never commit `.env` files** to version control. The `.gitignore` already excludes them.
2. **Use secret managers** in production (AWS Secrets Manager, Azure Key Vault, GCP Secret Manager).
3. **Rotate secrets periodically**. JWT secrets can be rotated with a grace period for active tokens.
4. **Use different secrets** for each environment (development, staging, production).
5. **Restrict database access** to application hosts only (VPC, firewall rules, trusted sources).
6. **Use TLS connections** (`sslmode=require` for PostgreSQL, `rediss://` for Redis) in production.
