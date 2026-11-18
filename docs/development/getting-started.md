# Getting Started

## Prerequisites

Ensure you have installed:

- **Node.js** 26 (`>=26.13.1 <27`, from `engines.node` in `package.json`; `.nvmrc` pins the major, so `fnm use` or `nvm use` selects it). The floor is 26.13.1, the security release of 2026-11-11, since 2026-11-18; CI installs the newest 26.x from `.nvmrc` (26.13.1 in the `CI` run of `main` on 2026-11-14) and both image stages pin 26.13.1; the line was adopted ahead of Node 26's LTS date so every change is measured on the runtime it ships with ([ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md))
- **pnpm** 12 (`packageManager` in `package.json` pins `pnpm@12.6.0`; `corepack enable` installs that exact version)
- **Docker** & **Docker Compose** (`docker --version`), for the local infrastructure stack
- **Git** (`git --version`)

## Quick Start

```bash
# 1. Clone and install
git clone <repository-url>
cd omni-post
pnpm install

# 2. Start the platform: environment, Postgres and Redis, migration, API, workers, both portals
pnpm start:platform
```

`pnpm start:platform` (`scripts/start/platform-start.mjs`) takes a clean checkout, with an empty database, to the four applications running from source, one stage after the other; each stage starts only once the one before it answers:

1. **Environment.** A checkout with no root `.env` receives one, every secret random. An existing `.env` is never written: the run reads it and fails naming each required variable it lacks.
2. **Postgres and Redis**, with `docker compose up -d postgres redis` from the repository's `docker-compose.yml`, published on `127.0.0.1` at 5432 and 6379 unless `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT` are set when the `.env` is generated.
3. **Migration**, with `pnpm --filter @infra/prisma run migrate` (`prisma migrate deploy`), only after Prisma proves it reaches the database the run started. Nothing is seeded: after the start no table holds a row but `_prisma_migrations`, Prisma's record of the migrations it applied.
4. **The API**, with `pnpm --filter @apps/api dev`, until `http://127.0.0.1:3000/health` answers 200 (its port is `PORT`, of the calling shell or else of `.env`, else 3000).
5. **The workers**, with `pnpm --filter @apps/workers dev`, until `http://127.0.0.1:3300/health/ready` answers 200 (their port is `METRICS_PORT`, read the same way, else 3300).
6. **The administration portal**, with `pnpm --filter @apps/admin dev`, on port 3100, and then **the client portal**, with `pnpm --filter @apps/client dev`, on port 3200: the ports their `dev` scripts fix (`next dev -p`). Each must answer `/api/health`, `/en/login` and `/api/backend/health` with 200; the portal forwards the last one to the run's API, at which the command points its `API_URL` unless the calling shell sets one.

The command leaves the four applications running and exits 0. For each one it prints where it answers, its log and the file that records its pnpm process, both under `.tmp/` (`.tmp/api.log` and `.tmp/api.pid`, then `workers`, `admin` and `client`), and a stop line of its own, `kill -s TERM -- -<id>`, which ends that application only: stopping the API leaves the workers running. A second run finds each application an earlier run started still answering, says so, and starts no second one. The sequence is cumulative: a stage that fails, exit 1 with each cause on its own line, leaves what the stages before it did (the `.env`, the running services, the applied migrations), and a second run goes on from there. `--wait-seconds <n>` bounds each wait (default 60); `node scripts/start/platform-start.mjs --help` prints every option. To start again from an empty database, stop the applications and delete `.env` together with the volumes (`docker compose down --volumes`).

The CI job `Platform Start` (`.github/workflows/ci.yml`, job `platform-start`) runs the same command on a clean runner, with `--wait-seconds 180`, and then fails if any table but `_prisma_migrations` holds a row.

## Environment Configuration

