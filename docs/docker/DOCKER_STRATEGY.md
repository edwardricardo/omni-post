# Docker Base Image Strategy for omni-post Monorepo

## Overview

This document describes the Docker base image strategy designed to eliminate ~90% code duplication across 5 Dockerfiles in the omni-post monorepo while maintaining flexibility, security, and performance.

## Problem Statement

**Before Optimization:**

- 4 production Dockerfiles (api.production, workers, client, admin) with ~90% identical code
- 1 development Dockerfile (api) with different patterns
- Significant maintenance overhead for updates
- Risk of inconsistencies across services
- Repeated workspace structure copying and dependency installation

## Solution Architecture

### Base Image Strategy

**File**: `/home/edward/projects/omni-post/docker/base.Dockerfile`

This file contains reusable multi-stage build definitions that all app-specific Dockerfiles can reference using `COPY --from` or as base stages.

### Stage Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     base.Dockerfile                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. monorepo-base (Alpine + pnpm)                     │  │
│  │    - Node 20 Alpine base                              │  │
│  │    - Corepack enabled                                 │  │
│  │    - Working directory setup                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           ├──────────────────────────────┐  │
│                           │                               │  │
│  ┌────────────────────────▼───────────────┐  ┌───────────▼──────────────┐
│  │ 2a. monorepo-deps-prod                 │  │ 2b. monorepo-deps-all    │
│  │    - Production dependencies only      │  │    - All dependencies     │
│  │    - Prisma client generated           │  │    - Prisma client        │
│  │    - BuildKit cache optimization       │  │    - Dev dependencies     │
│  └────────────────────────────────────────┘  └──────────────────────────┘
│                           │                               │
│                           │                               │
│  ┌────────────────────────▼───────────────────────────────▼──────────┐
│  │ 3. monorepo-build (Build stage)                                   │
│  │    - Accepts BUILD_TARGET, BUILD_FILTER args                      │
│  │    - Compiles TypeScript to JavaScript                            │
│  │    - Optimized for layer caching                                  │
│  └───────────────────────────────────────────────────────────────────┘
│                           │                               │
│                           │                               │
│  ┌────────────────────────▼───────────────┐  ┌───────────▼──────────────┐
│  │ 4a. runtime-distroless                 │  │ 4b. runtime-alpine-dev   │
│  │    - Distroless nodejs20-debian12      │  │    - Alpine with tools   │
│  │    - Minimal attack surface            │  │    - Debugging tools     │
│  │    - Production-optimized              │  │    - Development mode    │
│  └────────────────────────────────────────┘  └──────────────────────────┘
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Build Arguments Strategy

Each app-specific Dockerfile uses these arguments for customization:

| Argument            | Purpose                | Example Values                           |
| ------------------- | ---------------------- | ---------------------------------------- |
| `APP_NAME`          | Application identifier | `api`, `workers`, `client`, `admin`      |
| `APP_FILTER`        | pnpm workspace filter  | `@apps/api`, `@apps/workers`             |
| `APP_PORT`          | Exposed port           | `3000`, `3100`, `3200`, `-` (workers)    |
| `APP_ENTRYPOINT`    | Runtime entry file     | `dist/index.js`, `apps/client/server.js` |
| `HEALTH_CHECK_PATH` | Health endpoint        | `/health`, `/api/health`, `-` (workers)  |
| `HEALTH_CHECK_TYPE` | Check mechanism        | `http`, `redis`                          |
| `BUILD_ENV_VARS`    | Build-time env vars    | `NEXT_TELEMETRY_DISABLED=1`              |

## Implementation Details

### Stage 1: monorepo-base

**Purpose**: Foundation layer with Node.js, pnpm, and workspace setup

**Benefits**:

- Single source of truth for Node version
- Consistent pnpm configuration
- Shared across all builds

### Stage 2a: monorepo-deps-prod

**Purpose**: Production dependencies installation with Prisma client

**Key Features**:

- `--frozen-lockfile --prod` for reproducible production builds
- BuildKit cache mounts for pnpm store (`/root/.local/share/pnpm/store`)
- Prisma client generation
- Optimized layer caching

