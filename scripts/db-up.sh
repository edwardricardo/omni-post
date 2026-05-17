#!/usr/bin/env bash
# scripts/db-up.sh
# Verifies that this dev box can resolve, reach, and authenticate against the
# shared infrastructure LXC (Postgres + Redis) before you start the app.
#
# Architecture note: infrastructure no longer runs as a local docker compose
# stack inside this repo. Postgres, Redis, MinIO, etc. live in the
# `omnipost-infra` LXC, gestionado a nivel Proxmox y accesible por Tailscale.
# This repo only CONNECTS to them — it does not own their lifecycle. So this
# script no longer runs `docker compose up`; it runs the same fail-fast
# preflight the old script did (resolve → reach → authenticate) so a
# misconfigured .env or an unreachable LXC fails HERE, with an actionable
# message, instead of as a storm of 28P01 / ECONNREFUSED errors minutes into
# `pnpm dev:all`.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found at repo root. Copy .env.example and fill in secrets." >&2
  exit 1
fi

# --- Parse DATABASE_URL ------------------------------------------------------
# Handles surrounding quotes if present. Parsed into discrete components
# because (a) the `?schema=...` query param is Prisma-specific and rejected
# by libpq, and (b) explicit -h/-p/-U/-d + PGPASSWORD avoids any URI
# percent-encoding ambiguity in psql.
DATABASE_URL_FROM_ENV=$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL="?([^"]*)"?$/\1/' || true)

if [[ -z "${DATABASE_URL_FROM_ENV}" ]]; then
  echo "ERROR: DATABASE_URL is empty or missing in .env." >&2
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
PG_HOSTPORT="${URL_HOSTINFO%%/*}"            # host:port
if [[ "${PG_HOSTPORT}" == *:* ]]; then
  PG_HOST="${PG_HOSTPORT%%:*}"
  PG_PORT="${PG_HOSTPORT##*:}"
else
  PG_HOST="${PG_HOSTPORT}"
  PG_PORT="5432"
fi

# URL-decode percent escapes in the password (e.g. %2F → /).
PG_PASS=$(printf '%b' "${PG_PASS_ENCODED//%/\\x}")

# --- Parse REDIS_URL ---------------------------------------------------------
# We deliberately do NOT use `redis-cli -u`: with the `redis://:pass@host`
# form (empty username), redis-cli treats "" as an ACL username and sends
# `AUTH "" pass`, which Redis rejects with WRONGPASS. ioredis (what the app
# uses) instead sends the legacy default-user `AUTH pass`. To mirror the
# app's behaviour we parse user/pass ourselves and use -h/-p/-a/--user.
REDIS_URL_FROM_ENV=$(grep -E '^REDIS_URL=' .env | head -1 | sed -E 's/^REDIS_URL="?([^"]*)"?$/\1/' || true)

if [[ -z "${REDIS_URL_FROM_ENV}" ]]; then
  echo "ERROR: REDIS_URL is empty or missing in .env." >&2
  exit 1
fi

R_NO_SCHEME="${REDIS_URL_FROM_ENV#*://}"     # [user]:[pass]@host:port[/db]
if [[ "${R_NO_SCHEME}" == *@* ]]; then
  R_USERINFO="${R_NO_SCHEME%@*}"             # [user]:[pass]
  R_HOSTINFO="${R_NO_SCHEME##*@}"            # host:port[/db]
  REDIS_USER="${R_USERINFO%%:*}"             # often empty (default user)
  REDIS_PASS_ENCODED="${R_USERINFO#*:}"
  # URL-decode percent escapes, same approach as the Postgres password.
  REDIS_PASS=$(printf '%b' "${REDIS_PASS_ENCODED//%/\\x}")
else
  R_HOSTINFO="${R_NO_SCHEME}"
  REDIS_USER=""
  REDIS_PASS=""
fi
R_HOSTPORT="${R_HOSTINFO%%/*}"               # host:port
if [[ "${R_HOSTPORT}" == *:* ]]; then
  REDIS_HOST="${R_HOSTPORT%%:*}"
  REDIS_PORT="${R_HOSTPORT##*:}"
else
  REDIS_HOST="${R_HOSTPORT}"
  REDIS_PORT="6379"
fi

# --- Helpers -----------------------------------------------------------------
tcp_check() { # host port
  timeout 5 bash -c "cat < /dev/null > /dev/tcp/$1/$2" 2>/dev/null
}

fail() {
  echo "$1" >&2
  exit 1
}

# --- 1. Name resolution ------------------------------------------------------
echo "→ Resolving infra host '${PG_HOST}'..."
if ! getent hosts "${PG_HOST}" >/dev/null 2>&1; then
  fail "✖ Cannot resolve '${PG_HOST}'.
  The infra LXC is reached over Tailscale MagicDNS. Check:
    - Tailscale is up on this box:  tailscale status
    - The name in .env matches the LXC's MagicDNS name
    - Or add a static entry to /etc/hosts as a fallback"
fi

# --- 2. TCP reachability -----------------------------------------------------
echo "→ Checking Postgres ${PG_HOST}:${PG_PORT} ..."
tcp_check "${PG_HOST}" "${PG_PORT}" || fail "✖ Postgres ${PG_HOST}:${PG_PORT} unreachable.
  Is the omnipost-infra LXC running (check Proxmox), is the Postgres
  service up inside it, and does it listen on/expose ${PG_PORT}?"

echo "→ Checking Redis ${REDIS_HOST}:${REDIS_PORT} ..."
tcp_check "${REDIS_HOST}" "${REDIS_PORT}" || fail "✖ Redis ${REDIS_HOST}:${REDIS_PORT} unreachable.
  Is the omnipost-infra LXC running and the Redis service up inside it?"

# --- 3. Postgres authentication ---------------------------------------------
echo "→ Verifying Postgres credentials in .env authenticate..."
if ! PGCONNECT_TIMEOUT=5 PGPASSWORD="${PG_PASS}" \
    psql -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
    -c "SELECT 1" >/dev/null 2>&1; then
  fail "✖ Postgres reachable but credentials in .env do NOT authenticate
  (or database '${PG_DB}' does not exist).

  Check inside the omnipost-infra LXC:
    - The role '${PG_USER}' exists with the password in .env
    - The database '${PG_DB}' exists
    - pg_hba.conf allows scram-sha-256 from this box's Tailscale IP

  If the DB is fresh:  pnpm db:migrate && pnpm db:seed"
fi

# --- 4. Redis authentication -------------------------------------------------
echo "→ Verifying Redis connectivity (PING)..."
redis_args=(-h "${REDIS_HOST}" -p "${REDIS_PORT}" --no-auth-warning)
if [[ -n "${REDIS_USER}" ]]; then
  redis_args+=(--user "${REDIS_USER}")
fi
if [[ -n "${REDIS_PASS}" ]]; then
  redis_args+=(-a "${REDIS_PASS}")
fi
if [[ "$(timeout 5 redis-cli "${redis_args[@]}" PING 2>/dev/null || true)" != "PONG" ]]; then
  fail "✖ Redis reachable but PING failed — likely an auth/password mismatch
  between REDIS_URL in .env and the Redis instance in the omnipost-infra LXC."
fi

echo "✓ Infra OK — omnipost-infra reachable & authenticated."
echo "  Postgres: ${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB}"
echo "  Redis:    ${REDIS_HOST}:${REDIS_PORT}"
echo "  Next:     pnpm dev:all"
