# Environment Variables Reference

Complete reference for all OmniPost environment variables. Organized by category with defaults and required status per deployment target.

---

## Quick Reference: Required Variables

Every deployment **must** configure these variables. The application will not start correctly without them.

| Variable             | Example                                       |
| -------------------- | --------------------------------------------- |
| `NODE_ENV`           | `production`                                  |
| `PORT`               | `3000`                                        |
| `DATABASE_URL`       | `postgresql://user:pass@host:5432/omnipostdb` |
| `REDIS_URL`          | `redis://host:6379`                           |
| `JWT_SECRET`         | 64-byte hex string                            |
| `JWT_REFRESH_SECRET` | 64-byte hex string                            |
| `API_BASE_URL`       | `https://api.yourdomain.com`                  |
| `CLIENT_URL`         | `https://app.yourdomain.com`                  |
| `ADMIN_URL`          | `https://admin.yourdomain.com`                |

---

## Core Application

| Variable       | Required | Default       | Description                            |
| -------------- | -------- | ------------- | -------------------------------------- |
| `NODE_ENV`     | Yes      | `development` | `development`, `production`, or `test` |
| `PORT`         | Yes      | `3000`        | API server listening port              |
| `API_BASE_URL` | Yes      | --            | Public URL of the API server           |
| `CLIENT_URL`   | Yes      | --            | Public URL of the client application   |
| `ADMIN_URL`    | Yes      | --            | Public URL of the admin dashboard      |
| `APP_BASE_URL` | Yes      | --            | Base URL for OAuth callbacks and SAML  |

---

## Database

| Variable       | Required | Default | Description                                   |
| -------------- | -------- | ------- | --------------------------------------------- |
| `DATABASE_URL` | Yes      | --      | PostgreSQL connection string with SSL in prod |

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

| Variable         | Required | Default     | Description                    |
| ---------------- | -------- | ----------- | ------------------------------ |
| `REDIS_URL`      | Yes      | --          | Redis connection string        |
| `REDIS_HOST`     | No       | `localhost` | Used if `REDIS_URL` is not set |
| `REDIS_PORT`     | No       | `6379`      | Used if `REDIS_URL` is not set |
| `REDIS_PASSWORD` | No       | --          | Used if `REDIS_URL` is not set |

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

| Variable                   | Required   | Default                           | Description                                |
| -------------------------- | ---------- | --------------------------------- | ------------------------------------------ |
| `JWT_SECRET`               | Production | auto-generated (dev only)         | Access token signing secret                |
| `JWT_REFRESH_SECRET`       | Production | auto-generated (dev only)         | Refresh token signing secret               |
| `ADMIN_JWT_ACCESS_SECRET`  | Production | `admin-jwt-access-dev-only`       | Admin panel access token secret            |
| `ADMIN_JWT_REFRESH_SECRET` | Production | `admin-jwt-refresh-dev-only`      | Admin panel refresh token secret           |
| `CUSTOMER_JWT_SECRET`      | Production | `customer-jwt-dev-only-change-me` | Customer-facing JWT secret                 |
| `OAUTH_ENCRYPTION_KEY`     | Production | auto-generated (dev only)         | 32-byte hex key for OAuth token encryption |

### Generating Secrets

```bash
# JWT secrets (64 bytes)
openssl rand -hex 64

# OAuth encryption key (32 bytes)
openssl rand -hex 32
```

**Warning**: In development, fallback secrets are used automatically. In production (`NODE_ENV=production`), the application logs warnings for missing secrets and some features may fail. Always set explicit secrets in production.

---

## Storage

The `STORAGE_PROVIDER` variable selects the storage backend. Each provider requires its own set of configuration variables.

| Variable           | Required | Default | Description                                        |
| ------------------ | -------- | ------- | -------------------------------------------------- |
| `STORAGE_PROVIDER` | No       | `s3`    | Storage backend: `s3`, `do-spaces`, `azure`, `gcs` |

### S3 (AWS or S3-compatible)

Used when `STORAGE_PROVIDER=s3` (default).

| Variable               | Required | Default           | Description                   |
| ---------------------- | -------- | ----------------- | ----------------------------- |
| `S3_BUCKET`            | No       | `omni-post-media` | S3 bucket name                |
| `S3_REGION`            | No       | `us-east-1`       | AWS region                    |
| `S3_ACCESS_KEY_ID`     | Yes      | --                | IAM access key                |
| `S3_SECRET_ACCESS_KEY` | Yes      | --                | IAM secret key                |
| `S3_ENDPOINT`          | No       | AWS default       | Custom endpoint (MinIO, etc.) |

For local development with MinIO:

