# Update Session U0 — Node.js v22 → v24 LTS

Date: 2026-03-26

## Runtime Change

| Environment       | Before         | After                   |
| ----------------- | -------------- | ----------------------- |
| Local runtime     | v22.19.0       | v24.14.1 (LTS: Krypton) |
| .nvmrc            | 24 (already)   | 24 (unchanged)          |
| engines field     | >=24 (already) | >=24 (unchanged)        |
| nvm default alias | 22             | 24                      |

## CI Workflow Updates

| File                                               | Before                                 | After                             |
| -------------------------------------------------- | -------------------------------------- | --------------------------------- |
| `.github/actions/setup-node-pnpm-cache/action.yml` | node: 20, pnpm: 10.16.0                | node: 24, pnpm: 10.33.0           |
| `.github/workflows/dependency-updates.yml`         | NODE_VERSION: "20", PNPM: 10.16.0      | NODE_VERSION: "24", PNPM: 10.33.0 |
| `.github/workflows/security-testing.yml`           | NODE_VERSION: "20", PNPM: 10.16.0      | NODE_VERSION: "24", PNPM: 10.33.0 |
| `.github/workflows/production-ci.yml`              | NODE_VERSION: "20"                     | NODE_VERSION: "24"                |
| `.github/workflows/nightly.yml`                    | node-version: "24" (already)           | No change                         |
| `.github/workflows/ci.yml`                         | Uses composite action (was default 20) | Now inherits 24 from action       |
| `.github/workflows/performance.yml`                | Uses composite action (was default 20) | Now inherits 24 from action       |

## Dockerfile Updates

| File                             | Before                               | After                                |
| -------------------------------- | ------------------------------------ | ------------------------------------ |
| `apps/api/Dockerfile.production` | node:20-alpine + distroless nodejs20 | node:24-alpine + distroless nodejs24 |
| `apps/api/Dockerfile.dev`        | node:20-alpine                       | node:24-alpine                       |
| `apps/api/Dockerfile.railway`    | node:20-slim                         | node:24-slim                         |
| `apps/admin/Dockerfile`          | node:20-alpine + distroless nodejs20 | node:24-alpine + distroless nodejs24 |
| `apps/workers/Dockerfile`        | node:20-alpine + distroless nodejs20 | node:24-alpine + distroless nodejs24 |
| `apps/client/Dockerfile`         | node:20-alpine + distroless nodejs20 | node:24-alpine + distroless nodejs24 |
| `apps/api/Dockerfile`            | Uses shared base (ARG)               | No change needed                     |

## Script Updates

| File                                   | Before                     | After                      |
| -------------------------------------- | -------------------------- | -------------------------- |
| `quality/scripts/setup-environment.sh` | REQUIRED_NODE_VERSION="20" | REQUIRED_NODE_VERSION="24" |

## Native Module Rebuilds

| Module | Status                                      |
| ------ | ------------------------------------------- |
| argon2 | OK (pnpm install succeeded without rebuild) |
| prisma | OK (generated client v7.4.1)                |

No native module issues encountered. Dependencies installed cleanly on Node v24.14.1.

## Build and Test Status

| Check            | Result                                         |
| ---------------- | ---------------------------------------------- |
| TypeScript build | 0 errors, 9/9 tasks successful                 |
| API unit tests   | 305 files passed, 6,478 tests passed, 0 failed |
| ESLint           | 0 errors, 0 warnings                           |

## Consistency Check

| Item               | Declared        | Runtime  | Match |
| ------------------ | --------------- | -------- | ----- |
| .nvmrc             | 24              | v24.14.1 | Yes   |
| engines            | >=24            | v24.14.1 | Yes   |
| @types/node        | 24.5.2          | v24.14.1 | Yes   |
| nightly CI         | 24              | 24       | Yes   |
| ci.yml             | 24 (via action) | 24       | Yes   |
| production-ci      | 24              | 24       | Yes   |
| dependency-updates | 24              | 24       | Yes   |
| security-testing   | 24              | 24       | Yes   |
| performance        | 24 (via action) | 24       | Yes   |
| All Dockerfiles    | node:24-\*      | 24       | Yes   |

## Decisions Made

No DECISION REQUIRED blocks were triggered. The upgrade was clean — Node v24.14.1 LTS is fully compatible with all project dependencies.

## Files Modified

| File                                             | Change                                   |
| ------------------------------------------------ | ---------------------------------------- |
| .github/actions/setup-node-pnpm-cache/action.yml | node 20→24, pnpm 10.16.0→10.33.0         |
| .github/workflows/dependency-updates.yml         | NODE_VERSION 20→24, PNPM 10.16.0→10.33.0 |
| .github/workflows/security-testing.yml           | NODE_VERSION 20→24, PNPM 10.16.0→10.33.0 |
| .github/workflows/production-ci.yml              | NODE_VERSION 20→24                       |
| apps/api/Dockerfile.production                   | node:20→24, distroless nodejs20→24       |
| apps/api/Dockerfile.dev                          | node:20→24                               |
| apps/api/Dockerfile.railway                      | node:20→24                               |
| apps/admin/Dockerfile                            | node:20→24, distroless nodejs20→24       |
| apps/workers/Dockerfile                          | node:20→24, distroless nodejs20→24       |
| apps/client/Dockerfile                           | node:20→24, distroless nodejs20→24       |
| quality/scripts/setup-environment.sh             | REQUIRED_NODE_VERSION 20→24              |
