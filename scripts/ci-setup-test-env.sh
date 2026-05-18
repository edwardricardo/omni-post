#!/usr/bin/env bash
#
# @file ci-setup-test-env.sh
# @description Generates the gitignored root `.env.test` consumed by
#   apps/api/src/config/env.ts when NODE_ENV=test. The tracked .env.test was
#   removed for credential hygiene (commit 0a62882); CI must synthesize it.
#   DATABASE_URL / REDIS_URL MUST be provided by the caller (the CI job) —
#   no hardcoded connection-string fallback (CWE-798 / fitness #15). All
#   secret values are DETERMINISTIC, OBVIOUSLY-FAKE, TEST-ONLY and generated
#   here (no secret-shaped literals are stored in the repo).
# @layer infrastructure
#
set -euo pipefail

: "${DATABASE_URL:?ci-setup-test-env: DATABASE_URL must be exported by the CI job}"
: "${REDIS_URL:?ci-setup-test-env: REDIS_URL must be exported by the CI job}"
SH="${SHADOW_DATABASE_URL:-${DATABASE_URL/omnipostdb/omnipostdb_shadow}}"

# PLATFORM_ENCRYPTION_KEY must be base64 of EXACTLY 32 bytes (AES-256) — see
# EncryptionService.decodeKey(). Generate 32 fixed bytes -> base64 (no literal).
PLATFORM_KEY="$(head -c 32 /dev/zero | tr '\0' 'c' | base64 | tr -d '\n')"

{
  echo "NODE_ENV=test"
  echo "PORT=3001"
  echo "DATABASE_URL=${DATABASE_URL}"
  echo "SHADOW_DATABASE_URL=${SH}"
  echo "REDIS_URL=${REDIS_URL}"
  # HMAC-style secrets: env.ts only requires z.string().min(32).
  for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET CUSTOMER_JWT_SECRET \
           ADMIN_JWT_ACCESS_SECRET ADMIN_JWT_REFRESH_SECRET COOKIE_SECRET \
           OAUTH_ENCRYPTION_KEY; do
    echo "${k}=citest-${k}-deterministic-nonproduction-padding-string"
  done
  echo "PLATFORM_ENCRYPTION_KEY=${PLATFORM_KEY}"
  echo "LOG_LEVEL=warn"
  echo "ENABLE_RATE_LIMITING=false"
  echo "PAYMENT_PROVIDER=none"
  echo "STORAGE_PROVIDER=local"
} > .env.test

echo "Wrote .env.test (NODE_ENV=test; deterministic non-production secrets)"
