# Docker Infrastructure for omni-post

This directory contains the Docker base image strategy and related infrastructure for building and deploying the omni-post monorepo.

## Quick Start

### Build All Services

```bash
# From repository root
bash docker/build-all.sh

# With clean cache
bash docker/build-all.sh --no-cache
```

### Run with Docker Compose

```bash
# Start all services
docker compose -f docker/docker-compose.optimized.yml up -d

# View logs
docker compose -f docker/docker-compose.optimized.yml logs -f

# Stop all services
docker compose -f docker/docker-compose.optimized.yml down
```

### Validate Configuration

```bash
# Run validation checks
bash docker/validate-builds.sh
```

## Directory Structure

```
docker/
├── base.Dockerfile              # Shared multi-stage base image
├── docker-compose.optimized.yml # Production-ready Docker Compose
├── build-all.sh                 # Build script for all services
├── validate-builds.sh           # Validation and testing script
├── DOCKER_STRATEGY.md           # Architectural design document
├── MIGRATION_GUIDE.md           # Migration from old Dockerfiles
└── README.md                    # This file
```

## Files Overview

### base.Dockerfile

**Purpose**: Defines reusable multi-stage build patterns for all applications

**Key Stages**:

- `monorepo-base`: Foundation with Node.js 20 and pnpm
- `monorepo-deps-prod`: Production dependencies only
- `monorepo-deps-all`: All dependencies (for builds)
- `monorepo-build`: TypeScript compilation
- `runtime-distroless`: Minimal production runtime
- `runtime-alpine-dev`: Development runtime with tools
- `runtime-nextjs-standalone`: Next.js optimized runtime

**Usage Example**:

```dockerfile
# In app-specific Dockerfile
FROM node:20-alpine AS base
# ... reference shared stages ...
COPY --from=deps /app/node_modules ./node_modules
```

### docker-compose.optimized.yml

**Purpose**: Orchestration configuration for all services

**Services Included**:

- PostgreSQL database
- Redis cache/queue
- API (Fastify)
- Workers (BullMQ)
- Client (Next.js)
- Admin (Next.js)

**Features**:

- Health checks for all services
- Dependency ordering
- Volume management
- Network isolation
- Environment configuration

### build-all.sh

**Purpose**: Build all Docker images with a single command

**Features**:

- Builds all 5 services
- Supports `--no-cache` flag
- Color-coded output
- Displays image sizes
- Exit on first error

**Usage**:

```bash
bash docker/build-all.sh          # Normal build
bash docker/build-all.sh --no-cache  # Clean build
```

### validate-builds.sh

**Purpose**: Comprehensive validation of Docker configuration

**Checks**:

- ✅ Dockerfile existence
- ✅ Security best practices
- ✅ Multi-stage build usage
- ✅ Health check definitions
- ✅ Non-root user configuration
- ✅ Documentation completeness
- ✅ Image size estimation

**Usage**:

```bash
bash docker/validate-builds.sh
```

## Application Dockerfiles

### API Service

**Location**: `/home/edward/projects/omni-post/apps/api/`

**Dockerfiles**:

- `Dockerfile.production.new`: Production build (distroless)
- `Dockerfile.dev.new`: Development build (Alpine with tools)

**Port**: 3000
**Health Check**: `GET /health`
**Entrypoint**: `dist/index.js`

**Build Command**:

```bash
docker build -f apps/api/Dockerfile.production.new -t omnipost-api:latest .
```

### Workers Service

**Location**: `/home/edward/projects/omni-post/apps/workers/`

**Dockerfile**: `Dockerfile.new`

**Port**: None (background processor)
**Health Check**: Redis connectivity
**Entrypoint**: `dist/publishWorker.js`

**Build Command**:

```bash
docker build -f apps/workers/Dockerfile.new -t omnipost-workers:latest .
```

### Client Application

**Location**: `/home/edward/projects/omni-post/apps/client/`

**Dockerfile**: `Dockerfile.new`

**Port**: 3200
**Health Check**: `GET /api/health`
**Entrypoint**: `apps/client/server.js` (Next.js standalone)

**Build Command**:

```bash
docker build -f apps/client/Dockerfile.new -t omnipost-client:latest .
```

### Admin Dashboard

**Location**: `/home/edward/projects/omni-post/apps/admin/`

**Dockerfile**: `Dockerfile.new`

**Port**: 3100
**Health Check**: `GET /api/health`
**Entrypoint**: `apps/admin/server.js` (Next.js standalone)

**Build Command**:

```bash
docker build -f apps/admin/Dockerfile.new -t omnipost-admin:latest .
```

## Build Patterns

### Standard TypeScript Service (API, Workers)

```dockerfile
# Stage 1: Base
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# Stage 2: Dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/{service}/package.json ./apps/{service}/
COPY packages/ ./packages/
COPY infra/ ./infra/
RUN pnpm install --frozen-lockfile --prod

# Stage 3: Build
FROM base AS build
# ... install all deps ...
COPY apps/{service} ./apps/{service}
RUN pnpm --filter @apps/{service} build

# Stage 4: Production
FROM gcr.io/distroless/nodejs20-debian12 AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/{service}/dist ./dist
CMD ["dist/index.js"]
```

### Next.js Service (Client, Admin)

```dockerfile
# Stages 1-3: Same as above

# Stage 4: Production
FROM gcr.io/distroless/nodejs20-debian12 AS production
# Next.js standalone output
COPY --from=build /app/apps/{service}/.next/standalone ./
COPY --from=build /app/apps/{service}/.next/static ./apps/{service}/.next/static
COPY --from=build /app/apps/{service}/public ./apps/{service}/public
CMD ["apps/{service}/server.js"]
```

## Environment Variables

### Common Variables