**Usage**: Referenced by production Dockerfiles

### Stage 2b: monorepo-deps-all

**Purpose**: Complete dependency installation including dev dependencies

**Key Features**:

- All dependencies for build process
- Used by build stage and development images

### Stage 3: monorepo-build

**Purpose**: TypeScript compilation and application building

**Key Features**:

- Parameterized via `BUILD_TARGET` and `BUILD_FILTER` arguments
- Supports both standard TypeScript builds and Next.js builds
- Handles app-specific build requirements

**Build Types**:

- **Standard TS**: `pnpm --filter $BUILD_FILTER build` → `apps/$APP_NAME/dist`
- **Next.js**: `pnpm --filter $BUILD_FILTER build` → `apps/$APP_NAME/.next/standalone`

### Stage 4a: runtime-distroless

**Purpose**: Minimal production runtime environment

**Security Features**:

- Google Distroless base image (nodejs20-debian12)
- No shell, package manager, or unnecessary tools
- Minimal attack surface
- Non-root user (`nonroot:nonroot`)

**Performance**:

- Smallest possible image size
- Fast container startup
- Optimized for production workloads

### Stage 4b: runtime-alpine-dev

**Purpose**: Development runtime with debugging tools

**Features**:

- Alpine Linux with curl, dumb-init
- Shell access for debugging
- Non-root user (`fastify:nodejs`)
- Development-friendly environment

## App-Specific Dockerfile Structure

Each app Dockerfile follows this pattern:

```dockerfile
# syntax=docker/dockerfile:1.4
ARG BASE_IMAGE=base
FROM ${BASE_IMAGE} AS app-specific-customization

# Reference shared stages
FROM monorepo-deps-prod AS deps
FROM monorepo-build AS build

# App-specific build args
ARG APP_NAME=api
ARG APP_PORT=3000
ARG APP_ENTRYPOINT=dist/index.js

# Production runtime
FROM runtime-distroless AS production

# Copy from shared stages
COPY --from=deps ...
COPY --from=build ...

# App-specific configuration
ENV PORT=${APP_PORT}
EXPOSE ${APP_PORT}

# App-specific health check
HEALTHCHECK ...

CMD ["${APP_ENTRYPOINT}"]
```

## Migration Path

### Phase 1: Create Base Image Infrastructure

1. ✅ Create `/home/edward/projects/omni-post/docker/` directory
2. ✅ Implement `docker/base.Dockerfile` with reusable stages
3. ✅ Document strategy in `docker/DOCKER_STRATEGY.md`

### Phase 2: Refactor Production Dockerfiles

1. ✅ Refactor `apps/api/Dockerfile.production`
2. ✅ Refactor `apps/workers/Dockerfile`
3. ✅ Refactor `apps/client/Dockerfile`
4. ✅ Refactor `apps/admin/Dockerfile`

### Phase 3: Testing and Validation

1. Build each service: `docker build -f apps/{service}/Dockerfile .`
2. Verify image sizes (should be smaller or equal)
3. Test container startup and health checks
4. Validate runtime behavior

### Phase 4: Development Dockerfile (Optional)

1. Create `apps/api/Dockerfile.dev` using `runtime-alpine-dev`
2. Configure for development workflows

## Build Commands

### Production Builds

```bash
# API Service
docker build -f apps/api/Dockerfile.production -t omnipost-api:latest .

# Workers Service
docker build -f apps/workers/Dockerfile -t omnipost-workers:latest .

# Client Next.js App
docker build -f apps/client/Dockerfile -t omnipost-client:latest .

# Admin Next.js App
docker build -f apps/admin/Dockerfile -t omnipost-admin:latest .
```

### Development Builds

```bash
# API Development (using alpine-dev runtime)
docker build -f apps/api/Dockerfile --target development -t omnipost-api:dev .
```

### Using Docker Compose

```yaml
# docker-compose.production.yml
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile.production
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production

  workers:
    build:
      context: .
      dockerfile: apps/workers/Dockerfile
    environment:
      - NODE_ENV=production
```

## Security Best Practices Maintained

### 1. Minimal Runtime Images