```env
STORAGE_PROVIDER=s3
S3_BUCKET=omni-post-media
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin123
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

### Azure Blob Storage

Used when `STORAGE_PROVIDER=azure`.

| Variable                     | Required | Description                |
| ---------------------------- | -------- | -------------------------- |
| `AZURE_STORAGE_ACCOUNT_NAME` | Yes      | Storage account name       |
| `AZURE_STORAGE_ACCOUNT_KEY`  | Yes      | Storage account access key |
| `AZURE_STORAGE_CONTAINER`    | Yes      | Blob container name        |

```env
STORAGE_PROVIDER=azure
AZURE_STORAGE_ACCOUNT_NAME=omnipostmedia
AZURE_STORAGE_ACCOUNT_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx==
AZURE_STORAGE_CONTAINER=media
```

### Google Cloud Storage

Used when `STORAGE_PROVIDER=gcs`.

| Variable          | Required | Description               |
| ----------------- | -------- | ------------------------- |
| `GCS_PROJECT_ID`  | Yes      | GCP project ID            |
| `GCS_BUCKET_NAME` | Yes      | Cloud Storage bucket name |

GCS uses Application Default Credentials (ADC). On Cloud Run, the service account provides credentials automatically. Locally, use:

```bash
gcloud auth application-default login
```

```env
STORAGE_PROVIDER=gcs
GCS_PROJECT_ID=my-project-id
GCS_BUCKET_NAME=my-project-id-omnipost-media
```

### Instagram Provider (AWS S3)

The Instagram provider uses separate S3 variables for media processing:

| Variable        | Required           | Description                   |
| --------------- | ------------------ | ----------------------------- |
| `AWS_REGION`    | For Instagram only | AWS region for media bucket   |
| `AWS_S3_BUCKET` | For Instagram only | S3 bucket for Instagram media |

---

## Email

| Variable              | Required   | Default                | Description                    |
| --------------------- | ---------- | ---------------------- | ------------------------------ |
| `RESEND_API_KEY`      | Production | --                     | Resend API key for email       |
| `RESEND_FROM_ADDRESS` | No         | `reports@omnipost.app` | Default sender email address   |
| `SMTP_HOST`           | No         | --                     | SMTP host (for Mailhog in dev) |
| `SMTP_PORT`           | No         | --                     | SMTP port (1025 for Mailhog)   |

If `RESEND_API_KEY` is not set, the email adapter logs a warning and skips delivery (useful for development).

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

Provider priority order: OpenAI > Perplexity > Gemini (first available is used as primary).

---

## Payment Processing

| Variable           | Required | Default  | Description                           |
| ------------------ | -------- | -------- | ------------------------------------- |
| `PAYMENT_PROVIDER` | No       | `stripe` | Payment backend: `stripe` or `paddle` |

### Stripe

Used when `PAYMENT_PROVIDER=stripe` (default).

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

| Variable                      | Required | Default                 | Description                                      |
| ----------------------------- | -------- | ----------------------- | ------------------------------------------------ |
| `TRACING_ENABLED`             | No       | `false`                 | Enable OpenTelemetry tracing                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No       | `http://localhost:4318` | OTLP HTTP endpoint (Jaeger, etc.)                |
| `OTEL_SERVICE_NAME`           | No       | `omnipost-api`          | Service name in traces                           |
| `LOG_LEVEL`                   | No       | `info`                  | Pino log level: `debug`, `info`, `warn`, `error` |

Set `TRACING_ENABLED=true` to activate OpenTelemetry SDK initialization. The tracing SDK must initialize before any other imports (handled by the API entry point).

---

## Video Processing

| Variable             | Required | Default                        | Description                       |
| -------------------- | -------- | ------------------------------ | --------------------------------- |
| `FFMPEG_PATH`        | No       | `ffmpeg`                       | Path to ffmpeg binary             |
| `FFPROBE_PATH`       | No       | `ffprobe`                      | Path to ffprobe binary            |
| `VIDEO_TEMP_DIR`     | No       | `/tmp/claude/video-processing` | Temp dir for video processing     |
| `THUMBNAIL_TEMP_DIR` | No       | `/tmp/claude/thumbnails`       | Temp dir for thumbnail generation |

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

| Variable              | Required | Default | Description                                        |
| --------------------- | -------- | ------- | -------------------------------------------------- |
| `ALLOWED_MEDIA_HOSTS` | No       | --      | Comma-separated list of allowed media host domains |

---

## Storage Provider by Cloud

Quick reference for which `STORAGE_PROVIDER` and related vars to use per cloud:

| Cloud         | STORAGE_PROVIDER | Key Variables                                                                                     |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| Local (MinIO) | `s3`             | `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`               |
| AWS           | `s3`             | `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                              |
| Azure         | `azure`          | `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY`, `AZURE_STORAGE_CONTAINER`              |
| GCP           | `gcs`            | `GCS_PROJECT_ID`, `GCS_BUCKET_NAME`                                                               |
| DigitalOcean  | `do-spaces`      | `DO_SPACES_BUCKET`, `DO_SPACES_REGION`, `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_ENDPOINT` |

---

## Sample .env Files

### Minimal Local Development

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:password123@localhost:5432/omnipostdb
REDIS_URL=redis://localhost:6379
STORAGE_PROVIDER=s3
S3_BUCKET=omni-post-media
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin123
S3_ENDPOINT=http://localhost:9000
```

### Production (Generic)

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:STRONG_PASSWORD@db-host:5432/omnipostdb?sslmode=require
REDIS_URL=rediss://:REDIS_PASSWORD@redis-host:6379
API_BASE_URL=https://api.yourdomain.com
CLIENT_URL=https://app.yourdomain.com
ADMIN_URL=https://admin.yourdomain.com
APP_BASE_URL=https://api.yourdomain.com
JWT_SECRET=<openssl rand -hex 64>
JWT_REFRESH_SECRET=<openssl rand -hex 64>
ADMIN_JWT_ACCESS_SECRET=<openssl rand -hex 64>
ADMIN_JWT_REFRESH_SECRET=<openssl rand -hex 64>
CUSTOMER_JWT_SECRET=<openssl rand -hex 64>
OAUTH_ENCRYPTION_KEY=<openssl rand -hex 32>
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