`pnpm start:platform` generates the root `.env` with the variables Docker Compose and the API require. `.env.example` at the repository root lists every variable, each marked `(required)` or `(optional)`; the root `.env` is the only env file for development, and `.env.test` (from `.env.test.example`) the only one for tests. The API validates its variables at boot through `apps/api/src/config/env.ts` and refuses to start when a required one is missing or malformed; every variable, with its default and the schema that reads it, is in [ENVIRONMENT_VARIABLES.md](../deployment/ENVIRONMENT_VARIABLES.md). Rules for adding a variable: [SECURITY_CANON.md §Secrets and Environment](../security/SECURITY_CANON.md#secrets-and-environment).

## Docker Services

The `docker-compose.yml` starts these services, each bound to `127.0.0.1`. `pnpm start:platform` starts PostgreSQL and Redis only; `docker compose up -d` starts every one:

| Service    | Port        | Description                                         |
| ---------- | ----------- | --------------------------------------------------- |
| PostgreSQL | 5432        | Primary database                                    |
| Redis      | 6379        | Cache & job queues                                  |
| MinIO      | 9000 / 9001 | S3-compatible storage (API / web console)           |
| Prometheus | 9090        | Metrics collection                                  |
| Grafana    | 3001        | Dashboards (credentials from `GF_SECURITY_ADMIN_*`) |
| Jaeger     | 16686       | Distributed tracing UI (OTLP HTTP receiver on 4318) |

`pnpm db:up` does not start containers: it resolves, reaches and authenticates against the PostgreSQL and Redis named by `DATABASE_URL` and `REDIS_URL` in `.env`, local or shared, and fails with an actionable message when one is not usable.

### Storage, tracing and mail

Carried over on 2026-10-17 from the local setup guide, [`docs/deployment/LOCAL.md`](https://github.com/edwardricardo/omni-post/blob/2d46f0d2135dbd6c9bcf29af0b548a0df118e6b0/docs/deployment/LOCAL.md), which was removed from the repository that day (git history keeps it; the link is its last version), and read against `docker-compose.yml` and the API's configuration.

- **Storage.** `docker compose up -d` starts MinIO with the `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` of `.env`, which compose requires, and a one-shot `minio-init` container that creates the `omni-post-media` bucket. The default `STORAGE_PROVIDER=local` builds the S3 adapter for that bucket in `us-east-1`; to point it at MinIO, set `S3_ENDPOINT=http://localhost:9000` and the MinIO root credentials as `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, both or neither (`apps/api/src/infrastructure/storage/createStorageAdapter.ts`). After wiping the volume, `docker compose up minio-init` creates the bucket again.
- **Tracing.** The API and the workers send spans only with `TRACING_ENABLED=true` (the default is `false`), to `OTEL_EXPORTER_OTLP_ENDPOINT`, by default `http://localhost:4318`, Jaeger's OTLP receiver, under the service names `omnipost-api` and `omnipost-worker` unless `OTEL_SERVICE_NAME` sets another.
- **Mail.** The API sends mail only through Resend (`ResendEmailAdapter`); without `RESEND_API_KEY` it logs a warning and sends nothing. No code sends over SMTP, so a local mail catcher such as Mailhog, which the old guide started, receives nothing.

### Docker Commands

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down

# Reset database
docker compose down -v  # Removes volumes
docker compose up -d
```

## Development Commands

### Core Commands

```bash
pnpm dev           # Start API + workers (turbo)
pnpm dev:all       # Start API, workers, admin and client
pnpm dev:api       # Start API server only (port 3000)
pnpm dev:workers   # Start workers only
pnpm dev:admin     # Start admin dashboard (port 3100)
pnpm dev:client    # Start client app (port 3200)
pnpm build         # Build all packages
pnpm typecheck     # Type-check all packages
pnpm test          # Test the packages changed since HEAD^1
pnpm test:all      # Test every package
pnpm lint          # Run ESLint (zero warnings)
pnpm lint:fix      # Auto-fix ESLint issues
pnpm format        # Format with Prettier
pnpm format:check  # Check formatting only
```

### Database Commands

```bash
pnpm db:up         # Preflight only, starts nothing: resolve, reach and authenticate DATABASE_URL and REDIS_URL from .env (start local ones first with docker compose up -d)
pnpm db:studio     # Open Prisma Studio
pnpm db:migrate    # Run migrations
pnpm db:seed       # Seed test data
```

### Test Commands

```bash
pnpm --filter @apps/api test                    # Unit and eval suites (Vitest)
pnpm --filter @apps/api test:unit:watch         # Watch mode
pnpm --filter @apps/api test:unit:coverage      # With coverage
pnpm --filter @apps/api test:integration        # node:test batches of scripts/run-tests.sh (needs pnpm db:up)
```

Which framework a test uses, and how to write it: [CODING_STANDARDS.md §Testing](./CODING_STANDARDS.md#testing).

### Turborepo

`build`, `typecheck`, `test`, `dev` and the other package tasks run through [Turborepo](https://turbo.build), configured in `turbo.json`. It hashes each task's inputs (source files, dependencies, environment) and replays the stored output from `.turbo/` when nothing changed. `test`, `test:e2e` and `dev` are never cached (`cache: false`), so a test task always executes.

```bash
pnpm turbo run test --filter=@providers/x         # One package
pnpm turbo run test --filter=...[HEAD^1]          # Packages changed since the last commit, and their dependents
pnpm turbo run build --filter=@apps/api...        # A package and all its dependencies
pnpm turbo run build --force                      # Bypass the cache for one run
rm -rf .turbo                                     # Delete the local cache
```

CI (`.github/workflows/ci.yml`) restores the `.turbo` cache, so only packages with changed inputs rebuild. The nightly workflow (`.github/workflows/nightly.yml`, 03:00 UTC) builds and tests with `--force` to catch failures in untouched packages, and opens an issue when it fails.

## Git and Pull Requests

- **Branch** from `main`; nothing is pushed to `main` directly.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`), one reviewable work unit each, with its tests and docs alongside the behavior.
- **Pre-commit** (`.husky/pre-commit`) runs gitleaks over the staged diff, then lint-staged: ESLint `--fix`, Prettier, the JSDoc gate (`pnpm check:jsdoc`) and secretlint over the staged files. Never bypass it.
- **Before opening a PR**, run `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and the tests of what you touched; CI runs the full set, including every fitness check in [CLAUDE.md §Automated Compliance Checks](../../CLAUDE.md#automated-compliance-checks-ci-fitness-functions).
- **PR description** follows `.github/pull_request_template.md`: Summary, Verification, and the Legal, Support and Deployment impact sections, each answered, never left empty.

Code standards are not restated here: [CODING_STANDARDS.md](./CODING_STANDARDS.md) (TypeScript, `Result` and error handling, naming, testing, JSDoc) and [ARCHITECTURE_CANON.md](../architecture/ARCHITECTURE_CANON.md) are the canon.

## Verify Installation

### 1. Check Docker Services

```bash
docker compose ps
# After pnpm start:platform, postgres and redis show "running"; the other services after docker compose up -d
```

### 2. Check API Health

```bash
curl http://localhost:3000/health
# {"ok":true,"timestamp":"..."}

curl http://localhost:3000/health/full
# Shows database and Redis status

curl http://localhost:3300/health/ready   # the workers
curl http://localhost:3100/api/health     # the administration portal
curl http://localhost:3200/api/health     # the client portal
```

### 3. Check Metrics

```bash
curl http://localhost:3000/metrics
# Prometheus metrics output
```

### 4. Access Dashboards

- **Grafana**: http://localhost:3001 (credentials from `GF_SECURITY_ADMIN_USER` / `GF_SECURITY_ADMIN_PASSWORD`)
- **Prometheus**: http://localhost:9090
- **MinIO console**: http://localhost:9001
- **Prisma Studio**: `pnpm db:studio`

## Project Structure

```
omni-post/
├── apps/
│   ├── api/          # Fastify REST API
│   ├── admin/        # Admin Dashboard (Next.js)
│   ├── client/       # Client App (Next.js)
│   └── workers/      # Background processors
├── packages/
│   ├── core/         # Domain + application (shared core)
│   ├── shared/       # Shared types
│   ├── ports/        # Interfaces
│   ├── adapters/     # Infrastructure
│   ├── providers/    # Social media
│   └── ui/           # UI components
├── infra/
│   └── prisma/       # Database schema
└── docs/             # Documentation
```

## Troubleshooting

### Database Connection Failed

```bash
# Check PostgreSQL is running
docker compose ps postgres

# Check connection
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1"'
```

### Redis Connection Failed

```bash
# Check Redis is running
docker compose ps redis

# Check connection
docker exec -it omnipost-redis redis-cli ping
# Should return: PONG
```

### Port Already in Use

```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Migration Errors

```bash
# Reset database and migrations
pnpm --filter @infra/prisma prisma migrate reset

# Regenerate Prisma client
pnpm --filter @infra/prisma prisma generate
```

## Next Steps

1. Read the [Architecture Canon](../architecture/ARCHITECTURE_CANON.md) to understand the codebase structure
2. Read [API Reference](../architecture/API.md) for endpoint documentation
3. Read [CODING_STANDARDS.md](./CODING_STANDARDS.md) and the root [CLAUDE.md](../../CLAUDE.md) for the rules every change follows