- ✅ Distroless images for production (no shell, no package manager)
- ✅ Non-root user execution
- ✅ Minimal attack surface

### 2. Build-Time Security

- ✅ Frozen lockfiles prevent supply chain attacks
- ✅ Multi-stage builds reduce final image size
- ✅ No sensitive data in layers

### 3. Dependency Management

- ✅ Production dependencies separated from dev dependencies
- ✅ BuildKit cache mounts don't persist in final image
- ✅ Reproducible builds with locked versions

## Performance Optimizations

### 1. Layer Caching Strategy

- Base layers cached across all builds
- Dependency layers cached independently
- Source code changes don't invalidate dependency cache

### 2. BuildKit Features

- Cache mounts for pnpm store (persistent across builds)
- Parallel stage execution
- Efficient layer management

### 3. Image Size Optimization

- Distroless runtime images (~50-100MB vs ~200MB Alpine)
- Production dependencies only in final image
- No build tools in runtime image

## Health Check Patterns

### HTTP-Based (API, Client, Admin)

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const req=http.request({host:'localhost',port:$PORT,path:'$HEALTH_PATH',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"
```

### Redis-Based (Workers)

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const Redis=require('ioredis');const redis=new Redis(process.env.REDIS_URL);redis.ping().then(()=>{redis.disconnect();process.exit(0)}).catch(()=>process.exit(1));"
```

## Maintenance Benefits

### Before Base Image Strategy

- **5 Dockerfiles** with duplicated code
- **~450 lines** total (90 lines × 5 files)
- **5 places** to update for dependency changes
- **Inconsistencies** across services

### After Base Image Strategy

- **1 base.Dockerfile** with shared logic (~150 lines)
- **4 app Dockerfiles** with minimal customization (~40 lines each)
- **Total: ~310 lines** (31% reduction)
- **1 place** to update shared infrastructure
- **Guaranteed consistency** across services

## Testing Strategy

### Build Tests

```bash
# Test all production builds
for app in api workers client admin; do
  docker build -f apps/$app/Dockerfile* -t omnipost-$app:test . || exit 1
done
```

### Runtime Tests

```bash
# Test container startup
docker run -d --name test-api omnipost-api:test
docker exec test-api node -v
docker exec test-api pnpm -v
docker stop test-api && docker rm test-api
```

### Security Scanning

```bash
# Scan images for vulnerabilities
docker scan omnipost-api:latest
docker scan omnipost-workers:latest
docker scan omnipost-client:latest
docker scan omnipost-admin:latest
```

## Rollback Strategy

If issues are encountered:

1. Original Dockerfiles preserved with `.backup` suffix
2. Revert to original files: `mv apps/*/Dockerfile.backup apps/*/Dockerfile`
3. Remove base image: `rm -rf docker/`
4. Rebuild using original approach

## Future Enhancements

### Phase 5: Advanced Optimizations

- [ ] Multi-architecture builds (AMD64 + ARM64)
- [ ] Automated vulnerability scanning in CI/CD
- [ ] Image signing and verification
- [ ] Registry caching for faster builds

### Phase 6: Developer Experience

- [ ] Docker Compose profiles for different scenarios
- [ ] Hot-reload development containers
- [ ] VS Code devcontainer integration
- [ ] Build automation scripts

## References

- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [BuildKit Cache Mounts](https://docs.docker.com/build/cache/optimize/)
- [Google Distroless Images](https://github.com/GoogleContainerTools/distroless)
- [pnpm in Docker](https://pnpm.io/docker)
- [Next.js Docker Deployment](https://nextjs.org/docs/deployment#docker-image)

## Conclusion

This Docker base image strategy provides:

- ✅ **31% code reduction** (450 → 310 lines)
- ✅ **Single source of truth** for shared infrastructure
- ✅ **Guaranteed consistency** across all services
- ✅ **Maintained security** (distroless, non-root)
- ✅ **Preserved performance** (BuildKit, layer caching)
- ✅ **Improved maintainability** (update once, apply everywhere)

The strategy follows 2025 Docker best practices while maintaining the specific requirements of each application in the monorepo.
