# Getting Started

## Prerequisites

Ensure you have installed:

- **Node.js** 20+ (`node --version`)
- **pnpm** 10+ (`pnpm --version`)
- **Docker** & **Docker Compose** (`docker --version`)
- **Git** (`git --version`)

## Quick Start

```bash
# 1. Clone and install
git clone <repository-url>
cd omni-post
pnpm install

# 2. Start infrastructure (PostgreSQL, Redis, Prometheus, Grafana)
docker compose up -d

# 3. Configure environment
cp .env.example .env
# Edit .env with your settings

# 4. Run database migrations
pnpm db:migrate

# 5. Start development servers
pnpm dev:api      # API on http://localhost:3000
pnpm dev:admin    # Admin on http://localhost:3100
pnpm dev:client   # Client on http://localhost:3200
```

## Environment Configuration

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL="postgresql://postgres:password123@localhost:5432/omnipostdb"
SHADOW_DATABASE_URL="postgresql://postgres:password123@localhost:5432/omnipostdb_shadow"

# Redis
REDIS_URL="redis://localhost:6379"

# Server
PORT=3000
NODE_ENV=development

# Authentication
JWT_ACCESS_SECRET="your-access-secret-min-32-chars"
JWT_REFRESH_SECRET="your-refresh-secret-min-32-chars"

# Database Pool
DB_POOL_SIZE=20
```

## Docker Services

The `docker-compose.yml` starts these services:

| Service    | Port  | Description                 |
| ---------- | ----- | --------------------------- |
| PostgreSQL | 5432  | Primary database            |
| Redis      | 6379  | Cache & job queues          |
| Prometheus | 9090  | Metrics collection          |
| Grafana    | 3001  | Dashboards (admin/admin123) |
| Jaeger     | 16686 | Distributed tracing         |

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
pnpm dev           # Start API + workers concurrently
pnpm dev:api       # Start API server only (port 3000)
pnpm dev:workers   # Start workers only
pnpm dev:admin     # Start admin dashboard (port 3100)
pnpm dev:client    # Start client app (port 3200)
pnpm build         # Build all packages
pnpm test          # Run API tests
pnpm lint          # Run ESLint
pnpm lint:fix      # Auto-fix ESLint issues
pnpm format        # Format with Prettier
```

### Database Commands

```bash
pnpm db:up         # Start Docker services
pnpm db:studio     # Open Prisma Studio
pnpm db:migrate    # Run migrations
pnpm db:seed       # Seed test data
```

### Test Commands

```bash
pnpm --filter @apps/api test                    # Run all tests
pnpm --filter @apps/api test:watch              # Watch mode
pnpm --filter @apps/api test:coverage           # With coverage
pnpm --filter @apps/api test:category:core      # Core tests
pnpm --filter @apps/api test:category:security  # Security tests
```

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

- **Grafana**: http://localhost:3001 (admin/admin123)
- **Prometheus**: http://localhost:9090
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
│   ├── shared/       # Shared types
│   ├── ports/        # Interfaces
│   ├── adapters/     # Infrastructure
│   ├── providers/    # Social media
│   └── ui/           # UI components
├── infra/
│   └── prisma/       # Database schema
├── k8s/              # Kubernetes
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

1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the codebase structure
2. Read [API.md](./API.md) for endpoint documentation
3. Read [CONTRIBUTING.md](./CONTRIBUTING.md) for code standards

---

_Last updated: March 2026_
