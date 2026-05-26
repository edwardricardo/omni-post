# Local Development Setup

Complete guide for running OmniPost locally with all services and observability tools.

---

## Prerequisites

| Tool           | Version  | Install                                            |
| -------------- | -------- | -------------------------------------------------- |
| Docker Desktop | 4.x+     | https://docs.docker.com/desktop/                   |
| Node.js        | 24.x LTS | https://nodejs.org/ or `nvm install 24`            |
| pnpm           | 10.16.0  | `corepack enable && corepack prepare`              |
| Git            | 2.x+     | https://git-scm.com/                               |
| ffmpeg         | 6.x+     | `sudo apt install ffmpeg` or `brew install ffmpeg` |

Verify installations:

```bash
docker --version        # Docker version 27.x+
node --version          # v24.x.x
pnpm --version          # 10.16.0
git --version           # git version 2.x
ffmpeg -version         # ffmpeg version 6.x+
```

---

## Architecture (Local)

```
                         +------------------+
                         |   Browser        |
                         +--------+---------+
                                  |
                 +----------------+----------------+
                 |                |                 |
          :3000/api        :3100/admin        :3200/client
          Fastify API      Next.js Admin      Next.js Client
                 |                |                 |
                 +--------+-------+---------+------+
                          |                 |
                    :5432/postgres     :6379/redis
                    PostgreSQL 16      Redis 7
                          |
          +---------------+---------------+
          |               |               |
     :9000/minio    :8025/mailhog   :4318/jaeger
     S3 Storage     Email Testing   Tracing
          |
     :3001/grafana <-- :9090/prometheus
     Dashboards        Metrics
```

---

## Step 1: Clone and Install

```bash
git clone git@github.com:your-org/omni-post.git
cd omni-post
pnpm install
```

---

## Step 2: Start Infrastructure Services

The project includes a `docker-compose.yml` with PostgreSQL, Redis, Grafana, Prometheus, and Jaeger.

```bash
pnpm db:up
```

This starts:

| Service    | Port  | Purpose                 | Credentials            |
| ---------- | ----- | ----------------------- | ---------------------- |
| PostgreSQL | 5432  | Primary database        | postgres / password123 |
| Redis      | 6379  | Cache, queues, sessions | No auth (local only)   |
| Grafana    | 3001  | Monitoring dashboards   | admin / admin123       |
| Prometheus | 9090  | Metrics collection      | No auth                |
| Jaeger     | 16686 | Distributed tracing UI  | No auth                |
| Jaeger     | 4318  | OTLP HTTP receiver      | --                     |

Verify all containers are running:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

---

## Step 3: MinIO for Local S3 Storage

MinIO provides S3-compatible object storage for media files. It is included in
`docker-compose.yml` and starts automatically with `pnpm db:up`, along with a
`minio-init` one-shot container that creates the default `omni-post-media`
bucket.

| Service | Port | Purpose         | Credentials                |
| ------- | ---- | --------------- | -------------------------- |
| MinIO   | 9000 | S3 API endpoint | minioadmin / minioadmin123 |
| MinIO   | 9001 | Web console     | minioadmin / minioadmin123 |

If you need to manually re-create the bucket (e.g. after wiping the volume),
run:

```bash
docker exec omnipost-minio \
  mc alias set local http://localhost:9000 minioadmin minioadmin123
docker exec omnipost-minio \
  mc mb --ignore-existing local/omni-post-media
```

---

## Step 4: Add Mailhog for Email Testing

Mailhog captures all outgoing emails so you can inspect them in a web UI:

```bash
docker run -d \
  --name omnipost-mailhog \
  -p 1025:1025 \
  -p 8025:8025 \
  mailhog/mailhog
```

| Service | Port | Purpose      |
| ------- | ---- | ------------ |
| Mailhog | 1025 | SMTP server  |
| Mailhog | 8025 | Email web UI |

---

## Step 5: Configure Environment

Copy the example env file and update it:

```bash
cp .env.example .env
```

Edit `.env` with local development values:

