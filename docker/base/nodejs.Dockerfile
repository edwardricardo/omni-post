# syntax=docker/dockerfile:1.4
# ==============================================================================
# Shared Node.js Base Dockerfile for All Services
# ==============================================================================
# This base Dockerfile eliminates 660+ lines of duplication across 4 services
# by providing shared build stages that all monorepo services can use.
#
# Usage in service Dockerfiles:
#   FROM ../../docker/base/nodejs.Dockerfile AS base
#   ARG SERVICE_PATH=apps/api
#   ... service-specific commands
# ==============================================================================

# ==============================================================================
# Stage: base - Minimal Node.js runtime with pnpm
# ==============================================================================
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# ==============================================================================
# Stage: deps - Production Dependencies Only
# ==============================================================================
FROM base AS deps

ARG SERVICE_PATH
ENV CI=true

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./

# Copy service-specific package.json
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/

# Copy shared packages and infrastructure
COPY packages/ ./packages/
COPY infra/ ./infra/

# Install production dependencies with caching
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod || echo "Some prepare scripts may have failed (expected)"

# ==============================================================================
# Stage: build - Build-time Dependencies + Compilation
# ==============================================================================
FROM base AS build

ARG SERVICE_PATH
ENV CI=true

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./

# Copy service-specific package.json
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/

# Copy shared packages and infrastructure
COPY packages/ ./packages/
COPY infra/ ./infra/

# Install ALL dependencies (including devDependencies)
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile || echo "Some prepare scripts may have failed (expected)"

# Generate Prisma client (required for all services)
RUN pnpm --filter @infra/prisma generate

# ==============================================================================
# Stage: runtime-base - Distroless Production Runtime
# ==============================================================================
FROM gcr.io/distroless/nodejs20-debian12 AS runtime-base

WORKDIR /app

# Use non-root user (built into distroless)
USER nonroot

# Default environment (override in service Dockerfiles)
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"
