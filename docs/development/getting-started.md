# Getting Started

## Prerequisites

Ensure you have installed:

- **Node.js** 26 (`>=26.11.1 <27`, from `engines.node` in `package.json`; `.nvmrc` pins the major, so `fnm use` or `nvm use` selects it). The floor is 26.11.1 because it is the release CI installs for Node 26, adopted ahead of Node 26's LTS date so every change is measured on the runtime it ships with ([ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md))
- **pnpm** 12 (`packageManager` in `package.json` pins `pnpm@12.6.0`; `corepack enable` installs that exact version)
- **Docker** & **Docker Compose** (`docker --version`), for the local infrastructure stack
- **Git** (`git --version`)

## Quick Start

```bash
# 1. Clone and install
git clone <repository-url>
cd omni-post
pnpm install

# 2. Configure environment
cp .env.example .env
# Fill in every value marked (required); docker compose refuses to start Grafana
# until GF_SECURITY_ADMIN_USER and GF_SECURITY_ADMIN_PASSWORD are set

# 3. Start infrastructure (PostgreSQL, Redis, MinIO, Prometheus, Grafana, Jaeger)
docker compose up -d

# 4. Check that the database and Redis in .env are reachable
pnpm db:up

# 5. Run database migrations
pnpm db:migrate

# 6. Start development servers
pnpm dev:api      # API on http://localhost:3000
pnpm dev:admin    # Admin on http://localhost:3100
pnpm dev:client   # Client on http://localhost:3200
```

## Environment Configuration

`.env.example` at the repository root lists every variable, each marked `(required)` or `(optional)`; the root `.env` is the only env file for development, and `.env.test` (from `.env.test.example`) the only one for tests. The API validates its variables at boot through `apps/api/src/config/env.ts` and refuses to start when a required one is missing or malformed. Rules for adding a variable: [SECURITY_CANON.md §Secrets and Environment](../security/SECURITY_CANON.md#secrets-and-environment).

## Docker Services

The `docker-compose.yml` starts these services, each bound to `127.0.0.1`:

| Service    | Port        | Description                                         |
| ---------- | ----------- | --------------------------------------------------- |
| PostgreSQL | 5432        | Primary database                                    |
| Redis      | 6379        | Cache & job queues                                  |
| MinIO      | 9000 / 9001 | S3-compatible storage (API / web console)           |
| Prometheus | 9090        | Metrics collection                                  |
| Grafana    | 3001        | Dashboards (credentials from `GF_SECURITY_ADMIN_*`) |
| Jaeger     | 16686       | Distributed tracing UI (OTLP HTTP receiver on 4318) |

`pnpm db:up` does not start containers: it resolves, reaches and authenticates against the PostgreSQL and Redis named by `DATABASE_URL` and `REDIS_URL` in `.env`, local or shared, and fails with an actionable message when one is not usable.

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
# All services should show "running"
```

### 2. Check API Health

```bash
curl http://localhost:3000/health
# {"ok":true,"timestamp":"..."}

curl http://localhost:3000/health/full
# Shows database and Redis status
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
docker exec -it omnipost-postgres psql -U postgres -d omnipostdb -c "SELECT 1"
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
