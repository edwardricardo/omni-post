# syntax=docker/dockerfile:1.4
# ==============================================================================
# Base Docker Image for OmniPost Monorepo
# ==============================================================================
# This file contains reusable multi-stage build definitions that eliminate
# ~90% code duplication across 5 application Dockerfiles.
#
# Usage: Reference stages via COPY --from or as base stages in app Dockerfiles
# Example: COPY --from=monorepo-deps-prod /app/node_modules ./node_modules
#
# Architecture: Ports & Adapters (Hexagonal), Event-Driven, Microservices-Ready
# ==============================================================================

# ==============================================================================
# Stage 1: monorepo-base
# Purpose: Foundation layer with Node.js, pnpm, and workspace setup
# ==============================================================================
FROM node:20-alpine AS monorepo-base

# Enable pnpm via corepack (built into Node.js 20+)
RUN corepack enable

# Set working directory for all subsequent stages
WORKDIR /app

# Install ca-certificates for HTTPS connections
RUN apk add --no-cache ca-certificates

# ==============================================================================
# Stage 2a: monorepo-deps-prod
# Purpose: Production dependencies with Prisma client generation
# Features: BuildKit cache mounts, frozen lockfile, production-only deps
# ==============================================================================
FROM monorepo-base AS monorepo-deps-prod

# Copy workspace configuration files (affects all packages)
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml tsconfig.base.json ./

# Copy package.json files for all workspace packages
# This creates the complete workspace structure for pnpm
COPY apps/api/package.json ./apps/api/
COPY apps/workers/package.json ./apps/workers/
COPY apps/client/package.json ./apps/client/
COPY apps/admin/package.json ./apps/admin/
COPY packages/ ./packages/
COPY infra/ ./infra/

# Fetch dependencies using BuildKit cache mount for pnpm store
# This downloads all packages into the cache without installing
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile

# Install production dependencies only using cache mount
# --frozen-lockfile: Fail if pnpm-lock.yaml needs updates (reproducible builds)
# --prod: Install only production dependencies (excludes devDependencies)
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# Generate Prisma client for database access
# This must run after dependencies are installed
RUN pnpm --filter @infra/prisma generate

# ==============================================================================
# Stage 2b: monorepo-deps-all
# Purpose: All dependencies (including dev dependencies) for build process
# Features: BuildKit cache mounts, frozen lockfile, full dependency tree
# ==============================================================================
FROM monorepo-base AS monorepo-deps-all

# Copy workspace configuration files
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml tsconfig.base.json ./

# Copy package.json files for all workspace packages
COPY apps/api/package.json ./apps/api/
COPY apps/workers/package.json ./apps/workers/
COPY apps/client/package.json ./apps/client/
COPY apps/admin/package.json ./apps/admin/
COPY packages/ ./packages/
COPY infra/ ./infra/

# Fetch and install ALL dependencies (production + dev)
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @infra/prisma generate

# ==============================================================================
# Stage 3: monorepo-build
# Purpose: TypeScript compilation and application building
# Features: Parameterized build targets, optimized layer caching
# ==============================================================================
FROM monorepo-deps-all AS monorepo-build

# Build arguments for customization
ARG BUILD_TARGET=api
ARG BUILD_FILTER=@apps/api
ARG BUILD_ENV_VARS=""

# Copy workspace configuration (if not already present)
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml tsconfig.base.json ./

# Copy all package.json files (dependency metadata)
COPY apps/api/package.json ./apps/api/
COPY apps/workers/package.json ./apps/workers/
COPY apps/client/package.json ./apps/client/
COPY apps/admin/package.json ./apps/admin/
COPY packages/ ./packages/
COPY infra/ ./infra/

# Copy application source code for the specific target
# This uses ARG to determine which app to build
COPY apps/${BUILD_TARGET} ./apps/${BUILD_TARGET}

# Set build environment variables if provided
# Example: BUILD_ENV_VARS="NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production"
ENV ${BUILD_ENV_VARS}

# Build the application using pnpm workspace filter
# This runs the "build" script defined in the app's package.json
RUN pnpm --filter ${BUILD_FILTER} build

# ==============================================================================
# Stage 4a: runtime-distroless
# Purpose: Minimal production runtime environment (Google Distroless)
# Security: No shell, no package manager, minimal attack surface
# ==============================================================================
FROM gcr.io/distroless/nodejs20-debian12 AS runtime-distroless

# Set working directory
WORKDIR /app

# Runtime environment variables (common defaults)
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

# User is automatically set to nonroot in distroless images
# UID: 65532, GID: 65532

# Note: Health checks and CMD must be defined in app-specific Dockerfiles
# because distroless doesn't include shell for HEALTHCHECK scripts

# ==============================================================================
# Stage 4b: runtime-alpine-dev
# Purpose: Development runtime with debugging tools and shell access
# Features: Alpine Linux, non-root user, development-friendly tools
# ==============================================================================
FROM node:20-alpine AS runtime-alpine-dev

# Install development and debugging tools
RUN apk add --no-cache \
    dumb-init \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Enable pnpm
RUN corepack enable

# Runtime environment variables
ENV NODE_ENV=development

# Set ownership to non-root user
RUN chown -R appuser:nodejs /app

# Switch to non-root user
USER appuser

# Note: ENTRYPOINT, CMD, and EXPOSE must be defined in app-specific Dockerfiles

# ==============================================================================
# Stage 5: runtime-nextjs-standalone
# Purpose: Next.js standalone output runtime (optimized for Next.js apps)
# Features: Minimal dependencies, standalone server bundle
# ==============================================================================
FROM gcr.io/distroless/nodejs20-debian12 AS runtime-nextjs-standalone

# Set working directory
WORKDIR /app

# Runtime environment variables for Next.js
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=512"

# User is automatically nonroot in distroless

# Note: Next.js apps must copy .next/standalone, .next/static, and public
# in their app-specific Dockerfiles

# ==============================================================================
# Usage Examples
# ==============================================================================
#
# Example 1: Reference production dependencies in app Dockerfile
# FROM base AS app-build
# COPY --from=monorepo-deps-prod /app/node_modules ./node_modules
#
# Example 2: Use distroless runtime as base
# FROM runtime-distroless AS production
# COPY --from=monorepo-build /app/apps/api/dist ./dist
#
# Example 3: Build with custom arguments
# docker build --build-arg BUILD_TARGET=workers \
#              --build-arg BUILD_FILTER=@apps/workers \
#              -f apps/workers/Dockerfile .
#
# ==============================================================================
# Build Arguments Reference
# ==============================================================================
#
# BUILD_TARGET: Application directory name (e.g., "api", "workers", "client")
# BUILD_FILTER: pnpm workspace filter (e.g., "@apps/api", "@apps/workers")
# BUILD_ENV_VARS: Space-separated environment variables for build process
#
# ==============================================================================
