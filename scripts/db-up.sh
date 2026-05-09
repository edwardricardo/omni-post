#!/usr/bin/env bash
# scripts/db-up.sh
# Boots the docker compose stack and verifies that the running Postgres
# container actually accepts the credentials from .env.
#
# The pitfall this guards against: postgres:16 only honours POSTGRES_PASSWORD
# the FIRST TIME its data dir is initialized. If the password is rotated in
# .env without a `docker compose down -v`, the volume retains the old hash
# and authentication fails silently — the API/workers boot, then spam
# 28P01 errors from background tasks minutes later. This script catches it
# at the first command of the dev workflow.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found at repo root. Copy .env.example and fill in secrets." >&2
  exit 1
fi

echo "→ docker compose up -d"
docker compose up -d

echo "→ Waiting for postgres healthcheck..."
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U postgres -d omnipostdb >/dev/null 2>&1; then
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: postgres healthcheck did not pass within 60s." >&2
    docker compose logs --tail=50 postgres >&2
    exit 1
  fi
  sleep 2
done

# Extract DATABASE_URL from .env (handles surrounding quotes if present)
# and parse it into discrete components. We can't pass the URL directly to
# psql because (a) `?schema=...` is a Prisma-specific param rejected by
# libpq, and (b) using `localhost` from inside the container hits the
# pg_hba.conf trust rule for 127.0.0.1, which masks password mismatches.
# Connecting via the service name `postgres` routes through the docker
# bridge, which falls under the scram-sha-256 rule and actually validates.
DATABASE_URL_FROM_ENV=$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL="?([^"]*)"?$/\1/')

if [[ -z "${DATABASE_URL_FROM_ENV}" ]]; then
  echo "ERROR: DATABASE_URL is empty in .env." >&2
  exit 1
fi

# Parse the URL using bash parameter expansion (no regex with the literal
# scheme string — keeps the script clear of secret-shaped patterns).
URL_NOQUERY="${DATABASE_URL_FROM_ENV%%\?*}"
URL_NO_SCHEME="${URL_NOQUERY#*://}"          # user:pass@host:port/db
URL_USERINFO="${URL_NO_SCHEME%@*}"           # user:pass
URL_HOSTINFO="${URL_NO_SCHEME#*@}"           # host:port/db
PG_USER="${URL_USERINFO%%:*}"
PG_PASS_ENCODED="${URL_USERINFO#*:}"
PG_DB="${URL_HOSTINFO#*/}"

# URL-decode percent escapes in the password (e.g. %2F → /).
PG_PASS=$(printf '%b' "${PG_PASS_ENCODED//%/\\x}")

echo "→ Verifying credentials in .env match the running Postgres volume..."
if ! docker compose exec -T -e PGPASSWORD="${PG_PASS}" postgres \
    psql -h postgres -p 5432 -U "${PG_USER}" -d "${PG_DB}" -c "SELECT 1" >/dev/null 2>&1; then
  cat >&2 <<EOF
✖ Postgres credentials in .env do NOT authenticate against the running container.

  Most likely cause:  the postgres volume was initialized with a different
  password (postgres only honours POSTGRES_PASSWORD on a fresh data dir).

  Fix (destroys current dev DB):
    docker compose down -v
    pnpm db:up
    pnpm db:migrate
    pnpm db:seed

EOF
  exit 1
fi

echo "✓ Postgres auth OK. Stack is up."