```env
# ---- Core ----
NODE_ENV=development
PORT=3000

# ---- Database ----
DATABASE_URL="postgresql://postgres:password123@localhost:5432/omnipostdb"

# ---- Redis ----
REDIS_URL="redis://localhost:6379"

# ---- URLs ----
API_BASE_URL=http://localhost:3000
CLIENT_URL=http://localhost:3200
ADMIN_URL=http://localhost:3100
APP_BASE_URL=http://localhost:3000

# ---- Auth (dev-only secrets, change in production) ----
JWT_SECRET=local-dev-jwt-secret-change-me
JWT_REFRESH_SECRET=local-dev-refresh-secret-change-me
ADMIN_JWT_ACCESS_SECRET=local-dev-admin-access-change-me
ADMIN_JWT_REFRESH_SECRET=local-dev-admin-refresh-change-me
CUSTOMER_JWT_SECRET=local-dev-customer-jwt-change-me
OAUTH_ENCRYPTION_KEY=<run `openssl rand -hex 32` to generate>

# ---- Storage (MinIO as local S3) ----
STORAGE_PROVIDER=s3
S3_BUCKET=omni-post-media
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin123
S3_ENDPOINT=http://localhost:9000

# ---- Email (Mailhog) ----
RESEND_API_KEY=
RESEND_FROM_ADDRESS=dev@omnipost.local
SMTP_HOST=localhost
SMTP_PORT=1025

# ---- Observability ----
TRACING_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=omnipost-api
LOG_LEVEL=debug

# ---- AI (optional, leave blank to skip) ----
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
PERPLEXITY_API_KEY=
PERPLEXITY_MODEL=llama-3.1-sonar-small-128k-online

# ---- Payment (optional for local dev) ----
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_test_placeholder

# ---- Video Processing ----
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

---

## Step 6: Database Setup

Run migrations and seed data:

```bash
pnpm db:migrate
pnpm db:seed
```

Verify the database is populated:

```bash
pnpm db:studio
```

Prisma Studio opens at `http://localhost:5555` for browsing tables.

---

## Step 7: Start the Application

Start all services concurrently:

```bash
pnpm dev
```

This runs the API server and workers together. To start services individually:

```bash
# Terminal 1 - API only
pnpm dev:api

# Terminal 2 - Workers only
pnpm dev:workers

# Terminal 3 - Admin dashboard
pnpm dev:admin

# Terminal 4 - Client dashboard
cd apps/client && pnpm dev
```

---

## Port Summary

| Service         | URL                    | Purpose                 |
| --------------- | ---------------------- | ----------------------- |
| API             | http://localhost:3000  | REST API + health check |
| Admin Dashboard | http://localhost:3100  | Admin interface         |
| Client App      | http://localhost:3200  | Customer interface      |
| Grafana         | http://localhost:3001  | Monitoring dashboards   |
| Prometheus      | http://localhost:9090  | Metrics queries         |
| Jaeger          | http://localhost:16686 | Distributed tracing     |
| MinIO Console   | http://localhost:9001  | Object storage browser  |
| Mailhog         | http://localhost:8025  | Email inbox viewer      |
| Prisma Studio   | http://localhost:5555  | Database browser        |

---

## Health Check

Verify the API is running:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "uptime": 12.34,
  "timestamp": "2026-03-30T12:00:00.000Z"
}
```

---

## Running Tests

```bash
# Unit tests (Vitest)
pnpm --filter @apps/api test

# Unit tests with coverage
pnpm --filter @apps/api test:unit:coverage

# All tests (unit + integration, requires DB + Redis running)
pnpm --filter @apps/api test:all

# Integration tests only
pnpm --filter @apps/api test:integration

# Mutation testing
cd apps/api && pnpm exec stryker run

# Lint and format
pnpm lint
pnpm format:check
```

---

## Common Issues

### Docker containers not starting

```bash
# Check logs for specific container
docker logs omnipost-postgres
docker logs omnipost-redis

# Restart all containers
docker compose down && docker compose up -d
```

### Port conflicts

If ports are already in use, stop conflicting processes:

```bash
# Find process on port 5432
lsof -i :5432
# Kill it
kill -9 <PID>
```

### Database migration fails

Ensure PostgreSQL is accepting connections before migrating:

```bash
# Wait for PostgreSQL to be ready
until docker exec omnipost-postgres pg_isready; do sleep 1; done
pnpm db:migrate
```

### MinIO bucket not found

```bash
# Recreate the bucket
docker exec -it omnipost-minio sh -c \
  "mc alias set local http://localhost:9000 minioadmin minioadmin123 && mc mb local/omni-post-media"
```

### Traces not appearing in Jaeger

Verify `TRACING_ENABLED=true` is set in `.env` and the Jaeger container is running:

```bash
docker ps | grep jaeger
curl http://localhost:4318/v1/traces
```

---

## Stopping Everything

```bash
# Stop Docker services
docker compose down

# Stop MinIO and Mailhog
docker stop omnipost-minio omnipost-mailhog
docker rm omnipost-minio omnipost-mailhog

# Or stop and remove all volumes (full reset)
docker compose down -v
```