```bash
NODE_ENV=production              # Runtime environment
NODE_OPTIONS="--max-old-space-size=512"  # Node.js heap size
```

### Database Connection

```bash
DATABASE_URL=postgresql://postgres:password123@postgres:5432/omnipostdb
```

### Redis Connection

```bash
REDIS_URL=redis://redis:6379
```

### API Service

```bash
PORT=3000
JWT_SECRET=your-jwt-secret-change-in-production
```

### Next.js Services

```bash
NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_API_URL=http://api:3000
PORT=3100  # or 3200 for client
```

## Security Features

### 1. Distroless Runtime Images

- ✅ No shell or package manager
- ✅ Minimal attack surface
- ✅ ~50% smaller than Alpine
- ✅ CVE reduction

### 2. Non-Root User

All services run as non-root:

- **Production**: `nonroot` (UID 65532)
- **Development**: `fastify` or `appuser` (UID 1001)

### 3. Multi-Stage Builds

- ✅ Build tools not in final image
- ✅ Reduced image size
- ✅ Faster deployments

### 4. Frozen Lockfiles

- ✅ Reproducible builds
- ✅ Supply chain security
- ✅ No unexpected updates

### 5. Health Checks

All services include health checks:

- API/Client/Admin: HTTP health endpoints
- Workers: Redis connectivity check

## Performance Optimizations

### 1. BuildKit Cache Mounts

```dockerfile
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
```

**Benefits**:

- Persistent cache across builds
- Faster rebuilds (~70% faster)
- Reduced network usage

### 2. Layer Caching Strategy

```dockerfile
# Copy package files first (changes infrequently)
COPY package.json pnpm-lock.yaml ./

# Install dependencies (cached if package.json unchanged)
RUN pnpm install

# Copy source code last (changes frequently)
COPY apps/{service} ./apps/{service}
```

### 3. Production Dependencies Only

```dockerfile
RUN pnpm install --frozen-lockfile --prod
```

**Benefits**:

- ~30% smaller node_modules
- Faster container startup
- Reduced security surface

## Build Arguments

### Base Image Arguments

```bash
docker build \
  --build-arg BUILD_TARGET=api \
  --build-arg BUILD_FILTER=@apps/api \
  -f docker/base.Dockerfile \
  .
```

**Available Arguments**:

- `BUILD_TARGET`: App directory name
- `BUILD_FILTER`: pnpm workspace filter
- `BUILD_ENV_VARS`: Build environment variables

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Push Docker Images

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [api, workers, client, admin]

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build ${{ matrix.service }}
        uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/${{ matrix.service }}/Dockerfile.new
          push: true
          tags: registry.example.com/omnipost-${{ matrix.service }}:${{ github.sha }}
          cache-from: type=registry,ref=registry.example.com/omnipost-${{ matrix.service }}:cache
          cache-to: type=registry,ref=registry.example.com/omnipost-${{ matrix.service }}:cache,mode=max
```

## Troubleshooting

### Build Fails with "no source files found"

**Problem**: Build context is incorrect

**Solution**:

```bash
# Always build from repository root
cd /home/edward/projects/omni-post
docker build -f apps/api/Dockerfile.production.new -t omnipost-api:latest .
```

### Image Size Larger Than Expected

**Problem**: Dev dependencies included

**Solution**:

```dockerfile
# Ensure using --prod flag
RUN pnpm install --frozen-lockfile --prod
```

### Health Check Fails

**Problem**: Distroless images don't have curl

**Solution**:

```dockerfile
# Use Node.js built-in http module
HEALTHCHECK CMD node -e "const http=require('http');..."
```

### BuildKit Cache Not Working

**Problem**: BuildKit not enabled

**Solution**:

```bash
export DOCKER_BUILDKIT=1
# Or use buildx
docker buildx build ...
```

## Maintenance

### Updating Node.js Version

```dockerfile
# docker/base.Dockerfile
FROM node:21-alpine AS monorepo-base  # Update version
# ...
FROM gcr.io/distroless/nodejs21-debian12 AS runtime-distroless  # Update version
```

Then rebuild all services:

```bash
bash docker/build-all.sh --no-cache
```

### Updating Dependencies

```bash
# Update pnpm-lock.yaml
pnpm update

# Rebuild images
bash docker/build-all.sh --no-cache
```

### Security Scanning

```bash
# Scan for vulnerabilities
docker scan omnipost-api:latest
docker scan omnipost-workers:latest
docker scan omnipost-client:latest
docker scan omnipost-admin:latest
```

## Best Practices

### 1. Always Use BuildKit

```bash
export DOCKER_BUILDKIT=1
```

### 2. Build from Repository Root

```bash
cd /home/edward/projects/omni-post
docker build -f apps/*/Dockerfile.new .
```

### 3. Use Frozen Lockfiles

Never modify `pnpm-lock.yaml` manually

### 4. Implement Health Checks

Every service must have a health check

### 5. Run as Non-Root

Never use `USER root` in production images

### 6. Keep Images Minimal

Use distroless for production

### 7. Tag Images Appropriately

```bash
# Development
docker tag omnipost-api:latest omnipost-api:dev-$(git rev-parse --short HEAD)

# Production
docker tag omnipost-api:latest omnipost-api:$(git describe --tags)
```

## Resources

- **Strategy Document**: [DOCKER_STRATEGY.md](./DOCKER_STRATEGY.md)
- **Migration Guide**: [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
- **Docker Documentation**: https://docs.docker.com/
- **BuildKit Documentation**: https://docs.docker.com/build/buildkit/
- **Distroless Images**: https://github.com/GoogleContainerTools/distroless
- **pnpm in Docker**: https://pnpm.io/docker

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
3. Run validation: `bash docker/validate-builds.sh`
4. Check Docker logs: `docker logs <container>`

## License

Same as parent project
