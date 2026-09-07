#!/usr/bin/env bash
# scripts/db/enable-app-role-login.sh
#
# Enables login for `omnipost_app`, the role the application connects as.
#
# ## Why this is a script and not a line in the migration
#
# The role itself is provisioned by `<ts>_create_omnipost_app_role` so that every
# environment gets the same NOSUPERUSER / NOBYPASSRLS posture from the same
# source. Its PASSWORD deliberately does not live there: a credential committed
# to the migration tree is CWE-798, and the security canon grants no exception
# for it. So the migration creates the role NOLOGIN, and each environment turns
# login on from its own secret channel — this script for dev, a psql step in
# ci.yml for CI, the deployment runbook for anything else.
#
# ## Why it runs AFTER migrations, in every environment
#
# The role is a migration artifact, so nothing can grant it login before the
# migration tree has been applied. That rules out the `docker-entrypoint-initdb.d`
# hook a compose stack would otherwise use: initdb scripts run once, when the
# cluster is first created, which is strictly earlier than any migration.
#
# ## Usage
#
#   OMNIPOST_APP_DB_PASSWORD='...' bash scripts/db/enable-app-role-login.sh
#
# The password comes from the environment, never from a file in this repository
# and never from a default. A default would be a fallback credential that ships
# to whoever forgets to set the real one.

set -euo pipefail

cd "$(dirname "$0")/../.."

APP_ROLE="omnipost_app"

if [[ -z "${OMNIPOST_APP_DB_PASSWORD:-}" ]]; then
  echo "ERROR: OMNIPOST_APP_DB_PASSWORD is not set." >&2
  echo "  This script refuses to invent one: a default password for the role the" >&2
  echo "  application connects as would be a shipped credential (CWE-798)." >&2
  echo "  Export it from this environment's own secret channel and re-run." >&2
  exit 1
fi

# --- Resolve the ADMINISTRATIVE connection -----------------------------------
# ALTER ROLE requires CREATEROLE or superuser, so this must run over the
# owner/superuser channel — never over the app-role URL. MIGRATE_DATABASE_URL is
# that channel once the runtime cutover splits the two; before the split there is
# only DATABASE_URL and it still points at the owner, so preferring the first and
# falling back to the second is correct on both sides of the cutover.
ADMIN_URL="${MIGRATE_DATABASE_URL:-${DATABASE_URL:-}}"

if [[ -z "${ADMIN_URL}" ]] && [[ -f .env ]]; then
  ADMIN_URL=$(grep -E '^MIGRATE_DATABASE_URL=' .env | head -1 | sed -E 's/^MIGRATE_DATABASE_URL="?([^"]*)"?$/\1/' || true)
  if [[ -z "${ADMIN_URL}" ]]; then
    ADMIN_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL="?([^"]*)"?$/\1/' || true)
  fi
fi

if [[ -z "${ADMIN_URL}" ]]; then
  echo "ERROR: no administrative database URL found." >&2
  echo "  Set MIGRATE_DATABASE_URL (or DATABASE_URL) in the environment or in .env." >&2
  exit 1
fi

# --- Parse it into discrete libpq arguments ----------------------------------
# Same approach as scripts/db-up.sh: the `?schema=...` query parameter is
# Prisma-specific and libpq rejects it, and explicit -h/-p/-U/-d avoids any
# percent-encoding ambiguity in the URI parser.
URL_NOQUERY="${ADMIN_URL%%\?*}"
URL_NO_SCHEME="${URL_NOQUERY#*://}"
URL_USERINFO="${URL_NO_SCHEME%@*}"
URL_HOSTINFO="${URL_NO_SCHEME#*@}"
PG_USER="${URL_USERINFO%%:*}"
PG_PASS_ENCODED="${URL_USERINFO#*:}"
PG_DB="${URL_HOSTINFO#*/}"
PG_HOSTPORT="${URL_HOSTINFO%%/*}"
if [[ "${PG_HOSTPORT}" == *:* ]]; then
  PG_HOST="${PG_HOSTPORT%%:*}"
  PG_PORT="${PG_HOSTPORT##*:}"
else
  PG_HOST="${PG_HOSTPORT}"
  PG_PORT="5432"
fi
PG_PASS=$(printf '%b' "${PG_PASS_ENCODED//%/\\x}")

# --- Enable login ------------------------------------------------------------
# `:'app_password'` is psql's quoted-variable interpolation: it escapes the value
# as a single SQL literal, so a password containing a quote cannot terminate the
# statement. Never build this statement by string concatenation.
#
# The statement arrives on STDIN rather than through `-c` because psql expands
# variables only in the input it lexes itself; a `-c` string is handed to the
# server verbatim and the `:'...'` would reach it as a syntax error.
echo "→ Enabling login for ${APP_ROLE} on ${PG_HOST}:${PG_PORT}/${PG_DB} ..."
printf '%s\n' "ALTER ROLE :\"app_role\" LOGIN PASSWORD :'app_password';" \
  | PGPASSWORD="${PG_PASS}" psql \
      -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
      -v ON_ERROR_STOP=1 --quiet \
      -v app_role="${APP_ROLE}" \
      -v app_password="${OMNIPOST_APP_DB_PASSWORD}"

# --- Verify the posture survived ---------------------------------------------
# Enabling login must not have relaxed anything else. If a future edit to this
# script ever hands the role SUPERUSER or BYPASSRLS, the whole isolation layer
# goes back to being decoration, so the check lives here rather than only in CI.
POSTURE=$(PGPASSWORD="${PG_PASS}" psql \
  -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
  -tAX -c "SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${APP_ROLE}'")

if [[ "${POSTURE}" != "t|f|f" ]]; then
  echo "✖ ${APP_ROLE} posture is '${POSTURE}', expected 't|f|f'" >&2
  echo "  (rolcanlogin must be true; rolsuper and rolbypassrls must both be false)" >&2
  exit 1
fi

echo "✓ ${APP_ROLE} can log in, and carries neither SUPERUSER nor BYPASSRLS."
